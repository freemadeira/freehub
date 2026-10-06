import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import type { Comment, Template } from "@/lib/model";
import {
  addressedId,
  COMMENT_KIND,
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

export interface CrmTableFields {
  id: string;
  creator: string;
  slug: string;
  title: string;
  singular: string;
  icon: TableIcon;
  description: string;
  fields: Field[];
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

function parseRecord(event: NostrEvent, id: string, table: string): CrmRecord {
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
  const taken = new Set<string>();
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
  const authors = new Set(project.members);
  const records = [...latestVersions(events, CRM_RECORD_KIND, authors)]
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

export function activityTemplate(
  record: CrmRecord,
  type: ActivityType,
  content: string
): Template {
  const address = `${CRM_RECORD_KIND}:${record.author}:${record.id}`;
  return {
    content,
    kind: COMMENT_KIND,
    tags: [
      ["A", address],
      ["K", String(CRM_RECORD_KIND)],
      ["P", record.author],
      ["a", address],
      ["k", String(CRM_RECORD_KIND)],
      ["p", record.author],
      ["activity", type],
    ],
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

/** Each member's copy of a record has its own address, so comments may point at any of them. */
export function recordActivityAddresses(
  project: Project,
  record: CrmRecord
): string[] {
  return project.members.map(
    (member) => `${CRM_RECORD_KIND}:${member}:${record.id}`
  );
}
