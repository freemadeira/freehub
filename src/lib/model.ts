import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";

import { mentionedPubkeys } from "@/lib/mentions";

export const BOARD_KIND = 30_301;
export const CARD_KIND = 30_302;
export const SPRINT_KIND = 30_303;
export const PROJECT_KIND = 30_304;
export const CRM_TABLE_KIND = 30_305;
export const CRM_RECORD_KIND = 30_306;
export const DOC_PAGE_KIND = 30_307;
export const COMMENT_KIND = 1111;
export const DELETE_KIND = 5;

export const STATUSES = [
  { id: "todo", label: "To do" },
  { id: "progress", label: "In progress" },
  { id: "done", label: "Done" },
] as const;

export const PRIORITIES = [
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
] as const;

export const SPRINT_STATUSES = [
  { id: "future" },
  { id: "active" },
  { id: "ended" },
] as const;

export const LABELS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
] as const;

export type Status = (typeof STATUSES)[number]["id"];
export type Priority = (typeof PRIORITIES)[number]["id"];
export type Label = (typeof LABELS)[number];
export type SprintStatus = (typeof SPRINT_STATUSES)[number]["id"];

export interface Template {
  kind: number;
  content: string;
  tags: string[][];
}

export interface Board {
  id: string;
  address: string;
  creator: string;
  code: string;
  title: string;
  description: string;
  members: string[];
  /** Address of the project the board belongs to, if any. */
  project?: string;
  event: NostrEvent;
}

export interface CardFields {
  id: string;
  number?: number;
  title: string;
  description: string;
  status: Status;
  rank: number;
  assignees: string[];
  priority?: Priority;
  due?: string;
  labels: Label[];
  sprint?: string;
}

export type Card = CardFields & { author: string; event: NostrEvent };

export interface SprintFields {
  id: string;
  number: number;
  title: string;
  status: SprintStatus;
  start?: string;
  end?: string;
}

export type Sprint = SprintFields & { event: NostrEvent };

export interface BoardContent {
  cards: Card[];
  sprints: Sprint[];
  nextNumber: number;
  nextSprintNumber: number;
  /** Numbers on more than one card, since each device picks them on its own. */
  sharedNumbers: ReadonlySet<number>;
}

export interface Comment {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  event: NostrEvent;
}

