import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import { cleanLink } from "@/lib/catalogs";
import { isSigned } from "@/lib/docs";
import { cleanName } from "@/lib/drive";
import type { Template } from "@/lib/model";
import {
  addressOf,
  BRAND_KIND,
  BRAND_PART_KIND,
  integer,
  isDeleted,
  isPubkey,
  latestVersions,
  PROJECT_KIND,
} from "@/lib/model";
import type { Project } from "@/lib/project";
import { slugify } from "@/lib/project";
import type { SealedFileFields } from "@/lib/sealed-files";
import {
  parseSealedFile,
  sealedFileTags,
  tombstoneFileTags,
} from "@/lib/sealed-files";

/**
 * A project's brands. A brand is an addressable event any member can write,
 * like a doc page: its name and links in tags, its guidelines as Markdown in
 * the content, the newest version across members winning, with `prev` to
 * merge edits made at once. Each color, typeface and file is a part of its
 * own, so two people changing different parts never undo each other.
 * Files sit on the team's Blossom servers, sealed like the Drive's.
 */

export const MAX_BRAND_NAME = 80;
export const MAX_BRAND_DESCRIPTION = 500;
export const MAX_SOCIALS = 12;
export const MAX_URL = 500;
export const MAX_COLORS = 24;
export const MAX_COLOR_NAME = 40;
export const MAX_FONTS = 8;
export const MAX_FONT_FAMILY = 80;
export const MAX_FONT_ROLE = 40;
export const MAX_CAPTION = 280;
/** Formats one logo slot keeps, like the same logo as SVG, PNG and PDF. */
export const MAX_SLOT_FILES = 6;
/** Files one uploaded typeface keeps: its weights and italics. */
export const MAX_FONT_FILES = 18;

/** The logos a brand keeps, each in a slot of its own. */
export const LOGO_KINDS = ["symbol", "wordmark", "lockup", "icon"] as const;
/** What a logo is drawn to sit on: dark ink for light backgrounds, light ink for dark. */
export const LOGO_MODES = ["light", "dark"] as const;
/** Where a typeface comes from: the font library by its name, or files uploaded. */
export const FONT_SOURCES = ["library", "file"] as const;
/** Whether an example shows the brand used well or badly. */
export const VERDICTS = ["do", "dont"] as const;
/** The weights a typeface can come in, thin to black. */
export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export type LogoKind = (typeof LOGO_KINDS)[number];
export type LogoMode = (typeof LOGO_MODES)[number];
export type FontSource = (typeof FONT_SOURCES)[number];
export type Verdict = (typeof VERDICTS)[number];
/** A color as `#rrggbb`, lowercase. */
export type HexColor = `#${string}`;

/** Where a brand's file sits. */
export type BrandPlace =
  | { kind: "logo"; logo: LogoKind; mode: LogoMode }
  | { kind: "illustration" }
  | { kind: "pattern" }
  | { kind: "font"; font: string }
  | { kind: "example"; verdict: Verdict };

export type BrandPlaceKind = BrandPlace["kind"];

const SHORT_HEX = /^#?(?<r>[0-9a-f])(?<g>[0-9a-f])(?<b>[0-9a-f])$/u;
const LONG_HEX = /^#?(?<hex>[0-9a-f]{6})$/u;

// ———————————————————————————————————————— Brands

export interface BrandFields {
  id: string;
  title: string;
  description: string;
  /** Its own site; empty for none. */
  website: string;
  /** Its profiles elsewhere, in order. */
  socials: string[];
  /** Do's and don'ts and anything else on using it, as Markdown. */
  guide: string;
  createdAt: number;
  creator?: string;
}

export type Brand = BrandFields & {
  /** Address of the project the brand belongs to. */
  project: string;
  /** Who saved the newest version. */
  author: string;
  updatedAt: number;
  event: NostrEvent;
};

// ———————————————————————————————————————— Parts

interface PartBase {
  id: string;
  /** The `d` tag of the brand it's part of. */
  brand: string;
  /** Order among the parts like it. */
  rank: number;
  createdAt: number;
  creator?: string;
}

export interface ColorFields extends PartBase {
  part: "color";
  name: string;
  hex: HexColor;
}

