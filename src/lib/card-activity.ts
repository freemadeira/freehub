/**
 * What happens to a card is kept on it as NIP-22 comments tagged `activity`.
 * Its history then reads back in order, other Nostr clients show it as text,
 * and the relay routes it with `#p`, as it routes comments, to whoever
 * subscribes to the card. No browser APIs here: the notifier reads them too.
 */
import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import { mentionReference } from "@/lib/mentions";
import type {
  CardFields,
  CardPlace,
  CardRef,
  Priority,
  Relation,
  Status,
  Template,
} from "@/lib/model";
import {
  BOARD_KIND,
  CARD_KIND,
  commentPeopleTags,
  COMMENT_KIND,
  date,
  isPubkey,
  isRelation,
  PRIORITIES,
  priorityLabel,
  RELATIONS,
  samePlace,
  STATUSES,
  statusLabel,
} from "@/lib/model";

/** Someone changed some of the card's properties. */
export const CHANGE = "change";
/** Someone picked people from the "@" list in the card's description. */
export const DESCRIPTION_MENTION = "mention";

/**
 * The card at the other end of a relation, as a change names it: where it is,
 * and its key and title then, should it be renamed or deleted later.
 */
export interface RelatedRef extends CardPlace {
  key: string;
  title: string;
}

/** Cards marked, or no longer marked, as standing to this one in one way. */
export interface RelationChange {
  field: Relation;
  added: RelatedRef[];
  removed: RelatedRef[];
}

export type CardChange =
  | { field: "status"; from?: Status; to: Status }
  | { field: "assignees"; added: string[]; removed: string[] }
  | { field: "priority"; from?: Priority; to?: Priority }
  | { field: "due"; from?: string; to?: string }
  | { field: "title"; from: string; to: string }
  | RelationChange;

/** How marking reads for each relation, and unmarking, after who did it. */
export const RELATION_WORDS: Record<
  Relation,
  { added: string; removed: string }
> = {
  blockedBy: {
    added: "marked it as blocked by",
    removed: "marked it as no longer blocked by",
  },
  blocking: {
    added: "marked it as blocking",
    removed: "marked it as no longer blocking",
  },
  related: {
    added: "marked it as related to",
    removed: "removed its relation to",
  },
};

export type ChangeOf<Field extends CardChange["field"]> = Extract<
  CardChange,
  { field: Field }
>;

export interface CardActivity {
  id: string;
  author: string;
  createdAt: number;
  event: NostrEvent;
  /** What changed; empty for a mention. */
  changes: CardChange[];
  /** Who was mentioned in the description; empty for a change. */
  mentioned: string[];
}

/** The fields whose changes are kept, in the order they're told. */
type Tracked = Pick<
  CardFields,
  "status" | "assignees" | "priority" | "due" | "title"
>;

/** What changed from one version of the card to the next, if anything. */
export function cardChanges(before: Tracked, after: Tracked): CardChange[] {
  const changes: CardChange[] = [];
  if (before.status !== after.status) {
    changes.push({ field: "status", from: before.status, to: after.status });
  }
  const added = after.assignees.filter(
    (pubkey) => !before.assignees.includes(pubkey)
  );
  const removed = before.assignees.filter(
    (pubkey) => !after.assignees.includes(pubkey)
  );
  if (added.length > 0 || removed.length > 0) {
    changes.push({ added, field: "assignees", removed });
  }
  if (before.priority !== after.priority) {
    changes.push({
      field: "priority",
      from: before.priority,
      to: after.priority,
    });
  }
  if (before.due !== after.due) {
    changes.push({ field: "due", from: before.due, to: after.due });
  }
  if (before.title !== after.title) {
    changes.push({ field: "title", from: before.title, to: after.title });
  }
  return changes;
}

function without(people: string[], gone: string[]): string[] {
  return people.filter((pubkey) => !gone.includes(pubkey));
}

function withoutCards(cards: RelatedRef[], gone: RelatedRef[]): RelatedRef[] {
  return cards.filter((card) => !gone.some((other) => samePlace(other, card)));
}

/** The cards, once each. */
function eachCard(cards: RelatedRef[]): RelatedRef[] {
  return cards.filter(
    (card, index) =>
      cards.findIndex((other) => samePlace(other, card)) === index
  );
}

export function isRelationChange(change: CardChange): change is RelationChange {
  return isRelation(change.field);
}

