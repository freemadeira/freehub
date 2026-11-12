import type { NostrEvent } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";
import { addDays, format } from "date-fns";

import { descriptionMentionTemplate } from "@/lib/card-activity";
import {
  noteCardChange,
  noteRelationChange,
  tellChanges,
} from "@/lib/card-changes";
import { mentionedPubkeys } from "@/lib/mentions";
import type {
  Board,
  BoardContent,
  BoardRelation,
  Card,
  CardFields,
  CardRef,
  Comment,
  Relation,
  Sprint,
  SprintFields,
  StatusMove,
} from "@/lib/model";
import {
  activeSprint,
  boardTemplate,
  cardTemplate,
  commentTemplate,
  deleteBoardTemplate,
  deleteCommentTemplate,
  editCommentTemplate,
  isClosed,
  latest,
  newId,
  relationFrom,
  relationId,
  relationKind,
  RELATION_KIND,
  relationTemplate,
  samePlace,
  sprintTemplate,
  startingStatus,
  statusKind,
  tombstoneTemplate,
  upcomingSprint,
} from "@/lib/model";
import { accounts, eventStore } from "@/lib/nostr";
import type { Project, ProjectFields } from "@/lib/project";
import { deleteProjectTemplate, projectTemplate } from "@/lib/project";
import { publish } from "@/lib/publish";
import type { ReactionTarget } from "@/lib/reactions";
import {
  deleteReactionsTemplate,
  reactionEmoji,
  reactionTemplate,
} from "@/lib/reactions";
import type { RelatedCard } from "@/lib/relations";
import { placeOf, relatedRef } from "@/lib/relations";
import { setSubscribed, subscriptionsOf } from "@/lib/subscribe";
import { cardSubscribers, isSubscribed } from "@/lib/subscriptions";

const SPRINT_DAYS = 15;

export type BoardDraft = Pick<
  Board,
  | "code"
  | "title"
  | "description"
  | "members"
  | "viewers"
  | "project"
  | "statuses"
>;
export type ProjectDraft = Omit<ProjectFields, "id" | "creator">;
export type NewCard = Pick<CardFields, "title" | "status" | "rank"> &
  Partial<CardFields>;

function day(offset = 0): string {
  return format(addDays(new Date(), offset), "yyyy-MM-dd");
}

export function createBoard(
  creator: string,
  draft: BoardDraft
): Promise<boolean> {
  return publish(boardTemplate({ ...draft, creator, id: newId() }));
}

/** Saves the card as is, telling no one: for changes made in bulk, like ending a sprint. */
function saveCard(
  board: Board,
  card: Card,
  changes: Partial<CardFields>
): Promise<boolean> {
  return publish(cardTemplate(board, { ...card, ...changes }), card.event);
}

/**
 * Saves the board's settings. Cards in statuses it stops using move as given,
 * telling no one, so no column lingers for them.
 */
export function updateBoard(
  board: Board,
  changes: Partial<BoardDraft>,
  moves: readonly StatusMove[] = []
): Promise<boolean[]> {
  return Promise.all([
    publish(boardTemplate({ ...board, ...changes }), board.event),
    ...moves.flatMap(({ cards, to }) =>
      cards.map((card) => saveCard(board, card, { status: to }))
    ),
  ]);
}

export function deleteBoard(board: Board): Promise<boolean> {
  return publish(deleteBoardTemplate(board));
}

export function createProject(
  creator: string,
  draft: ProjectDraft
): Promise<boolean> {
  return publish(projectTemplate({ ...draft, creator, id: newId() }));
}

export function updateProject(
  project: Project,
  changes: Partial<ProjectDraft>
): Promise<boolean> {
  return publish(projectTemplate({ ...project, ...changes }), project.event);
}

export function deleteProject(project: Project): Promise<boolean> {
  return publish(deleteProjectTemplate(project));
}

/** People just picked from the "@" list who the text still mentions, but not oneself. */
function newlyMentioned(text: string, picked: ReadonlySet<string>): string[] {
  const me = accounts.active?.pubkey;
  return mentionedPubkeys(text).filter(
    (pubkey) => picked.has(pubkey) && pubkey !== me
  );
}

/** Tells people picked into the description that it mentions them. */
function tellMentioned(
  card: CardRef,
  description: string,
  picked: ReadonlySet<string>
): Promise<boolean> {
  const mentioned = newlyMentioned(description, picked);
  return mentioned.length > 0
    ? publish(descriptionMentionTemplate(card, mentioned))
    : Promise.resolve(true);
}

/**
 * A new card, made by the person signed in. Whoever it's assigned to hears
 * about it, and so does anyone its description mentions.
 */