export interface FontFields extends PartBase {
  part: "font";
  family: string;
  source: FontSource;
  /** Weights picked from the library; uploaded typefaces tell theirs by their files. */
  weights: number[];
  /** What it's for, like "Headings" or "Headings, Body". */
  role: string;
}

/** A font file's weight and style. */
export interface Face {
  /** One weight, or VARIABLE for a file that draws them all. */
  weight: number;
  style: "normal" | "italic";
}

/** The weight of a variable font file, which covers every weight. */
export const VARIABLE = 0;

export type FileFields = PartBase &
  SealedFileFields & {
    part: "file";
    place: BrandPlace;
    /** The file's name, as it was uploaded. */
    name: string;
    /** What an example shows, in a line. */
    caption: string;
    /** A typeface file's weight and style, as set; told by its name without. */
    face?: Face;
  };

export type PartFields = ColorFields | FontFields | FileFields;

interface Stored {
  /** Address of the project the part belongs to. */
  project: string;
  /** Who saved the newest version. */
  author: string;
  updatedAt: number;
  event: NostrEvent;
}

export type BrandColor = ColorFields & Stored;
export type BrandFont = FontFields & Stored;
export type BrandFile = FileFields & Stored;
export type BrandPart = BrandColor | BrandFont | BrandFile;

export interface BrandParts {
  colors: BrandColor[];
  fonts: BrandFont[];
  files: BrandFile[];
}

export const NO_PARTS: BrandParts = { colors: [], files: [], fonts: [] };

export interface BrandsContent {
  /** Every brand, by name. */
  brands: Brand[];
  byId: Map<string, Brand>;
  /** Each brand's parts, in order, by brand id. */
  parts: Map<string, BrandParts>;
  /** Each member's newest version of every brand, to merge guidelines edited at once. */
  versions: Map<string, NostrEvent[]>;
  /**
   * The newest versions of brand files deleted for good, which still name
   * their blobs, and of files left in a brand or typeface deleted.
   */
  deleted: NostrEvent[];
}

export const EMPTY_BRANDS: BrandsContent = {
  brands: [],
  byId: new Map(),
  deleted: [],
  parts: new Map(),
  versions: new Map(),
};

// ———————————————————————————————————————— Reading

/** A line of text as kept: one line, no doubled spaces, not too long. */
export function clean(text: string | undefined, max: number): string {
  return (text ?? "").replaceAll(/\s+/gu, " ").trim().slice(0, max);
}

/** A color as kept, from `#abc`, `abc`, `#AABBCC` or `aabbcc`; nothing when it isn't one. */
export function parseHex(value: string | undefined): HexColor | undefined {
  const text = value?.trim().toLowerCase() ?? "";
  const short = SHORT_HEX.exec(text)?.groups;
  if (short) {
    return `#${short.r}${short.r}${short.g}${short.g}${short.b}${short.b}`;
  }
  const long = LONG_HEX.exec(text)?.groups?.hex;
  return long ? `#${long}` : undefined;
}

function oneOf<T extends string>(
  options: readonly T[],
  value: string | undefined
): T | undefined {
  return options.find((option) => option === value);
}

export function parsePlace(tag: string[] | undefined): BrandPlace | undefined {
  const [, kind, first, second] = tag ?? [];
  switch (kind) {
    case "logo": {
      const logo = oneOf(LOGO_KINDS, first);
      const mode = oneOf(LOGO_MODES, second);
      return logo && mode ? { kind, logo, mode } : undefined;
    }
    case "illustration":
    case "pattern": {
      return { kind };
    }
    case "font": {
      return first ? { font: first, kind } : undefined;
    }
    case "example": {
      const verdict = oneOf(VERDICTS, first);
      return verdict ? { kind, verdict } : undefined;
    }
    default: {
      return undefined;
    }
  }
}

function placeTag(place: BrandPlace): string[] {
  switch (place.kind) {
    case "logo": {
      return ["place", "logo", place.logo, place.mode];
    }
    case "font": {
      return ["place", "font", place.font];
    }
    case "example": {
      return ["place", "example", place.verdict];
    }
    default: {
      return ["place", place.kind];
    }
  }
}

function parseSocials(event: NostrEvent): string[] {
  const links = event.tags.flatMap(([name, url]) => {
    const link = name === "social" ? cleanLink(url ?? "") : null;
    return link && link.length <= MAX_URL ? [link] : [];
  });
  return [...new Set(links)].slice(0, MAX_SOCIALS);
}