/** Two changes to the same field, one after the other, as one. */
function merge(first: CardChange, then: CardChange): CardChange {
  if (
    isRelationChange(first) &&
    isRelationChange(then) &&
    first.field === then.field
  ) {
    // A card marked then unmarked, or the other way round, drops out.
    return {
      added: eachCard([
        ...withoutCards(first.added, then.removed),
        ...withoutCards(then.added, first.removed),
      ]),
      field: then.field,
      removed: eachCard([
        ...withoutCards(first.removed, then.added),
        ...withoutCards(then.removed, first.added),
      ]),
    };
  }
  if (first.field === "assignees" && then.field === "assignees") {
    return {
      added: [
        ...new Set([
          ...without(first.added, then.removed),
          ...without(then.added, first.removed),
        ]),
      ],
      field: "assignees",
      removed: [
        ...new Set([
          ...without(first.removed, then.added),
          ...without(then.removed, first.added),
        ]),
      ],
    };
  }
  if (first.field === "status" && then.field === "status") {
    return { ...then, from: first.from };
  }
  if (first.field === "priority" && then.field === "priority") {
    return { ...then, from: first.from };
  }
  if (first.field === "due" && then.field === "due") {
    return { ...then, from: first.from };
  }
  if (first.field === "title" && then.field === "title") {
    return { ...then, from: first.from };
  }
  return then;
}

function changesSomething(change: CardChange): boolean {
  return change.field === "assignees" || isRelationChange(change)
    ? change.added.length > 0 || change.removed.length > 0
    : change.from !== change.to;
}

/**
 * Changes made one after another, as what they came to: a priority set twice
 * is set once, and someone assigned then unassigned drops out.
 */
export function foldChanges(changes: CardChange[]): CardChange[] {
  const folded = new Map<CardChange["field"], CardChange>();
  for (const change of changes) {
    const earlier = folded.get(change.field);
    folded.set(change.field, earlier ? merge(earlier, change) : change);
  }
  return [...folded.values()].filter(changesSomething);
}

/**
 * One `change` tag per value: field, from, to, with "" for none. A related
 * card goes by its `d` tag, followed by its board, key and title.
 */
