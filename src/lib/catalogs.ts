/**
 * Catalogs: links a project saves, which the team's reader service reads,
 * titles, sums up and files under the catalog's categories. Catalogs and
 * links are addressable events any member writes, like doc pages: the newest
 * version across the members wins. The reader writes what it made of each
 * link as an event of its own, which shows under whatever people changed by
 * hand. No browser APIs here: the reader and the notifier use it too.
 */
import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import { mentionedPubkeys } from "@/lib/mentions";
import type { Template } from "@/lib/model";
import {
  addressOf,
  CATALOG_KIND,
  COMMENT_KIND,
  commentPeopleTags,
  integer,
  isDeleted,
  isPubkey,
  latestVersions,
  LINK_KIND,
  PROJECT_KIND,
  READING_KIND,
} from "@/lib/model";
import type { Color } from "@/lib/palette";
import { COLORS } from "@/lib/palette";
import type { Project } from "@/lib/project";

export const MAX_CATALOG_NAME = 80;
export const MAX_CATALOG_DESCRIPTION = 500;
/** Categories one catalog keeps. */
export const MAX_CATEGORIES = 40;
export const MAX_CATEGORY_NAME = 40;
/** Categories one link is filed under. */
export const MAX_LINK_CATEGORIES = 3;
/** New categories the reader suggests for one link. */
export const MAX_SUGGESTED = 2;
/** Suggestions waved away that a catalog remembers, the oldest dropped first. */
const MAX_DISMISSED = 100;
export const MAX_NOTE = 2000;
export const MAX_LINK_TITLE = 200;
export const MAX_SUMMARY = 400;
/** What a page says about itself, or a post's own words, as kept. */
export const MAX_EXCERPT = 1000;
export const MAX_BYLINE = 120;
/** Links saved from one paste. */
export const MAX_LINKS_AT_ONCE = 50;
export const MAX_LINK_URL = 2048;
/** Links moved, filed or deleted in one go, each a change of its own to sign. */
export const MAX_LINK_BATCH = 500;

const HEX_32 = /^[0-9a-f]{64}$/u;
const HEX_12 = /^[0-9a-f]{24}$/u;
const DIMENSIONS = /^(?<width>\d+)x(?<height>\d+)$/u;
const IMAGE_TYPE = /^image\/[a-z0-9.+-]+$/u;

// ———————————————————————————————————————— What links are

/** What a link is, as cards show it. */
export const LINK_TYPES = [
  "video",
  "short",
  "post",
  "article",
  "podcast",
  "music",
  "repo",
  "product",
  "other",
] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export const LINK_TYPE_NAMES: Record<LinkType, string> = {
  article: "Article",
  music: "Music",
  other: "Other",
  podcast: "Podcast",
  post: "Post",
  product: "Product",
  repo: "Repo",
  short: "Short video",
  video: "Video",
};

export function isLinkType(value: string | undefined): value is LinkType {
  return LINK_TYPES.some((type) => type === value);
}

/** Where a link stands: being read, read, or not readable. */
export type LinkState = "reading" | "ready" | "failed";

/** Fields people can change by hand; what they set shows over what was read. */
export const LINK_FIELDS = [
  "title",
  "summary",
  "categories",
  "type",
  "creator",
] as const;
export type LinkField = (typeof LINK_FIELDS)[number];

interface PlatformInfo {
  id: string;
  name: string;
  /** Hosts its links are on, without `www.`; subdomains count too. */
  hosts: readonly string[];
}

/** Where links come from, told by their address. Ids match the icons the app has. */
const PLATFORM_LIST = [
  { hosts: ["youtube.com", "youtu.be"], id: "youtube", name: "YouTube" },
  { hosts: ["tiktok.com"], id: "tiktok", name: "TikTok" },
  { hosts: ["x.com", "twitter.com"], id: "x", name: "X" },
  { hosts: ["instagram.com"], id: "instagram", name: "Instagram" },
  {
    hosts: ["facebook.com", "fb.com", "fb.watch"],
    id: "facebook",
    name: "Facebook",
  },
  { hosts: ["linkedin.com"], id: "linkedin", name: "LinkedIn" },
  { hosts: ["threads.net", "threads.com"], id: "threads", name: "Threads" },
  { hosts: ["bsky.app"], id: "bluesky", name: "Bluesky" },
  { hosts: ["reddit.com", "redd.it"], id: "reddit", name: "Reddit" },
  { hosts: ["github.com"], id: "github", name: "GitHub" },
  { hosts: ["spotify.com"], id: "spotify", name: "Spotify" },
  { hosts: ["soundcloud.com"], id: "soundcloud", name: "SoundCloud" },
  { hosts: ["twitch.tv"], id: "twitch", name: "Twitch" },
  { hosts: ["pinterest.com", "pin.it"], id: "pinterest", name: "Pinterest" },
  { hosts: ["vimeo.com"], id: "vimeo", name: "Vimeo" },
  { hosts: ["substack.com"], id: "substack", name: "Substack" },
  { hosts: ["medium.com"], id: "medium", name: "Medium" },
  {
    hosts: ["njump.me", "primal.net", "iris.to", "snort.social"],
    id: "nostr",
    name: "Nostr",
  },
] as const satisfies readonly PlatformInfo[];