function parseBrand(event: NostrEvent, id: string, project: string): Brand {
  const website = cleanLink(getTagValue(event, "r") ?? "");
  return {
    author: event.pubkey,
    createdAt: integer(getTagValue(event, "created")) ?? event.created_at,
    creator: [getTagValue(event, "creator")].find(isPubkey),
    description: (getTagValue(event, "description") ?? "")
      .trim()
      .slice(0, MAX_BRAND_DESCRIPTION),
    event,
    guide: event.content,
    id,
    project,
    socials: parseSocials(event),
    title: clean(getTagValue(event, "title"), MAX_BRAND_NAME) || "Untitled",
    updatedAt: event.created_at,
    website: website && website.length <= MAX_URL ? website : "",
  };
}

function parseWeights(event: NostrEvent): number[] {
  const tag = event.tags.find(([name]) => name === "weights") ?? [];
  const weights = new Set(
    tag
      .slice(1)
      .map(Number)
      .filter((weight) => FONT_WEIGHTS.includes(weight))
  );
  return [...weights].toSorted((a, b) => a - b);
}

function parseFace(tag: string[] | undefined): Face | undefined {
  const weight = /^\d+$/u.test(tag?.[1] ?? "") ? Number(tag?.[1]) : Number.NaN;
  const style = tag?.[2] === "italic" ? "italic" : "normal";
  return tag && (weight === VARIABLE || FONT_WEIGHTS.includes(weight))
    ? { style, weight }
    : undefined;
}

