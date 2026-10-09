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

/**
 * Statuses in the order work moves through them, after Linear's. Their kind
 * says how far along that is: completed and canceled ones close the card.
 * Cards carry the label in their `s` tag, so a label is how other clients see it.
 */
export const STATUSES = [
  { id: "triage", kind: "triage", label: "Triage" },
  { id: "backlog", kind: "backlog", label: "Backlog" },
  { id: "todo", kind: "unstarted", label: "Todo" },
  { id: "progress", kind: "started", label: "In progress" },
  { id: "review", kind: "started", label: "In review" },
  { id: "done", kind: "completed", label: "Done" },
  { id: "canceled", kind: "canceled", label: "Canceled" },
  { id: "duplicate", kind: "canceled", label: "Duplicate" },
] as const;

export const PRIORITIES = [
  { id: "urgent", label: "Urgent" },
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
export type StatusKind = (typeof STATUSES)[number]["kind"];
export type Priority = (typeof PRIORITIES)[number]["id"];
export type Label = (typeof LABELS)[number];
export type SprintStatus = (typeof SPRINT_STATUSES)[number]["id"];

/** The statuses a new board uses until its creator picks others. */
export const DEFAULT_STATUSES: readonly Status[] = [
  "backlog",
  "todo",
  "progress",
  "done",
];

export interface Template {
  kind: number;
  content: string;
  tags: string[][];
}

/** Who's on a board or project: members edit it, viewers can only read it. */
export interface Membership {
  /** The creator first. */
  members: string[];
  viewers: string[];
}

export interface Board extends Membership {
  id: string;
  address: string;
  creator: string;
  code: string;
  title: string;
  description: string;
  /**
   * The statuses the board uses, in order. The others stay out of its columns
   * and pickers, unless a card is in one.
   */
  statuses: Status[];
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
/** The role on a `p` tag of someone who can only read the board or project. */
const VIEWER = "viewer";
export const CODE = /^[A-Z][A-Z0-9]{0,9}$/u;
/** Codes taken by app pages, which share the top-level path with boards. */
export const RESERVED_CODES: ReadonlySet<string> = new Set(["INBOX", "MAP"]);

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

/**
 * Members and viewers from a board or project's `p` tags, with the creator as
 * the first member. A viewer's tag carries the role after the relay hint, as
 * in NIP-53: `["p", pubkey, "", "viewer"]`.
 */
export function parseMembership(event: NostrEvent): Membership {
  const members = new Set([event.pubkey]);
  const viewers = new Set<string>();
  for (const [name, pubkey, , role] of event.tags) {
    if (name === "p" && isPubkey(pubkey)) {
      (role === VIEWER ? viewers : members).add(pubkey);
    }
  }
  return {
    members: [...members],
    viewers: [...viewers].filter((viewer) => !members.has(viewer)),
  };
}

/** `p` tags for everyone but the creator, who is the event's author. */
export function membershipTags(
  creator: string,
  { members, viewers }: Membership
): string[][] {
  const others = (people: string[]) =>
    people.filter((person) => person !== creator);
  return [
    ...others(members).map((member) => ["p", member]),
    ...others(viewers)
      .filter((viewer) => !members.includes(viewer))
      .map((viewer) => ["p", viewer, "", VIEWER]),
  ];
}

/** Whether the person may change what's in a board or project, not just read it. */
export function canEdit(
  { members }: Pick<Membership, "members">,
  pubkey: string
): boolean {
  return members.includes(pubkey);
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

const STATUS_KINDS = Object.fromEntries(
  STATUSES.map(({ id, kind }) => [id, kind])
) as Record<Status, StatusKind>;

export function statusKind(status: Status): StatusKind {
  return STATUS_KINDS[status];
}

/** Whether the card is finished with: done, or dropped as canceled or a duplicate. */
export function isClosed(status: Status): boolean {
  const kind = statusKind(status);
  return kind === "completed" || kind === "canceled";
}

export function priorityLabel(priority: Priority): string {
  return PRIORITIES.find(({ id }) => id === priority)?.label ?? priority;
}

/** Lowercase without spaces, so "To do", as cards used to say, reads as todo. */
function statusWord(value: string): string {
  return value.toLowerCase().replaceAll(/\s+/gu, "");
}

function findStatus(value: string | undefined): Status | undefined {
  const needle = value === undefined ? "" : statusWord(value);
  return STATUSES.find(
    ({ id, label }) => id === needle || statusWord(label) === needle
  )?.id;
}

function parseStatus(value: string | undefined): Status {
  return findStatus(value) ?? "todo";
}

/** The statuses given, in the order work moves through them. */
export function inStatusOrder(statuses: Iterable<Status>): Status[] {
  const picked = new Set(statuses);
  return STATUSES.flatMap(({ id }) => (picked.has(id) ? [id] : []));
}

/**
 * The statuses a board's `col` tags name, by id or by label. Columns this app
 * has no status for are left out; a board naming none uses the defaults.
 */
function parseStatuses(event: NostrEvent): Status[] {
  const named = event.tags.flatMap(([name, id, label]) => {
    const status =
      name === "col" ? (findStatus(id) ?? findStatus(label)) : undefined;
    return status ? [status] : [];
  });
  return named.length > 0 ? inStatusOrder(named) : [...DEFAULT_STATUSES];
}

/**
 * Whether a board could work with these statuses: an open one for new cards to
 * start in, and a closed one for them to finish in.
 */
export function workableStatuses(statuses: readonly Status[]): boolean {
  return (
    statuses.some((status) => !isClosed(status)) && statuses.some(isClosed)
  );
}

/** Where a new card starts: todo, else backlog, else the first open status. */
export function startingStatus(statuses: readonly Status[]): Status {
  const open = statuses.filter((status) => !isClosed(status));
  return (
    open.find((status) => statusKind(status) === "unstarted") ??
    open.find((status) => statusKind(status) === "backlog") ??
    open[0] ??
    "todo"
  );
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
  return {
    ...parseMembership(event),
    address: boardAddress(event.pubkey, id),
    code,
    creator: event.pubkey,
    description: getTagValue(event, "description") ?? "",
    event,
    id,
    project: addressOf(event, PROJECT_KIND),
    statuses: parseStatuses(event),
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
    | "id"
    | "code"
    | "title"
    | "description"
    | "members"
    | "viewers"
    | "creator"
    | "project"
    | "statuses"
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
      // A column per status the board uses, as the kanban NIP has them.
      ...inStatusOrder(board.statuses).map((status, index) => [
        "col",
        status,
        statusLabel(status),
        String(index),
      ]),
      ...membershipTags(board.creator, board),
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
