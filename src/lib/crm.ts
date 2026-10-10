import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import { mentionedPubkeys, mentionReference } from "@/lib/mentions";
import type { Comment, Template } from "@/lib/model";
import {
  addressedId,
  COMMENT_KIND,
  commentPeopleTags,
  CRM_RECORD_KIND,
  CRM_TABLE_KIND,
  integer,
  isDeleted,
  isPubkey,
  latestVersions,
} from "@/lib/model";
import type { Color } from "@/lib/palette";
import { parseColor } from "@/lib/palette";
import type { Project } from "@/lib/project";
import { slugify, uniqueSlug } from "@/lib/project";

export const FIELD_TYPES = [
  "title",
  "text",
  "longtext",
  "number",
  "currency",
  "select",
  "multiselect",
  "stage",
  "date",
  "checkbox",
  "email",
  "phone",
  "url",
  "location",
  "member",
  "relation",
] as const;

export const STAGE_KINDS = ["open", "won", "lost"] as const;

export const TABLE_ICONS = [
  "table",
  "store",
  "building",
  "users",
  "handshake",
  "coins",
  "bitcoin",
  "map",
  "calendar",
  "heart",
  "star",
  "briefcase",
] as const;

export const CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "BRL",
  "BTC",
  "SATS",
] as const;

export const ACTIVITY_TYPES = [
  { id: "note", label: "Note" },
  { id: "call", label: "Call" },
  { id: "email", label: "Email" },
  { id: "meeting", label: "Meeting" },
  { id: "visit", label: "Visit" },
  { id: "message", label: "Message" },
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];
export type StageKind = (typeof STAGE_KINDS)[number];
export type TableIcon = (typeof TABLE_ICONS)[number];
export type Currency = (typeof CURRENCIES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number]["id"];

/** Table links that project pages use for themselves, like `/p/:project/docs`. */
export const RESERVED_TABLE_SLUGS: readonly string[] = ["docs", "drive"];
/** Every table has exactly one title field, always first. */
export const TITLE_FIELD = "title";
/** Stage history kept on each record, oldest dropped first. */
const MAX_MOVES = 100;

export interface FieldOption {
  id: string;
  label: string;
  color: Color;
  /** Only meaningful on stage fields: where the journey ends up. */
  kind: StageKind;
}

export interface Field {
  id: string;
  type: FieldType;
  name: string;
  options: FieldOption[];
  /** Currency code for currency fields, target table id for relations. */
  config: string;
}

/** A connector's source feeding records into a table, and where its data goes. */
export interface Connection {
  /** The connector's pubkey. */
  connector: string;
  /** The `d` tag of the connector's source manifest. */
  source: string;
  /** Attribute id to field id. */
  fields: Record<string, string>;
  /** Attribute id to value id to option id. */
  options: Record<string, Record<string, string>>;
}

export interface CrmTableFields {
  id: string;
  creator: string;
  slug: string;
  title: string;
  singular: string;
  icon: TableIcon;
  description: string;
  fields: Field[];
  /**
   * Connectors allowed to write the table's records. One stays after its
   * connection is switched off, so the records it wrote don't disappear.
   */
  connectors: string[];
  /** Sources switched on for the table. */
  connections: Connection[];
  createdAt: number;
}

export type CrmTable = CrmTableFields & {
  address: string;
  project: string;
  event: NostrEvent;
};

export interface StageMove {
  stage: string;
  at: number;
  by?: string;
}

export interface CrmRecordFields {
  id: string;
  title: string;
  /** Field id to values; most fields hold one, multi-selects hold several. */
  values: Record<string, string[]>;
  rank: number;
  createdAt: number;
  creator?: string;
  moves: StageMove[];
}

export type CrmRecord = CrmRecordFields & {
  table: string;
  author: string;
  updatedAt: number;
  event: NostrEvent;
};

export interface ProjectContent {
  tables: CrmTable[];
  records: CrmRecord[];
  byTable: Map<string, CrmRecord[]>;
  byId: Map<string, CrmRecord>;
}

export type Activity = Comment & { type: ActivityType };

/** The `activity` of an entry saying who was put in a member field. */
export const ASSIGNED = "assigned";