function parsePart(event: NostrEvent, id: string): PartFields | undefined {
  const brand = getTagValue(event, "brand");
  if (!brand) {
    return undefined;
  }
  const base: PartBase = {
    brand,
    createdAt: integer(getTagValue(event, "created")) ?? event.created_at,
    creator: [getTagValue(event, "creator")].find(isPubkey),
    id,
    rank: Number(getTagValue(event, "rank")) || 0,
  };
  switch (getTagValue(event, "part")) {
    case "color": {
      const hex = parseHex(getTagValue(event, "hex"));
      return hex
        ? {
            ...base,
            hex,
            name: clean(getTagValue(event, "name"), MAX_COLOR_NAME),
            part: "color",
          }
        : undefined;
    }
    case "font": {
      const family = clean(getTagValue(event, "family"), MAX_FONT_FAMILY);
      const source = oneOf(FONT_SOURCES, getTagValue(event, "source"));
      return family && source
        ? {
            ...base,
            family,
            part: "font",
            role: clean(getTagValue(event, "role"), MAX_FONT_ROLE),
            source,
            weights: parseWeights(event),
          }
        : undefined;
    }
    case "file": {
      const sealed = parseSealedFile(event);
      const place = parsePlace(event.tags.find(([name]) => name === "place"));
      return sealed && place
        ? {
            ...base,
            ...sealed,
            caption: clean(event.content, MAX_CAPTION),
            face: parseFace(event.tags.find(([name]) => name === "face")),
            name: cleanName(getTagValue(event, "name") ?? "") || "Untitled",
            part: "file",
            place,
          }
        : undefined;
    }
    default: {
      return undefined;
    }
  }
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function inOrder<T extends PartBase>(parts: T[]): T[] {
  return parts.toSorted(
    (a, b) =>
      a.rank - b.rank || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  );
}

/** The project's own events of one kind, by members, every version. */
function ownEvents(
  project: Project,
  events: NostrEvent[],
  kind: number
): NostrEvent[] {
  const authors = new Set(project.members);
  return events.filter(
    (event) =>
      event.kind === kind &&
      authors.has(event.pubkey) &&
      addressOf(event, PROJECT_KIND) === project.address
  );
}

/** The project's brands and their parts, resolved across every member's versions. */
export function resolveBrands(
  project: Project,
  events: NostrEvent[]
): BrandsContent {
  const authors = new Set(project.members);
  const own = ownEvents(project, events, BRAND_KIND);
  const brands = [...latestVersions(own, BRAND_KIND, authors)]
    .filter(([, event]) => !isDeleted(event))
    .map(([id, event]) => parseBrand(event, id, project.address))
    .toSorted(
      (a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id)
    );
  const byId = new Map(brands.map((brand) => [brand.id, brand]));
  const versions = new Map<string, NostrEvent[]>();
  for (const event of own) {
    const id = getTagValue(event, "d");
    if (id && byId.has(id)) {
      versions.set(id, [...(versions.get(id) ?? []), event]);
    }
  }
  const found = new Map<string, BrandPart[]>();
  const deleted: NostrEvent[] = [];
  const parts = latestVersions(
    ownEvents(project, events, BRAND_PART_KIND),
    BRAND_PART_KIND,
    authors
  );
  // Brands and typefaces known to be deleted: files still in them go too.
  const goneBrands = new Set(
    [...latestVersions(own, BRAND_KIND, authors)]
      .filter(([, event]) => isDeleted(event))
      .map(([id]) => id)
  );
  const goneFonts = new Set(
    [...parts].filter(([, event]) => isDeleted(event)).map(([id]) => id)
  );
  for (const [id, event] of parts) {
    if (isDeleted(event)) {
      if (event.tags.some(([name]) => name === "x")) {
        deleted.push(event);
      }
      continue;
    }
    const fields = parsePart(event, id);
    if (
      fields?.part === "file" &&
      (goneBrands.has(fields.brand) ||
        (fields.place.kind === "font" && goneFonts.has(fields.place.font)))
    ) {
      deleted.push(event);
      continue;
    }
    if (fields && byId.has(fields.brand)) {
      const part = {
        ...fields,
        author: event.pubkey,
        event,
        project: project.address,
        updatedAt: event.created_at,
      } as BrandPart;
      found.set(fields.brand, [...(found.get(fields.brand) ?? []), part]);
    }
  }
  const resolved = new Map<string, BrandParts>();
  for (const [brand, list] of found) {
    resolved.set(brand, {
      colors: inOrder(
        list.filter((part): part is BrandColor => part.part === "color")
      ),
      files: inOrder(
        list.filter((part): part is BrandFile => part.part === "file")
      ),
      fonts: inOrder(
        list.filter((part): part is BrandFont => part.part === "font")
      ),
    });
  }
  return { brands, byId, deleted, parts: resolved, versions };
}

// ———————————————————————————————————————— Writing

/**
 * A version of the brand. `prev` names the version its guidelines were
 * edited from, so a teammate's editor can merge them with edits of their own.
 */
export function brandTemplate(
  project: Pick<Project, "address">,
  brand: BrandFields,
  prev?: NostrEvent
): Template {
  const tags = [
    ["d", brand.id],
    ["a", project.address],
    ["title", brand.title],
    ["description", brand.description],
    ["created", String(brand.createdAt)],
  ];
  if (brand.website) {
    tags.push(["r", brand.website]);
  }
  for (const link of brand.socials) {
    tags.push(["social", link]);
  }
  if (brand.creator) {
    tags.push(["creator", brand.creator]);
  }
  if (prev && isSigned(prev)) {
    tags.push(["prev", prev.id]);
  }
  tags.push(["alt", `Brand: ${brand.title}`]);
  return { content: brand.guide, kind: BRAND_KIND, tags };
}

function partTags(part: PartFields): string[][] {
  switch (part.part) {
    case "color": {
      return [
        ["hex", part.hex],
        ["name", part.name],
        ["alt", `Brand color: ${part.name || part.hex}`],
      ];
    }
    case "font": {
      return [
        ["family", part.family],
        ["source", part.source],
        ["weights", ...part.weights.map(String)],
        ["role", part.role],
        ["alt", `Brand typeface: ${part.family}`],
      ];
    }
    default: {
      return [
        placeTag(part.place),
        ["name", part.name],
        ...(part.face
          ? [["face", String(part.face.weight), part.face.style]]
          : []),
        ...sealedFileTags(part),
        ["alt", `Brand file: ${part.name}`],
      ];
    }
  }
}

export function partTemplate(
  project: Pick<Project, "address">,
  part: PartFields
): Template {
  const tags = [
    ["d", part.id],
    ["a", project.address],
    ["brand", part.brand],
    ["part", part.part],
    ["rank", String(part.rank)],
    ["created", String(part.createdAt)],
  ];
  // A file's tags name its uploader already.
  if (part.creator && part.part !== "file") {
    tags.push(["creator", part.creator]);
  }
  tags.push(...partTags(part));
  return {
    content: part.part === "file" ? part.caption : "",
    kind: BRAND_PART_KIND,
    tags,
  };
}

/** Deletes a brand for good. Its parts go too, each by its own tombstone. */
export function brandTombstoneTemplate(
  project: Pick<Project, "address">,
  brand: Pick<Brand, "id">
): Template {
  return {
    content: "",
    kind: BRAND_KIND,
    tags: [["d", brand.id], ["a", project.address], ["deleted"]],
  };
}

/**
 * Deletes a part for good. A file's tombstone still names its blobs and who
 * uploaded them, so their client can delete them from the servers.
 */
export function partTombstoneTemplate(
  project: Pick<Project, "address">,
  part: BrandPart
): Template {
  const tags = [
    ["d", part.id],
    ["a", project.address],
    ["brand", part.brand],
    ["deleted"],
  ];
  if (part.part === "file") {
    tags.push(...tombstoneFileTags(part));
  }
  return { content: "", kind: BRAND_PART_KIND, tags };
}

/** The brand's name as file names start with it. */
export function brandSlug(brand: Pick<Brand, "title">): string {
  return slugify(brand.title) || "brand";
}

// ———————————————————————————————————————— Files

/** Images a browser shows in place, best first: an SVG stays sharp at any size. */
const SHOWN_TYPES = [
  "image/svg+xml",
  "image/png",
  "image/webp",
  "image/avif",
  "image/jpeg",
  "image/gif",
];
const FONT_FILE = /\.(?:woff2?|otf|ttf)$/iu;
/** Logos that aren't images to a browser: vectors and print files. */
const LOGO_FILE = /\.(?:svg|pdf|eps|ai)$/iu;
/** Kept in the order a logo stands for the brand when there's no symbol. */
const MARK_ORDER: LogoKind[] = ["symbol", "icon", "lockup", "wordmark"];

/** How well a file shows in place: lower is better, and -1 doesn't show at all. */
function shownRank(type: string): number {
  return SHOWN_TYPES.indexOf(type.toLowerCase());
}

export function isShown(file: { type: string }): boolean {
  return shownRank(file.type) >= 0;
}

/** What a place takes, and what's said of a file it doesn't. */
export function placeFit(kind: BrandPlaceKind): {
  fits: (file: { name: string; type: string }) => boolean;
  misfit: string;
} {
  switch (kind) {
    case "font": {
      return {
        fits: (file) => FONT_FILE.test(file.name),
        misfit: "Typefaces take WOFF2, WOFF, OTF or TTF files.",
      };
    }
    case "logo": {
      return {
        fits: (file) =>
          file.type.startsWith("image/") || LOGO_FILE.test(file.name),
        misfit: "Logos take images, like SVG or PNG, or PDF, EPS and AI files.",
      };
    }
    default: {
      return {
        fits: isShown,
        misfit: "This takes images, like SVG, PNG, JPG or WebP.",
      };
    }
  }
}

export function sameBrandPlace(a: BrandPlace, b: BrandPlace): boolean {
  if (a.kind === "logo" && b.kind === "logo") {
    return a.logo === b.logo && a.mode === b.mode;
  }
  if (a.kind === "font" && b.kind === "font") {
    return a.font === b.font;
  }
  return a.kind === b.kind;
}

/** The files of a place, in order. */
export function filesIn(files: BrandFile[], place: BrandPlace): BrandFile[] {
  return files.filter((file) => sameBrandPlace(file.place, place));
}

/** The files of a kind of place, in order. */
export function filesOf(files: BrandFile[], kind: BrandPlaceKind): BrandFile[] {
  return files.filter((file) => file.place.kind === kind);
}

/** The file of a slot to show: the best image among its formats. */
export function shownFile<T extends { type: string; createdAt: number }>(
  files: T[]
): T | undefined {
  return files
    .filter(isShown)
    .toSorted(
      (a, b) =>
        shownRank(a.type) - shownRank(b.type) || a.createdAt - b.createdAt
    )[0];
}

/** The logo of a kind to show for a background: one made for it, else the other's. */
export function logoFor(
  files: BrandFile[],
  kinds: readonly LogoKind[],
  mode: LogoMode
): { file: BrandFile; mode: LogoMode } | undefined {
  const other: LogoMode = mode === "light" ? "dark" : "light";
  for (const wanted of [mode, other]) {
    for (const logo of kinds) {
      const file = shownFile(
        filesIn(files, { kind: "logo", logo, mode: wanted })
      );
      if (file) {
        return { file, mode: wanted };
      }
    }
  }
  return undefined;
}

/**
 * The logo that stands for the brand on cards and in lists: its symbol for
 * light backgrounds if there's one, else whatever logo comes closest.
 */
export function pickMark(
  files: BrandFile[]
): { file: BrandFile; mode: LogoMode } | undefined {
  return logoFor(files, MARK_ORDER, "light");
}

/** The file's extension, lowercase without its dot, or empty. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The format a file is in, as people call it: "SVG", "PNG", "PDF". */
export function formatOf(file: { name: string; type: string }): string {
  const extension = extensionOf(file.name);
  if (extension) {
    return extension === "jpeg" ? "JPG" : extension.toUpperCase();
  }
  return file.type.split("/").at(-1)?.split("+")[0]?.toUpperCase() ?? "File";
}

// ———————————————————————————————————————— Colors

/** The color's channels, 0 to 255. */
export function hexRgb(hex: HexColor): [number, number, number] {
  return [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16)
  ) as [number, number, number];
}