export const LINK_PLATFORMS: readonly PlatformInfo[] = PLATFORM_LIST;

export type LinkPlatform = (typeof PLATFORM_LIST)[number]["id"] | "web";

const WWW = /^(?:www\.|m\.|mobile\.)/u;

/** The address's host, lowercase, without `www.` or a mobile `m.`. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(WWW, "");
  } catch {
    return "";
  }
}

/** The platform a link is on, or `web` for anywhere else. */
export function platformOf(url: string): LinkPlatform {
  const host = hostOf(url);
  const found = PLATFORM_LIST.find((platform) =>
    platform.hosts.some(
      (known: string) => host === known || host.endsWith(`.${known}`)
    )
  );
  return found?.id ?? "web";
}

export function platformName(platform: string): string {
  return LINK_PLATFORMS.find((item) => item.id === platform)?.name ?? "Website";
}

/** What a link is, by where it's from, before anything says otherwise. */
export function platformType(platform: string): LinkType {
  switch (platform) {
    case "youtube":
    case "vimeo":
    case "twitch": {
      return "video";
    }
    case "tiktok": {
      return "short";
    }
    case "x":
    case "threads":
    case "bluesky":
    case "reddit":
    case "linkedin":
    case "facebook":
    case "instagram":
    case "nostr": {
      return "post";
    }
    case "github": {
      return "repo";
    }
    case "spotify":
    case "soundcloud": {
      return "music";
    }
    case "substack":
    case "medium": {
      return "article";
    }
    default: {
      return "other";
    }
  }
}

/** Query parameters that only say where a link was shared from. */
const TRACKING = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igsh",
  "igshid",
  "si",
  "feature",
  "ref_src",
  "ref_url",
  "s",
  "_r",
  "_t",
  "is_from_webapp",
  "sender_device",
  "share_app_id",
  "share_link_id",
  "utm_id",
]);

function isTracking(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING.has(lower);
}

/** A YouTube video's id, from any of the addresses it goes by. */
export function youtubeId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase().replace(WWW, "");
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") {
    return parts[0];
  }
  if (!host.endsWith("youtube.com")) {
    return undefined;
  }
  if (parts[0] === "watch") {
    return parsed.searchParams.get("v") ?? undefined;
  }
  if (["shorts", "live", "embed"].includes(parts[0] ?? "")) {
    return parts[1];
  }
  return undefined;
}

/** Whether a YouTube address is a Short, which plays upright. */
export function isYoutubeShort(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith("/shorts/");
  } catch {
    return false;
  }
}

/**
 * The address as it's kept: with the parameters that only track who shared
 * it taken off, and without a trailing `#`. Null when it isn't a web address.
 */
export function cleanLink(input: string): string | null {
  const trimmed = input.trim();
  const whole = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(whole);
  } catch {
    return null;
  }
  if (
    !(url.protocol === "https:" || url.protocol === "http:") ||
    !url.hostname.includes(".") ||
    url.username ||
    url.password
  ) {
    return null;
  }
  // Read first: deleting while going through them would skip some.
  const names = new Set(url.searchParams.keys());
  for (const name of names) {
    if (isTracking(name)) {
      url.searchParams.delete(name);
    }
  }
  const text = url.href.replace(/#$/u, "");
  return text.length > MAX_LINK_URL ? null : text;
}

/**
 * What tells two links apart: one saved as `youtu.be/abc?si=…` and again as
 * `www.youtube.com/watch?v=abc` are the same link.
 */