/** Someone put people in one of the record's member fields. */
export interface Assignment {
  id: string;
  author: string;
  createdAt: number;
  field: string;
  people: string[];
  event: NostrEvent;
}

export function shortId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

function oneOf<T extends string>(
  options: readonly T[],
  value: string | undefined
): T | undefined {
  return options.find((option) => option === value);
}

export function tableAddress(creator: string, id: string): string {
  return `${CRM_TABLE_KIND}:${creator}:${id}`;
}

export function titleField(table: Pick<CrmTableFields, "fields">): Field {
  return (
    table.fields.find((field) => field.type === "title") ?? {
      config: "",
      id: TITLE_FIELD,
      name: "Name",
      options: [],
      type: "title",
    }
  );
}

export function stageField(
  table: Pick<CrmTableFields, "fields">
): Field | undefined {
  return table.fields.find((field) => field.type === "stage");
}

export function findOption(
  field: Field,
  id: string | undefined
): FieldOption | undefined {
  return id === undefined
    ? undefined
    : field.options.find((option) => option.id === id);
}

export function firstValue(
  record: Pick<CrmRecordFields, "values">,
  field: string
): string | undefined {
  return record.values[field]?.[0];
}

export function recordStage(
  table: CrmTable,
  record: CrmRecord
): FieldOption | undefined {
  const field = stageField(table);
  return field ? findOption(field, firstValue(record, field.id)) : undefined;
}

export function recordTitle(record: Pick<CrmRecordFields, "title">): string {
  return record.title.trim() || "Untitled";
}