export function formatRgb(hex: HexColor): string {
  return hexRgb(hex).join(", ");
}

/** Hue in degrees, saturation and lightness in percent. */
export function hexHsl(hex: HexColor): [number, number, number] {
  const [r, g, b] = hexRgb(hex).map((channel) => channel / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) {
    return [0, 0, Math.round(lightness * 100)];
  }
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === r) {
    hue = ((g - b) / delta + 6) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  return [
    Math.round(hue * 60) % 360,
    Math.round(saturation * 100),
    Math.round(lightness * 100),
  ];
}

export function formatHsl(hex: HexColor): string {
  const [h, s, l] = hexHsl(hex);
  return `${h}°, ${s}%, ${l}%`;
}

/** A plain conversion, without a print profile: a starting point for the printer. */
export function hexCmyk(hex: HexColor): [number, number, number, number] {
  const [r, g, b] = hexRgb(hex).map((channel) => channel / 255) as [
    number,
    number,
    number,
  ];
  const key = 1 - Math.max(r, g, b);
  if (key === 1) {
    return [0, 0, 0, 100];
  }
  const ink = (channel: number) =>
    Math.round(((1 - channel - key) / (1 - key)) * 100);
  return [ink(r), ink(g), ink(b), Math.round(key * 100)];
}

