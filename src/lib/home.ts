/**
 * How each person set up their Home: what they pinned, which sections show
 * and in what order, and how they look at their cards. It's kept on the relay
 * as a NIP-78 app data event, encrypted to themselves, so every device agrees.
 * Each setting carries when it last changed, and so does each pin, and the
 * newer one wins: pinning on one device and filtering or pinning something
 * else on another all stay. No browser APIs here.
 */
import type { Priority, Status, Template } from "@/lib/model";
import { APP_DATA_KIND, PRIORITIES, STATUSES } from "@/lib/model";

export const HOME_D = "freehub/home";
/** Pins kept, the earliest dropped first. */
const MAX_PINS = 60;
/** Unpinned ones remembered, so an older device's copy can't bring them back. */
const MAX_UNPINNED = 100;

export const HOME_SECTIONS = [
  { id: "pinned", label: "Pinned" },
  { id: "tasks", label: "My tasks" },
  { id: "mentions", label: "Mentions" },
  { id: "links", label: "Links" },
  { id: "projects", label: "Projects" },
] as const;

export type HomeSection = (typeof HOME_SECTIONS)[number]["id"];

export interface SectionSetting {
  id: HomeSection;
  hidden: boolean;
}

/** Something pinned: a project, board or table by its address, or a doc page or catalog in a project. */
export type Pin =
  | { type: "project" | "board" | "table"; address: string }
  | { type: "page" | "catalog"; project: string; id: string };

export type TaskView = "list" | "calendar";

/** Whose cards: assigned to the person, made by them, or both. */
export type TaskScope = "all" | "assigned" | "created";

/** Cards without a priority filter as "none". */
export type PriorityFilter = Priority | "none";

export interface TaskFilters {
  scope: TaskScope;
  /** Addresses of projects and boards; a card in any of them passes. */
  places: string[];
  statuses: Status[];
  priorities: PriorityFilter[];
}

export interface HomePrefs {
  /** In the order they were pinned. */
  pins: Pin[];
  /** Every section, in the order shown. */
  sections: SectionSetting[];
  view: TaskView;
  filters: TaskFilters;
}

/** The settings changed as a whole; pins change one at a time. */
export type HomeSetting = Exclude<keyof HomePrefs, "pins">;

/** Whether something is pinned, as last changed on some device. */
export interface PinMark {
  pin: Pin;
  pinned: boolean;
  /** When it was pinned or unpinned, in milliseconds. */
  at: number;
  /** Its place among the pins: when it was pinned, kept through an undo. */
  order: number;
}

/** Each setting and pin as last changed on some device, with when, in milliseconds. */
export type HomeDoc = {
  [K in HomeSetting]?: { at: number; value: HomePrefs[K] };
} & {
  pins?: PinMark[];
  /** Settings this version of the app doesn't know, from a newer one, kept as they are. */
  newer?: Record<string, unknown>;
};

const SETTINGS: readonly HomeSetting[] = ["sections", "view", "filters"];

export const NO_FILTERS: TaskFilters = {
  places: [],
  priorities: [],
  scope: "all",
  statuses: [],
};

const DEFAULTS: Omit<HomePrefs, "pins"> = {
  filters: NO_FILTERS,
  sections: HOME_SECTIONS.map(({ id }) => ({ hidden: false, id })),
  view: "list",
};