export async function createCard(
  board: Board,
  content: BoardContent,
  card: NewCard
): Promise<boolean> {
  const creator = accounts.active?.pubkey;
  if (!creator) {
    return false;
  }
  const fields: CardFields = {
    assignees: [],
    description: "",
    labels: [],
    ...card,
    createdAt: unixNow(),
    creator,
    id: newId(),
    number: content.nextNumber,
  };
  if (!(await publish(cardTemplate(board, fields)))) {
    return false;
  }
  const created = { ...fields, author: creator };
  const assigned = fields.assignees.filter((pubkey) => pubkey !== creator);
  await Promise.all([
    tellChanges(
      board,
      created,
      assigned.length > 0
        ? [{ added: assigned, field: "assignees", removed: [] }]
        : []
    ),
    // Every mention in a new card is new.
    tellMentioned(
      created,
      fields.description,
      new Set(mentionedPubkeys(fields.description))
    ),
  ]);
  return true;
}

/**
 * Saves a change to the card. Its subscribers hear about it once a run of
 * changes settles, and people picked into the description right away.
 */
export async function updateCard(
  board: Board,
  card: Card,
  changes: Partial<CardFields>,
  picked: ReadonlySet<string> = new Set()
): Promise<boolean> {
  if (!(await saveCard(board, card, changes))) {
    return false;
  }
  noteCardChange(board, card, changes);
  if (changes.description !== undefined) {
    await tellMentioned(card, changes.description, picked);
  }
  return true;
}

export function deleteCard(board: Board, card: Card): Promise<boolean> {
  return publish(tombstoneTemplate(board, card), card.event);
}

/**
 * The newest version of two cards' relation from anyone, undone or not, for
 * the next to follow even within the same second.
 */
function lastRelation(
  relation: Pick<BoardRelation, "from" | "to">
): NostrEvent | undefined {
  return latest(
    eventStore.getByFilters({
      "#d": [relationId(relation.from, relation.to)],
      kinds: [RELATION_KIND],
    })
  );
}

/**
 * Tells both cards' subscribers, once each card's run of changes settles,
 * how the cards were marked, or unmarked, as it reads from each.
 */