export function formatCmyk(hex: HexColor): string {
  return hexCmyk(hex).join(", ");
}

/** WCAG's relative luminance. */
function luminance(hex: HexColor): number {
  const [r, g, b] = hexRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** How far apart two colors read, from 1 to 21, as WCAG measures it. */
export function contrast(a: HexColor, b: HexColor): number {
  const [light, dark] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** What text the contrast passes WCAG for: body text at AA or AAA, or large text only. */
export function contrastGrade(
  ratio: number
): "AAA" | "AA" | "AA Large" | "Fails" {
  if (ratio >= 7) {
    return "AAA";
  }
  if (ratio >= 4.5) {
    return "AA";
  }
  return ratio >= 3 ? "AA Large" : "Fails";
}

export const INK: HexColor = "#0a0d14";
export const PAPER: HexColor = "#ffffff";

/** Whether dark text reads better on the color than light text. */
export function isLight(hex: HexColor): boolean {
  return contrast(hex, INK) >= contrast(hex, PAPER);
}

/** Text that reads on the color. */
export function textOn(hex: HexColor): HexColor {
  return isLight(hex) ? INK : PAPER;
}

/** A gradient across the palette, for where there's nothing else to show. */
export function paletteGradient(
  colors: { hex: HexColor }[]
): string | undefined {
  const [first, second, third] = colors;
  if (!first) {
    return undefined;
  }
  const end = second ?? first;
  const glow = third ?? end;
  return [
    `radial-gradient(120% 140% at 85% 0%, ${glow.hex}cc 0%, transparent 55%)`,
    `radial-gradient(90% 120% at 0% 100%, ${end.hex} 0%, transparent 60%)`,
    `linear-gradient(135deg, ${first.hex}, ${end.hex})`,
  ].join(", ");
}

// ———————————————————————————————————————— Type

export const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

const WEIGHT_WORDS: [RegExp, number][] = [
  [/hairline|thin/u, 100],
  [/extra-?light|ultra-?light/u, 200],
  [/light/u, 300],
  [/semi-?bold|demi-?bold/u, 600],
  [/extra-?bold|ultra-?bold/u, 800],
  [/black|heavy/u, 900],
  [/bold/u, 700],
  [/medium/u, 500],
];

/**
 * A font file's weight and style, told by its name, like
 * `Inter-SemiBoldItalic.woff2`, or `Inter[wght].woff2` for a variable one.
 */
export function faceOfFile(name: string): Face {
  const words = name.toLowerCase().replace(/\.[^.]+$/u, "");
  const style = /italic|oblique/u.test(words) ? "italic" : "normal";
  if (/variable|wght|\[|(?:^|[-_ ])vf(?:$|[-_ ])/u.test(words)) {
    return { style, weight: VARIABLE };
  }
  const weight =
    WEIGHT_WORDS.find(([pattern]) => pattern.test(words))?.[1] ?? 400;
  const numbered = /(?:^|\D)(?<weight>[1-9]00)(?:\D|$)/u.exec(words)?.groups
    ?.weight;
  return { style, weight: numbered ? Number(numbered) : weight };
}

/** Words in a font file's name that tell its face, not its family. */
const FACE_WORDS =
  /\b(?:hairline|thin|extra ?light|ultra ?light|light|regular|book|normal|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy|italic|oblique|variable|vf|wght|[1-9]00)\b/giu;

/** The family a font file's name tells, like "Brand Sans" from `BrandSans-BoldItalic.otf`. */
export function familyOfFile(name: string): string {
  const base = name.replace(/\.[^.]+$/u, "");
  const [family = base] = base.split(/[-_]/u);
  const words = family
    .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower> $<upper>")
    .replaceAll(FACE_WORDS, " ");
  return clean(words, MAX_FONT_FAMILY) || "Typeface";
}

/** A typeface file's weight and style: as set, else as its name tells. */
export function fileFace(file: Pick<FileFields, "face" | "name">): Face {
  return file.face ?? faceOfFile(file.name);
}

/** A face's weight as CSS takes it: one, or the whole range for a variable file. */
export function cssWeight(face: Face): string {
  return face.weight === VARIABLE
    ? `${FONT_WEIGHTS[0]} ${FONT_WEIGHTS.at(-1)}`
    : String(face.weight);
}

/** The weights a typeface comes in: picked from the library, or told by its files. */
export function fontWeights(font: FontFields, files: BrandFile[]): number[] {
  if (font.source === "library") {
    return font.weights.length > 0 ? font.weights : [400];
  }
  const faces = filesIn(files, { font: font.id, kind: "font" }).map(fileFace);
  if (faces.some((face) => face.weight === VARIABLE)) {
    return FONT_WEIGHTS;
  }
  const weights = new Set(faces.map((face) => face.weight));
  return [...weights].toSorted((a, b) => a - b);
}

/** What typefaces are usually for, in the order a role lists them. */
export const FONT_ROLES = ["Headings", "Body", "Display", "Accent", "Code"];

/** The parts of a role, like Headings and Body in "Headings, Body". */
export function roleParts(role: string): string[] {
  return role
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function namesRole(role: string, part: string): boolean {
  const wanted = part.toLowerCase();
  return roleParts(role).some((item) => item.toLowerCase() === wanted);
}

/**
 * The typefaces headings and body text are set in: the ones whose roles say
 * so, else the first and the next.
 */
export function textFonts<T extends Pick<FontFields, "role">>(
  fonts: T[]
): { heading?: T; body?: T } {
  const heading =
    fonts.find((font) => namesRole(font.role, "Headings")) ?? fonts[0];
  const body =
    fonts.find((font) => namesRole(font.role, "Body")) ?? fonts[1] ?? heading;
  return { body, heading };
}

/**
 * The family the page draws a typeface in. Uploaded ones go by a name of
 * their own, so they never mix with a font of the same name on the device.
 */
/**
 * The family an uploaded typeface's faces are added under: a name of its
 * own, so it never mixes with a font of the same name on the device, and
 * one any browser takes as a family name.
 */
export function uploadedFamily(font: Pick<FontFields, "id">): string {
  return `bf-${font.id}`;
}

export function cssFamily(
  font: Pick<FontFields, "family" | "id" | "source">
): string {
  const family = font.source === "library" ? font.family : uploadedFamily(font);
  return `"${family.replaceAll('"', "")}", ui-sans-serif, system-ui, sans-serif`;
}

/** Where the font library serves the family in the weights. */
export function libraryFontUrl(family: string, weights: number[]): string {
  const name = encodeURIComponent(family.trim()).replaceAll("%20", "+");
  const axis = weights.length > 0 ? `:wght@${weights.join(";")}` : "";
  return `https://fonts.bunny.net/css2?family=${name}${axis}&display=swap`;
}

/** The family's page in the font library, to read about it or download it. */
export function libraryFontPage(family: string): string {
  return `https://fonts.bunny.net/family/${slugify(family, 100)}`;
}

// ———————————————————————————————————————— Tokens

/** Names for the colors as tokens: their names slugged, else their place, none twice. */
export function tokenNames(colors: Pick<ColorFields, "name">[]): string[] {
  const taken = new Set<string>();
  return colors.map((color, index) => {
    const base = slugify(color.name) || `color-${index + 1}`;
    let name = base;
    for (let number = 2; taken.has(name); number += 1) {
      name = `${base}-${number}`;
    }
    taken.add(name);
    return name;
  });
}

export type TokenFormat = "css" | "tailwind" | "json" | "dtcg";

export const TOKEN_FORMATS: { format: TokenFormat; label: string }[] = [
  { format: "css", label: "CSS variables" },
  { format: "tailwind", label: "Tailwind theme" },
  { format: "json", label: "JSON" },
  { format: "dtcg", label: "Design tokens (W3C)" },
];

/** Names for the typefaces as tokens: their roles, else their place. */
function fontTokens(
  fonts: Pick<FontFields, "family" | "role">[]
): [string, string][] {
  const taken = new Set<string>();
  return fonts.flatMap((font, index) => {
    const roles = roleParts(font.role).map((role) => slugify(role));
    const names = roles.filter((role) => role && !taken.has(role));
    const named = names.length > 0 ? names : [`font-${index + 1}`];
    for (const name of named) {
      taken.add(name);
    }
    return named.map((name): [string, string] => [name, font.family]);
  });
}

function fallback(family: string): string {
  return `"${family.replaceAll('"', "")}", sans-serif`;
}

/** The brand's colors and typefaces as code to paste. */
export function brandTokens(
  brand: Pick<Brand, "title">,
  colors: Pick<ColorFields, "name" | "hex">[],
  fonts: Pick<FontFields, "family" | "role">[],
  format: TokenFormat
): string {
  const names = tokenNames(colors);
  const colorPairs = colors.map((color, index): [string, string] => [
    names[index] ?? "",
    color.hex,
  ]);
  const fontPairs = fontTokens(fonts);
  if (format === "json") {
    return `${JSON.stringify(
      {
        colors: Object.fromEntries(colorPairs),
        fonts: Object.fromEntries(fontPairs),
      },
      null,
      2
    )}\n`;
  }
  if (format === "dtcg") {
    return `${JSON.stringify(
      {
        color: Object.fromEntries(
          colorPairs.map(([name, hex]) => [
            name,
            { $type: "color", $value: hex },
          ])
        ),
        font: Object.fromEntries(
          fontPairs.map(([name, family]) => [
            name,
            { $type: "fontFamily", $value: [family, "sans-serif"] },
          ])
        ),
      },
      null,
      2
    )}\n`;
  }
  if (format === "tailwind") {
    const lines = [
      ...colorPairs.map(([name, hex]) => `  --color-${name}: ${hex};`),
      ...fontPairs.map(
        ([name, family]) => `  --font-${name}: ${fallback(family)};`
      ),
    ];
    return `@theme {\n${lines.join("\n")}\n}\n`;
  }
  const slug = brandSlug(brand);
  const lines = [
    ...colorPairs.map(([name, hex]) => `  --${slug}-${name}: ${hex};`),
    ...fontPairs.map(
      ([name, family]) => `  --${slug}-font-${name}: ${fallback(family)};`
    ),
  ];
  return `:root {\n${lines.join("\n")}\n}\n`;
}