export function linkKey(url: string): string {
  const video = youtubeId(url);
  if (video) {
    return `youtube:${video}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  let host = parsed.hostname.toLowerCase().replace(WWW, "");
  if (host === "twitter.com") {
    host = "x.com";
  }
  const path = parsed.pathname.replace(/\/+$/u, "") || "/";
  const params = [...parsed.searchParams.entries()]
    .filter(([name]) => !isTracking(name))
    .toSorted(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();
  // Posts keep their address case, as their ids do; hosts never matter.
  return `${host}${path}${query ? `?${query}` : ""}`;
}

/** Web addresses in pasted text: `https://…`, `http://…`, or `www.…`. */
const ADDRESS = /(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]]/giu;

/**
 * The links in what someone pasted, each once and in order, and the rest of
 * the text, which is kept as their note on each.
 */
export function splitPasted(text: string): { links: string[]; note: string } {
  const links: string[] = [];
  const seen = new Set<string>();
  for (const [found] of text.matchAll(ADDRESS)) {
    const link = cleanLink(found);
    if (link && !seen.has(linkKey(link))) {
      seen.add(linkKey(link));
      links.push(link);
    }
  }
  const note = text
    .replace(ADDRESS, " ")
    .split("\n")
    .map((line) => line.replaceAll(/[ \t]+/gu, " ").trim())
    .join("\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
  return { links, note };
}

/** A first title, from the address, until the page is read. */
export function addressTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname).replace(/\/+$/u, "");
    return `${hostOf(url)}${path}`.slice(0, MAX_LINK_TITLE);
  } catch {
    return url.slice(0, MAX_LINK_TITLE);
  }
}