export function pinKey(pin: Pin): string {
  return "address" in pin
    ? `${pin.type}:${pin.address}`
    : `${pin.type}:${pin.project}:${pin.id}`;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parsePin(value: unknown): Pin | undefined {
  const { type, address, project, id } = record(value);
  if (type === "page" || type === "catalog") {
    return typeof project === "string" && typeof id === "string"
      ? { id, project, type }
      : undefined;
  }
  return (type === "project" || type === "board" || type === "table") &&
    typeof address === "string"
    ? { address, type }
    : undefined;
}

function time(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseMark(value: unknown): PinMark | undefined {
  const fields = record(value);
  const pin = parsePin(fields.pin);
  const at = time(fields.at);
  const order = time(fields.order);
  return pin && at !== undefined && order !== undefined
    ? { at, order, pin, pinned: fields.pinned === true }
    : undefined;
}

/** The most recent marks that are, or aren't, pinned: by place, or by when. */
function recent(
  marks: PinMark[],
  pinned: boolean,
  max: number,
  by: "at" | "order"
): PinMark[] {
  return marks
    .filter((mark) => mark.pinned === pinned)
    .toSorted((a, b) => b[by] - a[by])
    .slice(0, max);
}

/**
 * The newest mark of each pin, from any number of copies. Only so many are
 * kept, pinned and unpinned, each the most recent; sorted by key, so two
 * copies with the same marks read the same.
 */
function newestMarks(...copies: PinMark[][]): PinMark[] {
  const marks = new Map<string, PinMark>();
  for (const mark of copies.flat()) {
    const key = pinKey(mark.pin);
    const seen = marks.get(key);
    if (!seen || mark.at > seen.at) {
      marks.set(key, mark);
    }
  }
  const all = [...marks.values()];
  return [
    ...recent(all, true, MAX_PINS, "order"),
    ...recent(all, false, MAX_UNPINNED, "at"),
  ].toSorted((a, b) => pinKey(a.pin).localeCompare(pinKey(b.pin)));
}

function parseMarks(value: unknown): PinMark[] {
  return newestMarks(
    (Array.isArray(value) ? value : []).flatMap((item) => parseMark(item) ?? [])
  );
}

/** The sections saved, then any added since, each once. */
function parseSections(value: unknown): SectionSetting[] {
  const sections = new Map<HomeSection, SectionSetting>();
  for (const item of Array.isArray(value) ? value : []) {
    const { id, hidden } = record(item);
    const section = HOME_SECTIONS.find((known) => known.id === id);
    if (section && !sections.has(section.id)) {
      sections.set(section.id, { hidden: hidden === true, id: section.id });
    }
  }
  for (const { id } of HOME_SECTIONS) {
    if (!sections.has(id)) {
      sections.set(id, { hidden: false, id });
    }
  }
  return [...sections.values()];
}

function parseView(value: unknown): TaskView {
  return value === "calendar" ? "calendar" : "list";
}

function parseFilters(value: unknown): TaskFilters {
  const { scope, places, statuses, priorities } = record(value);
  const picked = (options: readonly string[], values: unknown) =>
    strings(values).filter((item) => options.includes(item));
  return {
    places: [...new Set(strings(places))],
    priorities: picked(
      [...PRIORITIES.map(({ id }) => id), "none"],
      priorities
    ) as PriorityFilter[],
    scope: scope === "assigned" || scope === "created" ? scope : "all",
    statuses: picked(
      STATUSES.map(({ id }) => id),
      statuses
    ) as Status[],
  };
}

const PARSERS: { [K in HomeSetting]: (value: unknown) => HomePrefs[K] } = {
  filters: parseFilters,
  sections: parseSections,
  view: parseView,
};

/** The settings in the text, or nothing if it isn't settings at all. */
export function parseHomeDoc(text: string): HomeDoc | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const saved = record(parsed);
  const doc: Record<string, unknown> = {};
  for (const key of SETTINGS) {
    const { at, value } = record(saved[key]);
    if (time(at) !== undefined) {
      doc[key] = { at, value: PARSERS[key](value) };
    }
  }
  const marks = parseMarks(saved.pins);
  if (marks.length > 0) {
    doc.pins = marks;
  }
  const newer = Object.fromEntries(
    Object.entries(saved).filter(
      ([key]) => key !== "pins" && !SETTINGS.includes(key as HomeSetting)
    )
  );
  if (Object.keys(newer).length > 0) {
    doc.newer = newer;
  }
  // Each value came through its own setting's parser.
  return doc as HomeDoc;
}

export function serializeHomeDoc(doc: HomeDoc): string {
  return JSON.stringify(
    Object.fromEntries([
      ...Object.entries(doc.newer ?? {}),
      ...(doc.pins ? [["pins", doc.pins]] : []),
      ...SETTINGS.flatMap((key) => (doc[key] ? [[key, doc[key]]] : [])),
    ])
  );
}

/**
 * Each setting and pin as last changed on either side. Settings only a newer
 * version knows come from `b`, the relay's copy, over `a`, this device's.
 */
export function mergeHomeDocs(a: HomeDoc, b: HomeDoc): HomeDoc {
  const merged: HomeDoc =
    a.pins || b.pins ? { pins: newestMarks(a.pins ?? [], b.pins ?? []) } : {};
  if (a.newer || b.newer) {
    merged.newer = { ...a.newer, ...b.newer };
  }
  for (const key of SETTINGS) {
    const mine = a[key];
    const theirs = b[key];
    const newest = !theirs || (mine && mine.at >= theirs.at) ? mine : theirs;
    if (newest) {
      Object.assign(merged, { [key]: newest });
    }
  }
  return merged;
}

export function sameHomeDoc(a: HomeDoc, b: HomeDoc): boolean {
  return serializeHomeDoc(a) === serializeHomeDoc(b);
}

/** The doc with the pin's mark changed. */
export function withPinMark(doc: HomeDoc, mark: PinMark): HomeDoc {
  return { ...doc, pins: newestMarks(doc.pins ?? [], [mark]) };
}

export function findPinMark(doc: HomeDoc, pin: Pin): PinMark | undefined {
  const key = pinKey(pin);
  return doc.pins?.find((mark) => pinKey(mark.pin) === key);
}

/** The settings, with the defaults for any never changed. */
export function homePrefs(doc: HomeDoc): HomePrefs {
  return {
    filters: doc.filters?.value ?? DEFAULTS.filters,
    pins: (doc.pins ?? [])
      .filter((mark) => mark.pinned)
      .toSorted((a, b) => a.order - b.order)
      .map((mark) => mark.pin),
    sections: doc.sections?.value ?? DEFAULTS.sections,
    view: doc.view?.value ?? DEFAULTS.view,
  };
}

/** The settings event, its content already encrypted to its author. */
export function homeTemplate(content: string): Template {
  return { content, kind: APP_DATA_KIND, tags: [["d", HOME_D]] };
}
