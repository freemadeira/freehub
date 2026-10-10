import { unixNow } from "applesauce-core/helpers/time";
import { addDays, format } from "date-fns";

import { descriptionMentionTemplate } from "@/lib/card-activity";
import { noteCardChange, tellChanges } from "@/lib/card-changes";
import { mentionedPubkeys } from "@/lib/mentions";
import type {
  Board,
  BoardContent,
  Card,
  CardFields,
  CardRef,
  Comment,
  Sprint,
  SprintFields,
} from "@/lib/model";
import {
  boardTemplate,
  cardTemplate,
  commentTemplate,
  deleteBoardTemplate,
  deleteCommentTemplate,
  isClosed,
  newId,
  sprintTemplate,
  startingStatus,
  statusKind,
  tombstoneTemplate,
  upcomingSprint,
} from "@/lib/model";
import { accounts } from "@/lib/nostr";
import type { Project, ProjectFields } from "@/lib/project";
import { deleteProjectTemplate, projectTemplate } from "@/lib/project";
import { publish } from "@/lib/publish";
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

export function updateBoard(
  board: Board,
  changes: Partial<BoardDraft>
): Promise<boolean> {
  return publish(boardTemplate({ ...board, ...changes }), board.event);
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

/** Saves the card as is, telling no one: for changes made in bulk, like ending a sprint. */
function saveCard(
  board: Board,
  card: Card,
  changes: Partial<CardFields>
): Promise<boolean> {
  return publish(cardTemplate(board, { ...card, ...changes }), card.event);
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

export function startSprint(
  board: Board,
  sprint: Sprint | undefined,
  content: BoardContent
): Promise<boolean> {
  const dates = {
    end: day(SPRINT_DAYS),
    start: day(),
    status: "active",
  } as const;
  if (!sprint) {
    return publish(
      sprintTemplate(board, {
        ...newSprint(content.nextSprintNumber),
        ...dates,
      })
    );
  }
  return updateSprint(board, sprint, dates);
}

/**
 * Open cards roll over to the next future sprint, those under way back to
 * where new cards start; closed cards stay with the ended one.
 */
export function endSprint(
  board: Board,
  sprint: Sprint,
  content: BoardContent
): Promise<boolean[]> {
  const unfinished = content.cards.filter(
    (card) => card.sprint === sprint.id && !isClosed(card.status)
  );
  const changes: Promise<boolean>[] = [];
  let next = upcomingSprint(content)?.id;
  if (unfinished.length > 0 && !next) {
    const created = newSprint(content.nextSprintNumber);
    next = created.id;
    changes.push(publish(sprintTemplate(board, created)));
  }
  for (const card of unfinished) {
    changes.push(
      saveCard(board, card, {
        sprint: next,
        ...(statusKind(card.status) === "started"
          ? { status: startingStatus(board.statuses) }
          : {}),
      })
    );
  }
  changes.push(updateSprint(board, sprint, { status: "ended" }));
  return Promise.all(changes);
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

export function deleteComment(comment: Comment): Promise<boolean> {
  return publish(deleteCommentTemplate(comment));
}