/** Text on one line, without doubled spaces, cut to `max` with an ellipsis. */
export function clip(text: string | undefined, max: number): string {
  const clean = (text ?? "").replaceAll(/\s+/gu, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** `YYYY-MM-DD`, or undefined for anything else. */
export function cleanDate(
  value: string | null | undefined
): string | undefined {
  const date = value?.trim().slice(0, 10);
  return date && /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : undefined;
}

// ———————————————————————————————————————— Categories

export interface CatalogCategory {
  id: string;
  name: string;
  color: Color;
}

/** A category name as it's kept: one line, no doubled spaces, not too long. */
export function cleanCategoryName(name: string): string {
  return name.replaceAll(/\s+/gu, " ").trim().slice(0, MAX_CATEGORY_NAME);
}

/** Category names compare without case, so "Security" and "security" clash. */
export function categoryKey(name: string): string {
  return cleanCategoryName(name).toLowerCase();
}

/** The next color for a new category, going round the palette after gray. */
export function nextCategoryColor(
  categories: readonly CatalogCategory[]
): Color {
  const colors = COLORS.filter((color) => color !== "gray");
  return colors[categories.length % colors.length] ?? "blue";
}

// ———————————————————————————————————————— Catalogs

/** Someone asked the reader to sort the catalog's links into a category, and when, in seconds. */
export interface SortRequest {
  category: string;
  at: number;
}

export interface CatalogFields {
  id: string;
  title: string;
  description: string;
  /** In order. */
  categories: CatalogCategory[];
  /** Keys of the suggested categories waved away, the latest last. */
  dismissed: string[];
  /** The latest request to sort each category, if any. */
  sorts: SortRequest[];
  creator?: string;
  createdAt: number;
}

export type Catalog = CatalogFields & {
  /** Address of the project the catalog belongs to. */
  project: string;
  /** Who saved the newest version. */
  author: string;
  updatedAt: number;
  event: NostrEvent;
};

function parseCategories(event: NostrEvent): CatalogCategory[] {
  const seen = new Set<string>();
  const names = new Set<string>();
  const categories: CatalogCategory[] = [];
  for (const [tag, id, name, color] of event.tags) {
    const clean = cleanCategoryName(name ?? "");
    if (
      tag !== "category" ||
      !id ||
      !clean ||
      seen.has(id) ||
      names.has(categoryKey(clean))
    ) {
      continue;
    }
    seen.add(id);
    names.add(categoryKey(clean));
    categories.push({
      color: COLORS.find((item) => item === color) ?? "gray",
      id,
      name: clean,
    });
  }
  return categories.slice(0, MAX_CATEGORIES);
}

function parseCatalog(event: NostrEvent, id: string, project: string): Catalog {
  const categories = parseCategories(event);
  const known = new Set(categories.map((category) => category.id));
  const sorts = new Map<string, number>();
  for (const [tag, category, at] of event.tags) {
    const time = integer(at);
    if (tag === "sort" && category && known.has(category) && time) {
      sorts.set(category, Math.max(time, sorts.get(category) ?? 0));
    }
  }
  return {
    author: event.pubkey,
    categories,
    createdAt: integer(getTagValue(event, "created")) ?? event.created_at,
    creator: [getTagValue(event, "creator")].find(isPubkey),
    description: (getTagValue(event, "description") ?? "").slice(
      0,
      MAX_CATALOG_DESCRIPTION
    ),
    dismissed: [
      ...new Set(
        event.tags.flatMap(([tag, name]) =>
          tag === "dismissed" && name ? [categoryKey(name)] : []
        )
      ),
    ],
    event,
    id,
    project,
    sorts: [...sorts].map(([category, at]) => ({ at, category })),
    title:
      (getTagValue(event, "title") ?? "").trim().slice(0, MAX_CATALOG_NAME) ||
      "Untitled",
    updatedAt: event.created_at,
  };
}

export function catalogTemplate(
  project: Pick<Project, "address">,
  catalog: CatalogFields
): Template {
  const tags = [
    ["d", catalog.id],
    ["a", project.address],
    ["title", catalog.title],
    ["description", catalog.description],
    ...catalog.categories.map((category) => [
      "category",
      category.id,
      category.name,
      category.color,
    ]),
    ...catalog.dismissed
      .slice(-MAX_DISMISSED)
      .map((name) => ["dismissed", name]),
    ...catalog.sorts.map((sort) => ["sort", sort.category, String(sort.at)]),
    ["created", String(catalog.createdAt)],
  ];
  if (catalog.creator) {
    tags.push(["creator", catalog.creator]);
  }
  tags.push(["alt", `Catalog: ${catalog.title}`]);
  return { content: "", kind: CATALOG_KIND, tags };
}

// ———————————————————————————————————————— Links

/** Who made what a link goes to, as its page names them. */
export interface Byline {
  name: string;
  url?: string;
}

/** What people changed about a link by hand: each shows over what was read. */
export interface LinkEdits {
  title?: string;
  summary?: string;
  type?: LinkType;
  /** Missing name: taken off by hand. */
  byline?: Byline | null;
  /** Category ids, once filed by hand; empty when taken out of all. */
  filed?: string[];
}

export interface LinkFields {
  id: string;
  /** The `d` tag of the catalog it's in. */
  catalog: string;
  url: string;
  /** What whoever saved it wrote with it. The reader reads it too. */
  note: string;
  /** Who saved it, and when, in seconds. */
  creator: string;
  createdAt: number;
  edits: LinkEdits;
  /** When someone last asked for it to be read again, in seconds. */
  readAt?: number;
}

export type SavedLink = LinkFields & {
  /** Address of the project the link belongs to. */
  project: string;
  /** Who saved the newest version. */
  author: string;
  updatedAt: number;
  event: NostrEvent;
};

function parseByline(tag: string[] | undefined): Byline | null | undefined {
  if (!tag) {
    return undefined;
  }
  const [, written, url] = tag;
  const name = clip(written, MAX_BYLINE);
  if (!name) {
    return null;
  }
  return url && /^https?:\/\//iu.test(url) ? { name, url } : { name };
}

function parseEdits(event: NostrEvent): LinkEdits {
  const title = clip(getTagValue(event, "title"), MAX_LINK_TITLE);
  const summary = getTagValue(event, "summary");
  const type = getTagValue(event, "type");
  const filed = event.tags.find(([tag]) => tag === "filed");
  return {
    byline: parseByline(event.tags.find(([tag]) => tag === "byline")),
    filed: filed
      ? [...new Set(filed.slice(1).filter(Boolean))].slice(
          0,
          MAX_LINK_CATEGORIES
        )
      : undefined,
    summary:
      summary === undefined ? undefined : summary.trim().slice(0, MAX_SUMMARY),
    title: title || undefined,
    type: isLinkType(type) ? type : undefined,
  };
}

/** The link in its newest version, or nothing when it can't be read, like one without an address. */
function parseLink(
  event: NostrEvent,
  id: string,
  project: string
): SavedLink | undefined {
  const url = cleanLink(getTagValue(event, "r") ?? "");
  const catalog = getTagValue(event, "catalog");
  if (!(url && catalog)) {
    return undefined;
  }
  const createdAt = integer(getTagValue(event, "created")) ?? event.created_at;
  return {
    author: event.pubkey,
    catalog,
    createdAt,
    creator: [getTagValue(event, "creator")].find(isPubkey) ?? event.pubkey,
    edits: parseEdits(event),
    event,
    id,
    note: event.content.slice(0, MAX_NOTE),
    project,
    readAt: integer(getTagValue(event, "read")),
    updatedAt: event.created_at,
    url,
  };
}

export function linkTemplate(
  project: Pick<Project, "address">,
  link: LinkFields
): Template {
  const { edits } = link;
  const tags = [
    ["d", link.id],
    ["a", project.address],
    ["catalog", link.catalog],
    ["r", link.url],
    ["creator", link.creator],
    ["created", String(link.createdAt)],
  ];
  if (edits.title) {
    tags.push(["title", edits.title]);
  }
  if (edits.summary !== undefined) {
    tags.push(["summary", edits.summary]);
  }
  if (edits.type) {
    tags.push(["type", edits.type]);
  }
  if (edits.byline !== undefined) {
    const { name = "", url } = edits.byline ?? {};
    tags.push(url ? ["byline", name, url] : ["byline", name]);
  }
  if (edits.filed) {
    tags.push(["filed", ...edits.filed]);
  }
  if (link.readAt) {
    tags.push(["read", String(link.readAt)]);
  }
  tags.push(["alt", `Link: ${link.url}`]);
  return { content: link.note, kind: LINK_KIND, tags };
}

/** Deletes a catalog or a link for good. */
export function catalogTombstoneTemplate(
  project: Pick<Project, "address">,
  item: { id: string; event: NostrEvent }
): Template {
  return {
    content: "",
    kind: item.event.kind,
    tags: [["d", item.id], ["a", project.address], ["deleted"]],
  };
}

/** Where comments and reactions on the link may point: its address under every member. */
export function linkAddresses(
  project: Pick<Project, "members">,
  link: Pick<SavedLink, "id">
): string[] {
  return project.members.map((member) => `${LINK_KIND}:${member}:${link.id}`);
}

/**
 * A NIP-22 comment on a link, with a `p` tag for everyone it mentions, and
 * one for whoever saved it, who's told as if they subscribed to it.
 */
export function linkCommentTemplate(
  link: Pick<SavedLink, "id" | "author" | "creator">,
  content: string
): Template {
  const address = `${LINK_KIND}:${link.author}:${link.id}`;
  return {
    content,
    kind: COMMENT_KIND,
    tags: [
      ["A", address],
      ["K", String(LINK_KIND)],
      ["P", link.author],
      ["a", address],
      ["k", String(LINK_KIND)],
      ...commentPeopleTags(link.author, mentionedPubkeys(content), [
        link.creator,
      ]),
    ],
  };
}

// ———————————————————————————————————————— What the reader made of them

/** A link's picture, copied to the team's Blossom servers, sealed like a Drive file's. */
export interface LinkThumb {
  hash: string;
  nonce: string;
  key: string;
  /** The picture's MIME type, once opened. */
  type: string;
  width?: number;
  height?: number;
}

export interface ReadingFields {
  /** The link's `d` tag. */
  link: string;
  /** The address that was read. */
  url: string;
  state: "ready" | "failed";
  /** The request to read it again that this answers, in seconds, or 0. */
  readAt: number;
  title?: string;
  /** The title the page gives, when the one written differs, like one in another language. */
  originalTitle?: string;
  summary?: string;
  type?: LinkType;
  byline?: Byline;
  /** `YYYY-MM-DD`. */
  publishedAt?: string;
  /** Seconds. */
  duration?: number;
  siteName?: string;
  /** What the page says about itself, or a post's own words. */
  excerpt?: string;
  thumb?: LinkThumb;
  /** Where the picture is on the web, when it couldn't be copied. */
  image?: string;
  /** Category ids the link was filed under, best first. */
  categories: string[];
  /** New categories it would be filed under, by name. */
  suggested: string[];
}

export type Reading = ReadingFields & { event: NostrEvent };

function parseThumb(event: NostrEvent): LinkThumb | undefined {
  const tag = event.tags.find(([name]) => name === "thumb");
  const [, hash, nonce, key, type] = tag ?? [];
  if (!(hash && nonce && key)) {
    return undefined;
  }
  if (!(HEX_32.test(hash) && HEX_12.test(nonce) && HEX_32.test(key))) {
    return undefined;
  }
  const size = DIMENSIONS.exec(getTagValue(event, "dim") ?? "")?.groups;
  const width = Number(size?.width) || undefined;
  const height = Number(size?.height) || undefined;
  return {
    hash,
    height,
    key,
    nonce,
    type: type && IMAGE_TYPE.test(type) ? type : "image/jpeg",
    width,
  };
}

function parseReading(event: NostrEvent): Reading | undefined {
  const link = getTagValue(event, "d");
  const url = getTagValue(event, "r");
  if (!(link && url) || getTagValue(event, "k") !== String(LINK_KIND)) {
    return undefined;
  }
  const type = getTagValue(event, "type");
  const image = getTagValue(event, "image");
  return {
    byline:
      parseByline(event.tags.find(([tag]) => tag === "byline")) ?? undefined,
    categories: [
      ...new Set(
        event.tags.flatMap(([tag, id]) => (tag === "c" && id ? [id] : []))
      ),
    ].slice(0, MAX_LINK_CATEGORIES),
    duration: integer(getTagValue(event, "duration")) || undefined,
    event,
    excerpt: event.content.slice(0, MAX_EXCERPT) || undefined,
    image: image && /^https?:\/\//iu.test(image) ? image : undefined,
    link,
    originalTitle:
      clip(getTagValue(event, "original"), MAX_LINK_TITLE) || undefined,
    publishedAt: cleanDate(getTagValue(event, "published")),
    readAt: integer(getTagValue(event, "read")) ?? 0,
    siteName: clip(getTagValue(event, "site"), MAX_BYLINE) || undefined,
    state: getTagValue(event, "state") === "failed" ? "failed" : "ready",
    suggested: event.tags
      .flatMap(([tag, name]) =>
        tag === "suggest" && name ? [cleanCategoryName(name)] : []
      )
      .filter(Boolean)
      .slice(0, MAX_SUGGESTED),
    summary: getTagValue(event, "summary")?.slice(0, MAX_SUMMARY),
    thumb: parseThumb(event),
    title: clip(getTagValue(event, "title"), MAX_LINK_TITLE) || undefined,
    type: isLinkType(type) ? type : undefined,
    url,
  };
}

/** What the reader made of a link. Its `d` tag is the link's. */
export function readingTemplate(
  project: Pick<Project, "address">,
  reading: ReadingFields
): Template {
  const tags = [
    ["d", reading.link],
    ["a", project.address],
    ["k", String(LINK_KIND)],
    ["r", reading.url],
    ["state", reading.state],
    ["read", String(reading.readAt)],
  ];
  const add = (name: string, value: string | undefined) => {
    if (value) {
      tags.push([name, value]);
    }
  };
  add("title", reading.title);
  add("original", reading.originalTitle);
  add("summary", reading.summary);
  add("type", reading.type);
  if (reading.byline) {
    tags.push(
      reading.byline.url
        ? ["byline", reading.byline.name, reading.byline.url]
        : ["byline", reading.byline.name]
    );
  }
  add("published", reading.publishedAt);
  add("duration", reading.duration ? String(reading.duration) : undefined);
  add("site", reading.siteName);
  if (reading.thumb) {
    const { hash, nonce, key, type, width, height } = reading.thumb;
    tags.push(["thumb", hash, nonce, key, type]);
    if (width && height) {
      tags.push(["dim", `${width}x${height}`]);
    }
  }
  add("image", reading.image);
  for (const id of reading.categories) {
    tags.push(["c", id]);
  }
  for (const name of reading.suggested) {
    tags.push(["suggest", name]);
  }
  tags.push(["alt", `What a link's page says: ${reading.url}`]);
  return { content: reading.excerpt ?? "", kind: READING_KIND, tags };
}

/** How sorting a catalog's links into one of its categories went. */
export type SortReport =
  | { category: string; at: number; ok: true; filed: number; checked: number }
  | { category: string; at: number; ok: false; reason: SortFailure };

/** Why sorting didn't run: no AI on the reader, too many runs lately, or the model failed. */
export type SortFailure = "off" | "limit" | "failed";

const SORT_FAILURES: readonly SortFailure[] = ["off", "limit", "failed"];

function parseSortReports(event: NostrEvent): SortReport[] {
  return event.tags.flatMap(([tag, category, at, ...rest]): SortReport[] => {
    const time = integer(at);
    if (!(category && time)) {
      return [];
    }
    if (tag === "sorted") {
      return [
        {
          at: time,
          category,
          checked: integer(rest[1]) ?? 0,
          filed: integer(rest[0]) ?? 0,
          ok: true,
        },
      ];
    }
    const reason = SORT_FAILURES.find((item) => item === rest[0]);
    return tag === "unsorted" && reason
      ? [{ at: time, category, ok: false, reason }]
      : [];
  });
}

/** How the reader's latest sorting of each of the catalog's categories went. Its `d` tag is the catalog's. */
export function sortReportTemplate(
  project: Pick<Project, "address">,
  catalog: string,
  reports: SortReport[]
): Template {
  return {
    content: "",
    kind: READING_KIND,
    tags: [
      ["d", catalog],
      ["a", project.address],
      ["k", String(CATALOG_KIND)],
      ...reports.map((report) =>
        report.ok
          ? [
              "sorted",
              report.category,
              String(report.at),
              String(report.filed),
              String(report.checked),
            ]
          : ["unsorted", report.category, String(report.at), report.reason]
      ),
      ["alt", "How sorting a catalog's links went"],
    ],
  };
}

// ———————————————————————————————————————— Links as shown

/** A link as the app shows it: what was read, with what people changed over it. */
export interface Link {
  id: string;
  /** The `d` tag of the catalog it's in. */
  catalog: string;
  /** Address of the project. */
  project: string;
  url: string;
  /** What tells it apart from the same link saved again. */
  key: string;
  platform: LinkPlatform;
  type: LinkType;
  title: string;
  originalTitle?: string;
  summary: string;
  note: string;
  byline?: Byline;
  /** Category ids, at most three, in the catalog's order. */
  categories: string[];
  /** New categories the reader would file it under, by name. */
  suggested: string[];
  excerpt?: string;
  siteName?: string;
  publishedAt?: string;
  duration?: number;
  thumb?: LinkThumb;
  image?: string;
  savedBy: string;
  /** When it was saved, in seconds. */
  savedAt: number;
  updatedAt: number;
  state: LinkState;
  /** Fields changed by hand. */
  edited: LinkField[];
  /** The newest version of the link itself, by a member. */
  event: NostrEvent;
  author: string;
  /** What the reader made of it, when it has read it. */
  reading?: Reading;
  /** The link as saved, for changes made to it. */
  saved: SavedLink;
}

function editedFields(edits: LinkEdits): LinkField[] {
  const fields: LinkField[] = [];
  if (edits.title) {
    fields.push("title");
  }
  if (edits.summary !== undefined) {
    fields.push("summary");
  }
  if (edits.filed) {
    fields.push("categories");
  }
  if (edits.type) {
    fields.push("type");
  }
  if (edits.byline !== undefined) {
    fields.push("creator");
  }
  return fields;
}

/**
 * Where it's filed: by hand, or else where the reader filed it, plus any
 * category it suggested that the catalog has since, as accepting the
 * suggestion files the links that made it.
 */
function filedUnder(
  catalog: Catalog,
  saved: SavedLink,
  reading: Reading | undefined
): string[] {
  const order = catalog.categories.map((category) => category.id);
  const chosen = saved.edits.filed ?? [
    ...(reading?.categories ?? []),
    ...(reading?.suggested ?? []).flatMap((name) => {
      const found = catalog.categories.find(
        (category) => categoryKey(category.name) === categoryKey(name)
      );
      return found ? [found.id] : [];
    }),
  ];
  const kept = new Set(chosen.filter((id) => order.includes(id)));
  // Filed by hand in order of picking; by the reader, best first, up to three.
  return [...kept]
    .slice(0, MAX_LINK_CATEGORIES)
    .toSorted((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Suggested categories still waiting: not in the catalog yet, nor waved away. */
function stillSuggested(catalog: Catalog, reading: Reading | undefined) {
  const taken = new Set([
    ...catalog.categories.map((category) => categoryKey(category.name)),
    ...catalog.dismissed,
  ]);
  return (reading?.suggested ?? []).filter(
    (name) => !taken.has(categoryKey(name))
  );
}

/** The state shown: read as asked, still being read, or not readable. */
function stateOf(
  saved: SavedLink,
  reading: Reading | undefined,
  reads: boolean
): LinkState {
  if (reading && reading.readAt >= (saved.readAt ?? 0)) {
    return reading.state;
  }
  return reads ? "reading" : "ready";
}

/** What was read of the link that people don't change. */
function readOnly(read: Reading | undefined) {
  return {
    duration: read?.duration,
    excerpt: read?.excerpt,
    image: read?.image,
    publishedAt: read?.publishedAt,
    reading: read,
    siteName: read?.siteName,
    thumb: read?.thumb,
  };
}

/** What people can change, as they set it, or else as it was read. */
function overRead(
  saved: SavedLink,
  read: Reading | undefined,
  platform: LinkPlatform
) {
  const { edits } = saved;
  return {
    byline:
      edits.byline === undefined ? read?.byline : (edits.byline ?? undefined),
    originalTitle: edits.title ? undefined : read?.originalTitle,
    summary: edits.summary ?? read?.summary ?? "",
    title: edits.title ?? read?.title ?? addressTitle(saved.url),
    type: edits.type ?? read?.type ?? platformType(platform),
  };
}

/** The link as shown: what was read, with what people changed by hand over it. */
export function linkView(
  catalog: Catalog,
  saved: SavedLink,
  reading: Reading | undefined,
  reads: boolean
): Link {
  // A reading of another address, like one from before a move, doesn't count.
  const read =
    reading && linkKey(reading.url) === linkKey(saved.url)
      ? reading
      : undefined;
  const platform = platformOf(saved.url);
  return {
    ...readOnly(read),
    ...overRead(saved, read, platform),
    author: saved.author,
    catalog: saved.catalog,
    categories: filedUnder(catalog, saved, read),
    edited: editedFields(saved.edits),
    event: saved.event,
    id: saved.id,
    key: linkKey(saved.url),
    note: saved.note,
    platform,
    project: saved.project,
    saved,
    savedAt: saved.createdAt,
    savedBy: saved.creator,
    state: stateOf(saved, read, reads),
    suggested: stillSuggested(catalog, read),
    updatedAt: Math.max(saved.updatedAt, read?.event.created_at ?? 0),
    url: saved.url,
  };
}

// ———————————————————————————————————————— A project's catalogs

export interface CatalogsContent {
  /** Every catalog, by title. */
  catalogs: Catalog[];
  byId: Map<string, Catalog>;
  /** Every link in a catalog that's there, newest first. */
  links: Link[];
  /** The links in each catalog, newest first. */
  linksIn: Map<string, Link[]>;
  linkById: Map<string, Link>;
  /** How the reader's latest sorting of each catalog's categories went, by catalog id. */
  sorts: Map<string, SortReport[]>;
}

export const EMPTY_CATALOGS: CatalogsContent = {
  byId: new Map(),
  catalogs: [],
  linkById: new Map(),
  links: [],
  linksIn: new Map(),
  sorts: new Map(),
};

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** The project's own events of one kind, by members, newest version of each. */
function ownVersions(
  project: Project,
  events: NostrEvent[],
  kind: number
): Map<string, NostrEvent> {
  const authors = new Set(project.members);
  return latestVersions(
    events.filter(
      (event) =>
        event.kind === kind &&
        addressOf(event, PROJECT_KIND) === project.address
    ),
    kind,
    authors
  );
}

/** The project's catalogs, resolved across every member's versions. */
export function resolveCatalogList(
  project: Project,
  events: NostrEvent[]
): Catalog[] {
  return [...ownVersions(project, events, CATALOG_KIND)]
    .filter(([, event]) => !isDeleted(event))
    .map(([id, event]) => parseCatalog(event, id, project.address))
    .toSorted(
      (a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id)
    );
}

/** The project's links, saved and not deleted, by id, whatever catalog they're in. */
export function resolveSavedLinks(
  project: Project,
  events: NostrEvent[]
): Map<string, SavedLink> {
  const links = new Map<string, SavedLink>();
  for (const [id, event] of ownVersions(project, events, LINK_KIND)) {
    const link = isDeleted(event)
      ? undefined
      : parseLink(event, id, project.address);
    if (link) {
      links.set(id, link);
    }
  }
  return links;
}

/** What the reader wrote in the project, by `d` tag: readings of links, and sort reports by catalog. */
function readerNotes(
  project: Project,
  events: NostrEvent[],
  readers: ReadonlySet<string>
): { readings: Map<string, Reading>; sorts: Map<string, SortReport[]> } {
  const readings = new Map<string, Reading>();
  const sorts = new Map<string, SortReport[]>();
  const notes = latestVersions(
    events.filter(
      (event) =>
        event.kind === READING_KIND &&
        addressOf(event, PROJECT_KIND) === project.address
    ),
    READING_KIND,
    new Set(readers)
  );
  for (const [id, event] of notes) {
    if (getTagValue(event, "k") === String(CATALOG_KIND)) {
      sorts.set(id, parseSortReports(event));
      continue;
    }
    const reading = parseReading(event);
    if (reading) {
      readings.set(id, reading);
    }
  }
  return { readings, sorts };
}

/**
 * The project's catalogs and their links, resolved across every member's
 * versions, with what the reader made of each link. Only `readers` are
 * trusted with readings; without any, links show as saved.
 */
export function resolveCatalogs(
  project: Project,
  events: NostrEvent[],
  readers: ReadonlySet<string>
): CatalogsContent {
  const catalogs = resolveCatalogList(project, events);
  const byId = new Map(catalogs.map((catalog) => [catalog.id, catalog]));
  const { readings, sorts } = readerNotes(project, events, readers);
  const links: Link[] = [];
  for (const saved of resolveSavedLinks(project, events).values()) {
    const catalog = byId.get(saved.catalog);
    if (catalog) {
      links.push(
        linkView(catalog, saved, readings.get(saved.id), readers.size > 0)
      );
    }
  }
  const newest = links.toSorted(
    (a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id)
  );
  const linksIn = new Map<string, Link[]>();
  for (const link of newest) {
    linksIn.set(link.catalog, [...(linksIn.get(link.catalog) ?? []), link]);
  }
  return {
    byId,
    catalogs,
    linkById: new Map(newest.map((link) => [link.id, link])),
    links: newest,
    linksIn,
    sorts,
  };
}

/** One link's newest version in the project, by its members, unless it was deleted. */
export function resolveLink(
  project: Project,
  events: NostrEvent[],
  id: string
): SavedLink | undefined {
  return resolveSavedLinks(
    project,
    events.filter((event) => getTagValue(event, "d") === id)
  ).get(id);
}

/** What the reader made of one link, if a trusted reader read it. */
export function resolveReading(
  project: Project,
  events: NostrEvent[],
  readers: ReadonlySet<string>
): Reading | undefined {
  const [reading] = readerNotes(project, events, readers).readings.values();
  return reading;
}