export function relationTarget(
  field: Field,
  content: ProjectContent
): CrmTable | undefined {
  return field.type === "relation"
    ? content.tables.find((table) => table.id === field.config)
    : undefined;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A list as the user edited it, laid over its latest version: what they added,
 * changed or removed follows them, the rest follows the latest version, and
 * what others added meanwhile is kept at the end.
 */
function mergeById<T extends { id: string }>(
  base: readonly T[],
  mine: readonly T[],
  latest: readonly T[],
  mergeItem: (base: T, mine: T, latest: T) => T = (_, item) => item
): T[] {
  const before = new Map(base.map((item) => [item.id, item]));
  const now = new Map(latest.map((item) => [item.id, item]));
  const merged: T[] = [];
  for (const item of mine) {
    const original = before.get(item.id);
    const current = now.get(item.id);
    if (!original) {
      merged.push(item);
    } else if (current) {
      merged.push(
        same(original, item) ? current : mergeItem(original, item, current)
      );
    } else if (!same(original, item)) {
      // Removed meanwhile, but this user changed it: keep their version.
      merged.push(item);
    }
  }
  const kept = new Set(mine.map((item) => item.id));
  for (const item of latest) {
    if (!(before.has(item.id) || kept.has(item.id))) {
      merged.push(item);
    }
  }
  return merged;
}

/**
 * Fields as edited in the table settings, over the table's latest version, so
 * fields and options a teammate or an import added while the dialog was open
 * survive the save.
 */
export function mergeFields(
  base: readonly Field[],
  mine: readonly Field[],
  latest: readonly Field[]
): Field[] {
  return mergeById(base, mine, latest, (before, edited, current) => {
    const pick = <K extends "name" | "type" | "config">(key: K) =>
      edited[key] === before[key] ? current[key] : edited[key];
    return {
      config: pick("config"),
      id: edited.id,
      name: pick("name"),
      options: mergeById(before.options, edited.options, current.options),
      type: pick("type"),
    };
  });
}

function connectionKey({ connector, source }: Connection): string {
  return `${connector}:${source}`;
}

// What this user changed in a map follows them, the rest follows the latest version.
function mergeRecord<T>(
  base: Readonly<Record<string, T>>,
  mine: Readonly<Record<string, T>>,
  latest: Readonly<Record<string, T>>,
  mergeValue: (base: T, mine: T, latest: T) => T = (_, value) => value
): Record<string, T> {
  const merged: Record<string, T> = {};
  for (const key of new Set([
    ...Object.keys(base),
    ...Object.keys(mine),
    ...Object.keys(latest),
  ])) {
    const [before, edited, current] = [base[key], mine[key], latest[key]];
    let value: T | undefined;
    if (same(before, edited)) {
      value = current;
    } else if (
      before === undefined ||
      edited === undefined ||
      current === undefined
    ) {
      value = edited;
    } else {
      value = mergeValue(before, edited, current);
    }
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

/** Connectors as edited in the table settings, over the latest version. */
export function mergeConnectors(
  base: readonly string[],
  mine: readonly string[],
  latest: readonly string[]
): string[] {
  const removed = new Set(base.filter((key) => !mine.includes(key)));
  return [...new Set([...latest.filter((key) => !removed.has(key)), ...mine])];
}

/** Connections as edited in the table settings, merged like the fields. */
export function mergeConnections(
  base: readonly Connection[],
  mine: readonly Connection[],
  latest: readonly Connection[]
): Connection[] {
  const keyed = (connections: readonly Connection[]) =>
    connections.map((connection) => ({
      ...connection,
      id: connectionKey(connection),
    }));
  return mergeById(
    keyed(base),
    keyed(mine),
    keyed(latest),
    (before, edited, current) => ({
      ...current,
      fields: mergeRecord(before.fields, edited.fields, current.fields),
      options: mergeRecord(
        before.options,
        edited.options,
        current.options,
        mergeRecord
      ),
    })
  ).map(({ connector, source, fields, options }) => ({
    connector,
    fields,
    options,
    source,
  }));
}

/** Drops mappings to fields and options the table no longer has. */
export function pruneConnections(
  connections: readonly Connection[],
  fields: readonly Field[]
): Connection[] {
  const byId = new Map(fields.map((field) => [field.id, field]));
  return connections.map((connection) => {
    const mapped = Object.entries(connection.fields).filter(([, field]) =>
      byId.has(field)
    );
    const options: Record<string, Record<string, string>> = {};
    for (const [attribute, field] of mapped) {
      const kept = Object.entries(connection.options[attribute] ?? {}).filter(
        ([, option]) => byId.get(field)?.options.some(({ id }) => id === option)
      );
      if (kept.length > 0) {
        options[attribute] = Object.fromEntries(kept);
      }
    }
    return { ...connection, fields: Object.fromEntries(mapped), options };
  });
}

export function findConnection(
  table: Pick<CrmTableFields, "connections">,
  connector: string,
  source: string
): Connection | undefined {
  return table.connections.find(
    (connection) =>
      connection.connector === connector && connection.source === source
  );
}

function parseConnections(event: NostrEvent): {
  connectors: string[];
  connections: Connection[];
} {
  const connectors = new Set<string>();
  const connections: Connection[] = [];
  const find = (connector?: string, source?: string) =>
    connections.find(
      (item) => item.connector === connector && item.source === source
    );
  for (const [name, connector, source] of event.tags) {
    if (name === "p" && isPubkey(connector)) {
      connectors.add(connector);
    } else if (
      name === "source" &&
      isPubkey(connector) &&
      source &&
      !find(connector, source)
    ) {
      connectors.add(connector);
      connections.push({ connector, fields: {}, options: {}, source });
    }
  }
  for (const [name, connector, source, attribute, a, b] of event.tags) {
    const connection = find(connector, source);
    if (!(connection && attribute && a)) {
      continue;
    }
    if (name === "map") {
      connection.fields[attribute] = a;
    } else if (name === "map-option" && b) {
      connection.options[attribute] ??= {};
      connection.options[attribute][a] = b;
    }
  }
  return { connections, connectors: [...connectors] };
}

function connectionTags(table: CrmTableFields): string[][] {
  const tags = table.connectors.map((connector) => ["p", connector]);
  for (const { connector, source, fields, options } of table.connections) {
    if (!table.connectors.includes(connector)) {
      tags.push(["p", connector]);
    }
    tags.push(["source", connector, source]);
    for (const [attribute, field] of Object.entries(fields)) {
      tags.push(["map", connector, source, attribute, field]);
    }
    for (const [attribute, values] of Object.entries(options)) {
      for (const [value, option] of Object.entries(values)) {
        tags.push(["map-option", connector, source, attribute, value, option]);
      }
    }
  }
  return tags;
}

// A second title or stage field can't be honored: drop the title, demote the stage.
function fieldType(
  raw: string | undefined,
  fields: Field[]
): FieldType | undefined {
  const type = oneOf(FIELD_TYPES, raw);
  const taken = (kind: FieldType) =>
    fields.some((field) => field.type === kind);
  if (type === "title" && taken("title")) {
    return undefined;
  }
  return type === "stage" && taken("stage") ? "select" : type;
}

function fieldTags(event: NostrEvent): Field[] {
  const fields: Field[] = [];
  for (const [name, id, raw, label, config] of event.tags) {
    const type = name === "field" ? fieldType(raw, fields) : undefined;
    if (type && id && !fields.some((field) => field.id === id)) {
      fields.push({
        config: config ?? "",
        id,
        name: label?.trim() || "Untitled",
        options: [],
        type,
      });
    }
  }
  return fields;
}

function addOptions(fields: Field[], event: NostrEvent): void {
  for (const [name, fieldId, id, label, color, kind] of event.tags) {
    const field = fields.find((item) => item.id === fieldId);
    if (name === "option" && field && id && !findOption(field, id)) {
      field.options.push({
        color: parseColor(color),
        id,
        kind:
          field.type === "stage"
            ? (oneOf(STAGE_KINDS, kind) ?? "open")
            : "open",
        label: label?.trim() || "Untitled",
      });
    }
  }
}

// Field order is tag order. Unknown types from newer clients are skipped.
function parseFields(event: NostrEvent): Field[] {
  const fields = fieldTags(event);
  addOptions(fields, event);
  const title = fields.findIndex((field) => field.type === "title");
  if (title === -1) {
    fields.unshift(titleField({ fields: [] }));
  } else if (title > 0) {
    fields.unshift(...fields.splice(title, 1));
  }
  return fields;
}

function parseTable(event: NostrEvent, id: string, project: Project): CrmTable {
  const title = getTagValue(event, "title")?.trim() || "Untitled";
  const creator =
    [getTagValue(event, "creator")].find(isPubkey) ?? event.pubkey;
  return {
    ...parseConnections(event),
    address: tableAddress(creator, id),
    createdAt: integer(getTagValue(event, "created")) ?? event.created_at,
    creator,
    description: getTagValue(event, "description") ?? "",
    event,
    fields: parseFields(event),
    icon: oneOf(TABLE_ICONS, getTagValue(event, "icon")) ?? "table",
    id,
    project: project.address,
    singular: getTagValue(event, "singular")?.trim() || "Record",
    slug: slugify(getTagValue(event, "slug") ?? "") || slugify(title) || id,
    title,
  };
}

export function parseRecord(
  event: NostrEvent,
  id: string,
  table: string
): CrmRecord {
  const values: Record<string, string[]> = {};
  const moves: StageMove[] = [];
  for (const [name, first, second, third] of event.tags) {
    if (name === "val" && first && second !== undefined && second !== "") {
      values[first] ??= [];
      values[first].push(second);
    } else if (name === "moved" && first) {
      const at = integer(second);
      if (at !== undefined) {
        moves.push({
          at,
          by: isPubkey(third) ? third : undefined,
          stage: first,
        });
      }
    }
  }
  return {
    author: event.pubkey,
    createdAt: integer(getTagValue(event, "created")) ?? event.created_at,
    creator: [getTagValue(event, "creator")].find(isPubkey),
    event,
    id,
    moves: moves.toSorted((a, b) => a.at - b.at),
    rank: Number(getTagValue(event, "rank")) || 0,
    table,
    title: getTagValue(event, "title") ?? "",
    updatedAt: event.created_at,
    values,
  };
}

export function resolveTables(
  project: Project,
  events: NostrEvent[]
): CrmTable[] {
  const authors = new Set(project.members);
  const tables = [...latestVersions(events, CRM_TABLE_KIND, authors)]
    .filter(([, event]) => !isDeleted(event))
    .map(([id, event]) => parseTable(event, id, project))
    .toSorted(
      (a, b) =>
        a.createdAt - b.createdAt ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id)
    );
  // Two tables can share a slug when one was made before the other loaded.
  // The newer one gets a suffix, so each keeps its own address.
  const taken = new Set(RESERVED_TABLE_SLUGS);
  return tables.map((table) => {
    const slug = uniqueSlug(table.slug, taken);
    taken.add(slug);
    return slug === table.slug ? table : { ...table, slug };
  });
}

/** Tables and records of a project, resolved across every member's versions. */
export function resolveProject(
  project: Project,
  events: NostrEvent[]
): ProjectContent {
  const tables = resolveTables(project, events);
  const byTable = new Map(
    tables.map((table): [string, CrmRecord[]] => [table.id, []])
  );
  const members = new Set(project.members);
  const connectors = new Map(
    tables.map((table) => [table.id, new Set(table.connectors)])
  );
  // A connector's version only counts in a table that lets it write there.
  const versions = events.filter(
    (event) =>
      members.has(event.pubkey) ||
      connectors
        .get(addressedId(event, CRM_TABLE_KIND) ?? "")
        ?.has(event.pubkey) === true
  );
  const authors = new Set([
    ...members,
    ...tables.flatMap((table) => table.connectors),
  ]);
  const records = [...latestVersions(versions, CRM_RECORD_KIND, authors)]
    .filter(([, event]) => !isDeleted(event))
    .flatMap(([id, event]) => {
      const table = addressedId(event, CRM_TABLE_KIND);
      return table && byTable.has(table) ? [parseRecord(event, id, table)] : [];
    })
    .toSorted((a, b) => a.rank - b.rank || a.createdAt - b.createdAt);
  for (const record of records) {
    byTable.get(record.table)?.push(record);
  }
  return {
    byId: new Map(records.map((record) => [record.id, record])),
    byTable,
    records,
    tables,
  };
}

export function tableTemplate(
  project: Project,
  table: CrmTableFields
): Template {
  const tags = [
    ["d", table.id],
    ["a", project.address],
    ["title", table.title],
    ["singular", table.singular],
    ["slug", table.slug],
    ["icon", table.icon],
    ["creator", table.creator],
    ["created", String(table.createdAt)],
  ];
  if (table.description) {
    tags.push(["description", table.description]);
  }
  tags.push(...connectionTags(table));
  for (const field of table.fields) {
    const tag = ["field", field.id, field.type, field.name];
    if (field.config) {
      tag.push(field.config);
    }
    tags.push(tag);
  }
  for (const field of table.fields) {
    for (const option of field.options) {
      const tag = ["option", field.id, option.id, option.label, option.color];
      if (field.type === "stage") {
        tag.push(option.kind);
      }
      tags.push(tag);
    }
  }
  tags.push(["alt", `CRM table: ${table.title}`]);
  return { content: "", kind: CRM_TABLE_KIND, tags };
}

export function tableTombstoneTemplate(
  project: Project,
  table: CrmTable
): Template {
  return {
    content: "",
    kind: CRM_TABLE_KIND,
    tags: [["d", table.id], ["a", project.address], ["deleted"]],
  };
}

export function recordTemplate(
  table: CrmTable,
  record: CrmRecordFields
): Template {
  const tags = [
    ["d", record.id],
    ["a", table.address],
    ["a", table.project],
    ["title", record.title],
    ["rank", String(record.rank)],
    ["created", String(record.createdAt)],
  ];
  if (record.creator) {
    tags.push(["creator", record.creator]);
  }
  // Values of fields this client doesn't know about are kept, after the known ones.
  const order = new Map(table.fields.map((field, index) => [field.id, index]));
  const entries = Object.entries(record.values).toSorted(
    ([a], [b]) => (order.get(a) ?? order.size) - (order.get(b) ?? order.size)
  );
  for (const [field, values] of entries) {
    for (const value of values) {
      if (value !== "" && field !== TITLE_FIELD) {
        tags.push(["val", field, value]);
      }
    }
  }
  for (const move of record.moves.slice(-MAX_MOVES)) {
    const tag = ["moved", move.stage, String(move.at)];
    if (move.by) {
      tag.push(move.by);
    }
    tags.push(tag);
  }
  tags.push(["alt", `CRM record: ${recordTitle(record)}`]);
  return { content: "", kind: CRM_RECORD_KIND, tags };
}

export function recordTombstoneTemplate(
  table: CrmTable,
  record: CrmRecord
): Template {
  return {
    content: "",
    kind: CRM_RECORD_KIND,
    tags: [
      ["d", record.id],
      ["a", table.address],
      ["a", table.project],
      ["deleted"],
    ],
  };
}

/** NIP-22 tags pointing at the record, which every entry on it carries. */
function recordThreadTags(
  record: Pick<CrmRecord, "author" | "id">
): string[][] {
  const address = `${CRM_RECORD_KIND}:${record.author}:${record.id}`;
  return [
    ["A", address],
    ["K", String(CRM_RECORD_KIND)],
    ["P", record.author],
    ["a", address],
    ["k", String(CRM_RECORD_KIND)],
  ];
}

/** A note, call or visit logged on the record, with a `p` tag for everyone it mentions. */
export function activityTemplate(
  record: CrmRecord,
  type: ActivityType,
  content: string
): Template {
  return {
    content,
    kind: COMMENT_KIND,
    tags: [
      ...recordThreadTags(record),
      ...commentPeopleTags(record.author, mentionedPubkeys(content), []),
      ["activity", type],
    ],
  };
}

/** People just put in one of the record's member fields, told through their `p` tags. */
export function assignmentTemplate(
  record: Pick<CrmRecord, "author" | "id">,
  field: Field,
  people: string[]
): Template {
  return {
    content: `Assigned ${people.map(mentionReference).join(", ")} as ${field.name}`,
    kind: COMMENT_KIND,
    tags: [
      ...recordThreadTags(record),
      ...commentPeopleTags(record.author, people, []),
      ["activity", ASSIGNED],
      ["field", field.id],
    ],
  };
}

/** Whether the entry was logged by someone, as a note or a call, rather than told by the app. */
export function isLoggedActivity(event: NostrEvent): boolean {
  return getTagValue(event, "activity") !== ASSIGNED;
}

export function parseAssignment(event: NostrEvent): Assignment | undefined {
  const field = getTagValue(event, "field");
  const people = event.tags.flatMap(([name, pubkey]) =>
    name === "p" &&
    isPubkey(pubkey) &&
    event.content.includes(mentionReference(pubkey))
      ? [pubkey]
      : []
  );
  if (isLoggedActivity(event) || !field || people.length === 0) {
    return undefined;
  }
  return {
    author: event.pubkey,
    createdAt: event.created_at,
    event,
    field,
    id: event.id,
    people,
  };
}

export function parseActivity(event: NostrEvent): Activity {
  return {
    author: event.pubkey,
    content: event.content,
    createdAt: event.created_at,
    event,
    id: event.id,
    type:
      ACTIVITY_TYPES.find(({ id }) => id === getTagValue(event, "activity"))
        ?.id ?? "note",
  };
}

/** Everyone who may write the record: the members and the table's connectors. */
export function recordAuthors(project: Project, table: CrmTable): string[] {
  return [...new Set([...project.members, ...table.connectors])];
}

/** One record's newest version in the table, unless it was deleted. */
export function resolveRecord(
  project: Project,
  table: CrmTable,
  events: NostrEvent[],
  id: string
): CrmRecord | undefined {
  const versions = events.filter(
    (event) =>
      getTagValue(event, "d") === id &&
      addressedId(event, CRM_TABLE_KIND) === table.id
  );
  const event = latestVersions(
    versions,
    CRM_RECORD_KIND,
    new Set(recordAuthors(project, table))
  ).get(id);
  return event && !isDeleted(event)
    ? parseRecord(event, id, table.id)
    : undefined;
}

/** Each author's copy of a record has its own address, so comments may point at any of them. */
export function recordActivityAddresses(
  project: Project,
  table: CrmTable,
  record: CrmRecord
): string[] {
  return recordAuthors(project, table).map(
    (author) => `${CRM_RECORD_KIND}:${author}:${record.id}`
  );
}