function changeTags(change: CardChange): string[][] {
  if (change.field === "assignees") {
    return [
      ...change.added.map((pubkey) => ["change", "assignee", "", pubkey]),
      ...change.removed.map((pubkey) => ["change", "assignee", pubkey, ""]),
    ];
  }
  if (isRelationChange(change)) {
    const named = ({ board, key, title }: RelatedRef) => [board, key, title];
    return [
      ...change.added.map((card) => [
        "change",
        change.field,
        "",
        card.card,
        ...named(card),
      ]),
      ...change.removed.map((card) => [
        "change",
        change.field,
        card.card,
        "",
        ...named(card),
      ]),
    ];
  }
  return [["change", change.field, change.from ?? "", change.to ?? ""]];
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What the change says, for other Nostr clients, which show it as a comment. */
function changeText(change: CardChange): string {
  if (isRelationChange(change)) {
    const words = RELATION_WORDS[change.field];
    // By key alone: whoever reads this card may not be on the other's board.
    const named = (cards: RelatedRef[]) =>
      cards.map(({ key }) => key).join(", ");
    return [
      ...(change.added.length > 0
        ? [`${upperFirst(words.added)} ${named(change.added)}`]
        : []),
      ...(change.removed.length > 0
        ? [`${upperFirst(words.removed)} ${named(change.removed)}`]
        : []),
    ].join("\n");
  }
  switch (change.field) {
    case "status": {
      return `Moved to ${statusLabel(change.to)}`;
    }
    case "assignees": {
      return [
        ...change.added.map((pubkey) => `Assigned ${mentionReference(pubkey)}`),
        ...change.removed.map(
          (pubkey) => `Unassigned ${mentionReference(pubkey)}`
        ),
      ].join("\n");
    }
    case "priority": {
      return change.to
        ? `Set the priority to ${priorityLabel(change.to)}`
        : "Removed the priority";
    }
    case "due": {
      return change.to
        ? `Set the due date to ${change.to}`
        : "Removed the due date";
    }
    default: {
      return `Renamed to “${change.to}”`;
    }
  }
}

/** NIP-22 tags pointing at the card, as its comments carry them. */
function threadTags(card: CardRef): string[][] {
  const address = `${CARD_KIND}:${card.author}:${card.id}`;
  return [
    ["A", address],
    ["K", String(CARD_KIND)],
    ["P", card.author],
    ["a", address],
    ["k", String(CARD_KIND)],
  ];
}

/**
 * Changes to the card, told to its subscribers. Anyone assigned or
 * unassigned hears of it too, whether they subscribe or not.
 */
export function cardChangeTemplate(
  card: CardRef,
  changes: CardChange[],
  subscribers: string[]
): Template {
  const assigned = changes.flatMap((change) =>
    change.field === "assignees" ? [...change.added, ...change.removed] : []
  );
  return {
    content: changes.map(changeText).join("\n"),
    kind: COMMENT_KIND,
    tags: [
      ...threadTags(card),
      ...commentPeopleTags(card.author, [], [...subscribers, ...assigned]),
      ["activity", CHANGE],
      ...changes.flatMap(changeTags),
    ],
  };
}

/** People just picked from the "@" list in the card's description. */
export function descriptionMentionTemplate(
  card: CardRef,
  mentioned: string[]
): Template {
  return {
    content: `Mentioned ${mentioned.map(mentionReference).join(", ")} in the description`,
    kind: COMMENT_KIND,
    tags: [
      ...threadTags(card),
      ...commentPeopleTags(card.author, mentioned, []),
      ["activity", DESCRIPTION_MENTION],
    ],
  };
}

export function isCardActivity(event: NostrEvent): boolean {
  return getTagValue(event, "activity") !== undefined;
}

function oneOf<T extends string>(
  options: readonly { id: T }[],
  value: string | undefined
): T | undefined {
  return options.find(({ id }) => id === value)?.id;
}

/** A relation tag's card, from its `d` tag and the board, key and title after it. */
function relatedRef(
  card: string,
  [board = "", key = "", title = ""]: string[]
): RelatedRef | undefined {
  return card && board.startsWith(`${BOARD_KIND}:`)
    ? { board, card, key, title }
    : undefined;
}

function parseChanges(event: NostrEvent): CardChange[] {
  const changes: CardChange[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const relations = new Map<Relation, RelationChange>();
  for (const [name, field, from = "", to = "", ...named] of event.tags) {
    if (name !== "change") {
      continue;
    }
    if (isRelation(field)) {
      const change = relations.get(field) ?? { added: [], field, removed: [] };
      const card = relatedRef(to || from, named);
      if (card) {
        (to ? change.added : change.removed).push(card);
        relations.set(field, change);
      }
    } else if (field === "assignee") {
      if (isPubkey(to)) {
        added.push(to);
      } else if (isPubkey(from)) {
        removed.push(from);
      }
    } else if (field === "status") {
      const next = oneOf(STATUSES, to);
      if (next) {
        changes.push({ field, from: oneOf(STATUSES, from), to: next });
      }
    } else if (field === "priority") {
      changes.push({
        field,
        from: oneOf(PRIORITIES, from),
        to: oneOf(PRIORITIES, to),
      });
    } else if (field === "due") {
      changes.push({ field, from: date(from), to: date(to) });
    } else if (field === "title") {
      changes.push({ field, from, to });
    }
  }
  if (added.length > 0 || removed.length > 0) {
    changes.push({ added, field: "assignees", removed });
  }
  changes.push(...relations.values());
  const order = [
    "status",
    "assignees",
    "priority",
    "due",
    "title",
    ...RELATIONS.map(({ id }) => id),
  ];
  return changes.toSorted(
    (a, b) => order.indexOf(a.field) - order.indexOf(b.field)
  );
}

/** The activity an event records, or nothing for a plain comment. */
export function parseCardActivity(event: NostrEvent): CardActivity | undefined {
  const type = getTagValue(event, "activity");
  if (type !== CHANGE && type !== DESCRIPTION_MENTION) {
    return undefined;
  }
  const mentioned =
    type === DESCRIPTION_MENTION
      ? event.tags.flatMap(([name, pubkey]) =>
          name === "p" &&
          isPubkey(pubkey) &&
          event.content.includes(mentionReference(pubkey))
            ? [pubkey]
            : []
        )
      : [];
  const changes = type === CHANGE ? parseChanges(event) : [];
  if (changes.length === 0 && mentioned.length === 0) {
    return undefined;
  }
  return {
    author: event.pubkey,
    changes,
    createdAt: event.created_at,
    event,
    id: event.id,
    mentioned,
  };
}