function noteRelation(
  relation: Pick<BoardRelation, "kind" | "from">,
  cards: readonly [RelatedCard, RelatedCard],
  removed: boolean,
  foldOnly = false
): void {
  const [a, b] = cards;
  for (const [item, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const ref = relatedRef(other);
    noteRelationChange(
      item.board,
      item.card,
      {
        added: removed ? [] : [ref],
        field: relationFrom(relation, placeOf(item)),
        removed: removed ? [ref] : [],
      },
      { foldOnly }
    );
  }
}

/**
 * Marks how a card stands to another of its project. Two cards stand one way
 * only, so a new way replaces the old; but blocking already relates them, so
 * cards that block stay so when marked related.
 */
export async function relateCards(
  relations: BoardRelation[],
  item: RelatedCard,
  other: RelatedCard,
  relation: Relation
): Promise<boolean> {
  const kind = relationKind(relation);
  const [from, to] = relation === "blockedBy" ? [other, item] : [item, other];
  const marked = { from: placeOf(from), kind, to: placeOf(to) };
  const existing = relations.find(
    ({ id }) => id === relationId(marked.from, marked.to)
  );
  if (
    existing &&
    (kind === "related" ||
      (existing.kind === kind && samePlace(existing.from, marked.from)))
  ) {
    return true;
  }
  if (!(await publish(relationTemplate(marked), lastRelation(marked)))) {
    return false;
  }
  if (existing) {
    // Related cards marked blocking were related all along: only a run of
    // changes that just related them is told otherwise.
    noteRelation(existing, [item, other], true, existing.kind === "related");
  }
  noteRelation(marked, [item, other], false);
  return true;
}

/** Undoes whatever relates two cards. */
export async function unrelateCards(
  pair: BoardRelation,
  item: RelatedCard,
  other: RelatedCard
): Promise<boolean> {
  if (
    !(await publish(
      relationTemplate(pair, { deleted: true }),
      lastRelation(pair)
    ))
  ) {
    return false;
  }
  noteRelation(pair, [item, other], true);
  return true;
}

function newSprint(number: number): SprintFields {
  return {
    id: newId(),
    number,
    status: "future",
    title: `Sprint ${number}`,
  };
}

export function createSprint(
  board: Board,
  content: BoardContent
): Promise<boolean> {
  return publish(sprintTemplate(board, newSprint(content.nextSprintNumber)));
}

export function updateSprint(
  board: Board,
  sprint: Sprint,
  changes: Partial<SprintFields>
): Promise<boolean> {
  return publish(
    sprintTemplate(board, { ...sprint, ...changes }),
    sprint.event
  );
}

/** The days a sprint runs, as `yyyy-MM-dd`. */
export interface SprintDates {
  start: string;
  end: string;
}

/** A sprint started now runs from today for the usual length. */
export function defaultSprintDates(): SprintDates {
  return { end: day(SPRINT_DAYS), start: day() };
}

/** The sprint given, or a new one if there's none, running on the dates given. */
function started(
  sprint: Sprint | undefined,
  content: BoardContent,
  dates: SprintDates
): SprintFields {
  return {
    ...(sprint ?? newSprint(content.nextSprintNumber)),
    ...dates,
    status: "active",
  };
}

export function startSprint(
  board: Board,
  sprint: Sprint | undefined,
  content: BoardContent
): Promise<boolean> {
  return publish(
    sprintTemplate(board, started(sprint, content, defaultSprintDates())),
    sprint?.event
  );
}

/** The sprint's cards still open, which move on when it ends. */
export function unfinishedCards(sprint: Sprint, content: BoardContent): Card[] {
  return content.cards.filter(
    (card) => card.sprint === sprint.id && !isClosed(card.status)
  );
}

/**
 * Ends the sprint, moving its open cards to the next one, those under way
 * back to where new cards start; closed cards stay with the ended one.
 */
function rollOver(
  board: Board,
  sprint: Sprint,
  content: BoardContent,
  next: string | undefined
): Promise<boolean>[] {
  return [
    ...unfinishedCards(sprint, content).map((card) =>
      saveCard(board, card, {
        sprint: next,
        ...(statusKind(card.status) === "started"
          ? { status: startingStatus(board.statuses) }
          : {}),
      })
    ),
    updateSprint(board, sprint, { status: "ended" }),
  ];
}

/** Open cards roll over to the next future sprint, made for them if there's none. */
export function endSprint(
  board: Board,
  sprint: Sprint,
  content: BoardContent
): Promise<boolean[]> {
  const changes: Promise<boolean>[] = [];
  let next = upcomingSprint(content)?.id;
  if (unfinishedCards(sprint, content).length > 0 && !next) {
    const created = newSprint(content.nextSprintNumber);
    next = created.id;
    changes.push(publish(sprintTemplate(board, created)));
  }
  changes.push(...rollOver(board, sprint, content, next));
  return Promise.all(changes);
}

/**
 * Ends the active sprint, if there is one, and starts the next on the dates
 * given, from today by default: the upcoming sprint, or a new one. Open cards
 * roll over into it.
 */
export function startNextSprint(
  board: Board,
  content: BoardContent,
  dates: SprintDates = defaultSprintDates()
): Promise<boolean[]> {
  const upcoming = upcomingSprint(content);
  const next = started(upcoming, content, dates);
  const current = activeSprint(content);
  return Promise.all([
    publish(sprintTemplate(board, next), upcoming?.event),
    ...(current ? rollOver(board, current, content, next.id) : []),
  ]);
}

export function deleteSprint(
  board: Board,
  sprint: Sprint,
  content: BoardContent
): Promise<boolean[]> {
  const cards = content.cards.filter((card) => card.sprint === sprint.id);
  return Promise.all([
    ...cards.map((card) => saveCard(board, card, { sprint: undefined })),
    publish(tombstoneTemplate(board, sprint), sprint.event),
  ]);
}

/**
 * A comment, told to everyone it mentions and every subscriber. Commenting
 * subscribes the commenter, so they hear the replies.
 */
export async function addComment(
  board: Board,
  card: Card,
  content: string
): Promise<boolean> {
  const me = accounts.active?.pubkey;
  if (!me) {
    return false;
  }
  const subscribers = cardSubscribers(board, card, subscriptionsOf, me);
  if (!(await publish(commentTemplate(card, content, subscribers)))) {
    return false;
  }
  if (!isSubscribed(card, me, subscriptionsOf(me))) {
    await setSubscribed(card, me, true);
  }
  return true;
}

/** Gives your comment new text; the newest edit goes after the one before it. */
export function editComment(
  comment: Comment,
  content: string
): Promise<boolean> {
  return publish(
    editCommentTemplate(comment, content),
    comment.edits.at(-1) ?? comment.event
  );
}

export function deleteComment(comment: Comment): Promise<boolean> {
  // An edit still at the signer has no id the relays know.
  const edits = comment.edits.filter((edit) => edit.sig !== "");
  return publish(deleteCommentTemplate({ ...comment, edits }));
}

/** Changes to one emoji on one card or comment, by `id:emoji`. */
const reactionChanges = new Map<string, Promise<boolean>>();

function changeReaction(
  target: ReactionTarget,
  emoji: string,
  reacted: boolean,
  me: string
): Promise<boolean> {
  const mine = eventStore
    .getByFilters({ ...target.filter, authors: [me] })
    .filter((event) => reactionEmoji(event) === emoji);
  if (reacted) {
    return mine.length > 0
      ? Promise.resolve(true)
      : publish(reactionTemplate(target.event, emoji));
  }
  const signed = mine.filter((event) => event.sig);
  return signed.length > 0
    ? publish(deleteReactionsTemplate(signed))
    : Promise.resolve(true);
}

/**
 * Reacts to a card or a comment with an emoji, or takes yours back. Changes
 * to the same emoji wait for the one before, so taking a reaction back right
 * away finds it signed.
 */
export async function setReaction(
  target: ReactionTarget,
  emoji: string,
  reacted: boolean
): Promise<boolean> {
  const me = accounts.active?.pubkey;
  if (!me) {
    return false;
  }
  const key = `${target.id}:${emoji}`;
  const before = reactionChanges.get(key);
  const done = (async () => {
    await before;
    return changeReaction(target, emoji, reacted, me);
  })();
  reactionChanges.set(key, done);
  try {
    return await done;
  } finally {
    if (reactionChanges.get(key) === done) {
      reactionChanges.delete(key);
    }
  }
}