const HEX_KEY = /^[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const ID_BYTES = 8;
export const CODE = /^[A-Z][A-Z0-9]{0,9}$/u;
/** Codes taken by app pages, which share the top-level path with boards. */
export const RESERVED_CODES: ReadonlySet<string> = new Set(["INBOX"]);

/**
 * A random `d` tag. Relays built on fiatjaf/eventstore (Haven, most khatru
 * relays) don't index tag values over 100 characters, so this keeps an address
 * pointing at it (`kind:pubkey:d`, 87 characters) findable with `#a` queries.
 */
export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(ID_BYTES)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function isPubkey(value: string | undefined): value is string {
  return value !== undefined && HEX_KEY.test(value);
}

export function integer(value: string | undefined): number | undefined {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function date(value: string | undefined): string | undefined {
  return value && DATE.test(value) ? value : undefined;
}

function oneOf<T extends string>(
  options: readonly { id: T }[],
  value: string | undefined
): T | undefined {
  return options.find(({ id }) => id === value)?.id;
}

export function isDeleted(event: NostrEvent): boolean {
  return event.tags.some(([name]) => name === "deleted");
}

/** The `d` part of an `a` tag pointing at the given kind, e.g. a card's board. */
export function addressedId(
  event: NostrEvent,
  kind: number
): string | undefined {
  const prefix = `${kind}:`;
  const value = event.tags.find(
    ([name, address]) => name === "a" && address?.startsWith(prefix)
  )?.[1];
  return value?.split(":").slice(2).join(":") || undefined;
}

/** The full `a` tag pointing at the given kind, e.g. a card's board address. */
export function addressOf(event: NostrEvent, kind: number): string | undefined {
  const prefix = `${kind}:`;
  return event.tags.find(
    ([name, address]) => name === "a" && address?.startsWith(prefix)
  )?.[1];
}

export function statusLabel(status: Status): string {
  return STATUSES.find(({ id }) => id === status)?.label ?? status;
}

function parseStatus(value: string | undefined): Status {
  const needle = value?.trim().toLowerCase();
  const match = STATUSES.find(
    ({ id, label }) => id === needle || label.toLowerCase() === needle
  );
  return match?.id ?? "todo";
}

export function cardKey(board: Board, card: Card): string {
  return card.number === undefined
    ? board.code
    : `${board.code}-${card.number}`;
}

export function activeSprint(content: BoardContent): Sprint | undefined {
  return content.sprints.findLast((sprint) => sprint.status === "active");
}

export function upcomingSprint(content: BoardContent): Sprint | undefined {
  return content.sprints.find((sprint) => sprint.status === "future");
}

export function boardAddress(creator: string, id: string): string {
  return `${BOARD_KIND}:${creator}:${id}`;
}

/** Whether `a` wins over `b` as the newest version: later, or the lower id on a tie. */
export function newer(a: NostrEvent, b: NostrEvent): boolean {
  return (
    a.created_at > b.created_at ||
    (a.created_at === b.created_at && a.id < b.id)
  );
}

export function nextCreatedAt(previous?: NostrEvent): number {
  return previous ? Math.max(unixNow(), previous.created_at + 1) : unixNow();
}

export function rankBetween(before?: number, after?: number): number {
  if (before === undefined) {
    return after === undefined ? 1 : after - 1;
  }
  return after === undefined ? before + 1 : (before + after) / 2;
}

export function parseBoard(event: NostrEvent): Board | undefined {
  const id = getTagValue(event, "d");
  const code = getTagValue(event, "code")?.toUpperCase();
  if (!id || !code || !CODE.test(code)) {
    return undefined;
  }
  const members = new Set(
    event.tags.flatMap(([name, value]) =>
      name === "p" && isPubkey(value) ? [value] : []
    )
  );
  members.delete(event.pubkey);
  return {
    address: boardAddress(event.pubkey, id),
    code,
    creator: event.pubkey,
    description: getTagValue(event, "description") ?? "",
    event,
    id,
    members: [event.pubkey, ...members],
    project: addressOf(event, PROJECT_KIND),
    title: getTagValue(event, "title") ?? code,
  };
}

function parseCard(event: NostrEvent, id: string): Card {
  return {
    assignees: [
      ...new Set(
        event.tags.flatMap(([name, value]) =>
          name === "p" && isPubkey(value) ? [value] : []
        )
      ),
    ],
    author: event.pubkey,
    description: getTagValue(event, "description") ?? event.content,
    due: date(getTagValue(event, "due")),
    event,
    id,
    labels: LABELS.filter((label) =>
      event.tags.some(([name, value]) => name === "label" && value === label)
    ),
    number: integer(getTagValue(event, "number")),
    priority: oneOf(PRIORITIES, getTagValue(event, "priority")),
    rank: Number(getTagValue(event, "rank")) || 0,
    sprint: getTagValue(event, "sprint"),
    status: parseStatus(getTagValue(event, "s")),
    title: getTagValue(event, "title") ?? "",
  };
}

function parseSprint(event: NostrEvent, id: string): Sprint {
  const number = integer(getTagValue(event, "number")) ?? 0;
  return {
    end: date(getTagValue(event, "end")),
    event,
    id,
    number,
    start: date(getTagValue(event, "start")),
    status: oneOf(SPRINT_STATUSES, getTagValue(event, "status")) ?? "future",
    title: getTagValue(event, "title") ?? `Sprint ${number}`,
  };
}

export function parseComment(event: NostrEvent): Comment {
  return {
    author: event.pubkey,
    content: event.content,
    createdAt: event.created_at,
    event,
    id: event.id,
  };
}

// Every member may write any card or sprint: the newest version across authors wins.
export function latestVersions(
  events: NostrEvent[],
  kind: number,
  authors: Set<string>
): Map<string, NostrEvent> {
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    const id = getTagValue(event, "d");
    if (event.kind !== kind || !id || !authors.has(event.pubkey)) {
      continue;
    }
    const current = latest.get(id);
    if (!current || newer(event, current)) {
      latest.set(id, event);
    }
  }
  return latest;
}

/** One card's newest version on the board, unless it was deleted. */
export function resolveCard(
  board: Board,
  events: NostrEvent[],
  id: string
): Card | undefined {
  const versions = events.filter(
    (event) =>
      getTagValue(event, "d") === id &&
      addressOf(event, BOARD_KIND) === board.address
  );
  const event = latestVersions(versions, CARD_KIND, new Set(board.members)).get(
    id
  );
  return event && !isDeleted(event) ? parseCard(event, id) : undefined;
}

function highestNumber(events: Iterable<NostrEvent>): number {
  let highest = 0;
  for (const event of events) {
    highest = Math.max(highest, integer(getTagValue(event, "number")) ?? 0);
  }
  return highest;
}

function findSharedNumbers(cards: Card[]): Set<number> {
  const seen = new Set<number>();
  const shared = new Set<number>();
  for (const { number } of cards) {
    if (number !== undefined) {
      (seen.has(number) ? shared : seen).add(number);
    }
  }
  return shared;
}

export function resolveBoard(board: Board, events: NostrEvent[]): BoardContent {
  const authors = new Set(board.members);
  const cardVersions = latestVersions(events, CARD_KIND, authors);
  const sprintVersions = latestVersions(events, SPRINT_KIND, authors);
  const cards = [...cardVersions]
    .filter(([, event]) => !isDeleted(event))
    .map(([id, event]) => parseCard(event, id))
    .toSorted((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const sprints = [...sprintVersions]
    .filter(([, event]) => !isDeleted(event))
    .map(([id, event]) => parseSprint(event, id))
    .toSorted((a, b) => a.number - b.number);
  return {
    cards,
    nextNumber:
      highestNumber(
        events.filter(
          (event) => event.kind === CARD_KIND && authors.has(event.pubkey)
        )
      ) + 1,
    nextSprintNumber: highestNumber(sprintVersions.values()) + 1,
    sharedNumbers: findSharedNumbers(cards),
    sprints,
  };
}

/** Whether the card's number alone can't tell it apart on the board. */
export function needsCardId(content: BoardContent, card: Card): boolean {
  return card.number === undefined || content.sharedNumbers.has(card.number);
}

export function boardTemplate(
  board: Pick<
    Board,
    "id" | "code" | "title" | "description" | "members" | "creator" | "project"
  >
): Template {
  return {
    content: "",
    kind: BOARD_KIND,
    tags: [
      ["d", board.id],
      ["title", board.title],
      ["description", board.description],
      ["code", board.code],
      ...STATUSES.map(({ id, label }, index) => [
        "col",
        id,
        label,
        String(index),
      ]),
      ...board.members
        .filter((member) => member !== board.creator)
        .map((member) => ["p", member]),
      ...(board.project ? [["a", board.project]] : []),
      ["alt", `Kanban board: ${board.title}`],
    ],
  };
}

export function cardTemplate(board: Board, card: CardFields): Template {
  const tags = [
    ["d", card.id],
    ["a", board.address],
    ["title", card.title],
    ["description", card.description],
    ["s", statusLabel(card.status)],
    ["rank", String(card.rank)],
  ];
  if (card.number !== undefined) {
    tags.push(["number", String(card.number)]);
  }
  for (const assignee of card.assignees) {
    tags.push(["p", assignee]);
  }
  if (card.priority) {
    tags.push(["priority", card.priority]);
  }
  if (card.due) {
    tags.push(["due", card.due]);
  }
  if (card.sprint) {
    tags.push(["sprint", card.sprint]);
  }
  for (const label of card.labels) {
    tags.push(["label", label]);
  }
  tags.push(["alt", `Kanban card: ${card.title}`]);
  return { content: "", kind: CARD_KIND, tags };
}

export function sprintTemplate(board: Board, sprint: SprintFields): Template {
  const tags = [
    ["d", sprint.id],
    ["a", board.address],
    ["title", sprint.title],
    ["number", String(sprint.number)],
    ["status", sprint.status],
  ];
  if (sprint.start) {
    tags.push(["start", sprint.start]);
  }
  if (sprint.end) {
    tags.push(["end", sprint.end]);
  }
  tags.push(["alt", `Sprint: ${sprint.title}`]);
  return { content: "", kind: SPRINT_KIND, tags };
}

export function tombstoneTemplate(board: Board, item: Card | Sprint): Template {
  const tags = [["d", item.id], ["a", board.address], ["deleted"]];
  if (item.number !== undefined) {
    tags.push(["number", String(item.number)]);
  }
  return { content: "", kind: item.event.kind, tags };
}

/** A NIP-22 comment on a card, with a `p` tag for everyone it mentions. */
export function commentTemplate(card: Card, content: string): Template {
  const address = `${CARD_KIND}:${card.author}:${card.id}`;
  const mentioned = mentionedPubkeys(content).filter(
    (pubkey) => pubkey !== card.author
  );
  return {
    content,
    kind: COMMENT_KIND,
    tags: [
      ["A", address],
      ["K", String(CARD_KIND)],
      ["P", card.author],
      ["a", address],
      ["k", String(CARD_KIND)],
      ["p", card.author],
      ...mentioned.map((pubkey) => ["p", pubkey]),
    ],
  };
}

export function deleteBoardTemplate(board: Board): Template {
  return {
    content: "",
    kind: DELETE_KIND,
    tags: [
      ["a", board.address],
      ["k", String(BOARD_KIND)],
    ],
  };
}

export function deleteCommentTemplate(comment: Comment): Template {
  return {
    content: "",
    kind: DELETE_KIND,
    tags: [
      ["e", comment.id],
      ["k", String(COMMENT_KIND)],
    ],
  };
}

export function cardCommentAddresses(board: Board, card: Card): string[] {
  return board.members.map((member) => `${CARD_KIND}:${member}:${card.id}`);
}
