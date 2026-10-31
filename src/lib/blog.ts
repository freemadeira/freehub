/**
 * Blog posts, written in a project and published on a website by its
 * indexer, as NIP-23 long-form events: one per language, a draft (30024)
 * saved as people type and a published version (30023) written on Publish.
 * No browser APIs here, so tests run it as is.
 */
import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import type { Tokens } from "marked";
import { Marked } from "marked";

import type { WebsiteConfig } from "@/config";
import { isSigned } from "@/lib/docs";
import type { Template } from "@/lib/model";
import {
  addressOf,
  integer,
  isDeleted,
  isPubkey,
  latestVersions,
  POST_DRAFT_KIND,
  POST_KIND,
  PROJECT_KIND,
} from "@/lib/model";
import type { Project } from "@/lib/project";
import { cleanSlugInput, slugify } from "@/lib/project";

export type PostKind = typeof POST_KIND | typeof POST_DRAFT_KIND;

/** The language tags say which language a version is in, as NIP-32 labels. */
const LANGUAGE_LABELS = "ISO-639-1";
const AUTHOR = "author";
const WEBP = "image/webp";
/** A version's `d` tag: the post's id, then its language. */
const POST_ADDRESS = /^(?<post>[0-9a-f]{16})-(?<locale>[a-z]{2})$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DIMENSIONS = /^(?<width>\d+)x(?<height>\d+)$/u;
const SIZE = /^(?<url>\S+)\s+(?<width>\d+)w$/u;
/** Long enough for a sentence-long title, short enough to read in a link. */
const MAX_SLUG = 80;
/** WebP can't be wider or taller than this. */
const MAX_WEBP_SIDE = 16_383;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The widths a picture is drawn at, so the website can pick one for the screen. */
export const IMAGE_WIDTHS = [640, 1280, 1920] as const;

/** One size a picture comes in. */
export interface ImageSize {
  url: string;
  width: number;
}

/** A picture uploaded for a post, as its `imeta` tag describes it (NIP-92). */
export interface ImageMeta {
  /** The largest size's address, which the text and the cover name. */
  url: string;
  /** The largest size's SHA-256, the name the Blossom server knows it by. */
  hash: string;
  width: number;
  height: number;
  /** Words that say what it shows, for people who can't see it. */
  alt: string;
  /** Every size it comes in, smallest first. */
  sizes: ImageSize[];
}

/** A picture in a post's text: its address and alt text, as the Markdown has them. */
export interface TextImage {
  url: string;
  alt: string;
}

/** One language of a post, as a version of it says. */
export interface PostFields {
  /** The post's id, shared by its languages. */
  post: string;
  /** The language, as an ISO 639-1 code. */
  locale: string;
  title: string;
  /** Its link on the website in this language: lowercase letters, digits and hyphens. */
  slug: string;
  /**
   * Links it was published under before, which the website sends on to
   * `slug`. Kept on every version, since the relay keeps only the newest.
   */
  oldSlugs: string[];
  summary: string;
  /** The text, as Markdown. */
  content: string;
  /** The cover picture's address, its largest size. Shared by the languages. */
  cover?: string;
  /** The cover's alt text, in this language. */
  coverAlt: string;
  /** When it was first published, in seconds; kept on updates. */
  publishedAt?: number;
  /** Shared by the languages. */
  topics: string[];
  /** Who the post is from: its byline. Shared by the languages. */
  authors: string[];
  /** What's known of the pictures it uses: their sizes, hash and dimensions. */
  images: ImageMeta[];
}

export type PostVersion = PostFields & {
  /** Who saved this version. */
  author: string;
  updatedAt: number;
  event: NostrEvent;
};

/** Where a language of a post stands. */
export type PostStatus =
  /** Never published, or unpublished. */
  | "draft"
  | "published"
  /** Published, and edited since. */
  | "changed";

/** One language of a post: its newest draft and its newest published version. */
export interface PostLanguage {
  locale: string;
  /** The newest draft by a member, unless it was discarded. */
  draft?: PostVersion;
  /** The newest published version by a member, unless it was unpublished. */
  published?: PostVersion;
  /**
   * The newest 30023 by a member, unpublishing included: the version the
   * next one replaces, so it always comes after it.
   */
  publishedEvent?: NostrEvent;
  /**
   * Every link the language was published under, current or old, even once
   * it's unpublished: links the website may still be sending readers to.
   */
  publishedSlugs: string[];
  /** Each member's newest draft, to merge edits made at once. */
  drafts: NostrEvent[];
}

export interface Post {
  id: string;
  /** The languages written, in the website's order. */
  languages: PostLanguage[];
  /** When any of its versions last changed, in seconds. */
  updatedAt: number;
}

export interface BlogContent {
  /** Every post, the one changed last first. */
  posts: Post[];
  byId: Map<string, Post>;
}

export const EMPTY_BLOG: BlogContent = { byId: new Map(), posts: [] };

/** The fields a post's languages share: changing one changes them all. */
export type SharedFields = Pick<PostFields, "cover" | "topics" | "authors">;

// Breaks as freehub's editors and the websites read Markdown.
const markdown = new Marked({ breaks: true, gfm: true });

export function postTitle(post: Pick<PostFields, "title">): string {
  return post.title.trim() || "Untitled";
}

/** A version's `d` tag: the post's id, then its language, so it never changes with the title. */
export function postAddress(post: string, locale: string): string {
  return `${post}-${locale}`;
}

/** The post and language a `d` tag names. */
export function parsePostAddress(
  d: string | undefined
): { post: string; locale: string } | undefined {
  const groups = d ? POST_ADDRESS.exec(d)?.groups : undefined;
  return groups?.post && groups.locale
    ? { locale: groups.locale, post: groups.post }
    : undefined;
}

/** A link made from the title: lowercase words joined by hyphens. */
export function postSlug(title: string): string {
  return slugify(title, MAX_SLUG);
}

/** What's typed into the link field, kept to what a link can hold. */
export function cleanPostSlug(value: string): string {
  return cleanSlugInput(value, MAX_SLUG);
}

export function isValidSlug(slug: string): boolean {
  return slug.length <= MAX_SLUG && SLUG.test(slug);
}

/**
 * The link after the title changes. It follows the title until someone types
 * a link of their own, or the language is published: then readers may have
 * the link, and it only changes by hand.
 */
export function followTitle(
  slug: string,
  before: string,
  after: string,
  published: boolean
): string {
  return !published && (slug === "" || slug === postSlug(before))
    ? postSlug(after)
    : slug;
}

/**
 * The widths a picture this wide is drawn at: the standard ones below its
 * own width, then its own width up to the largest. Never wider than it is.
 */
export function imageWidths(width: number): number[] {
  const largest = Math.min(Math.round(width), IMAGE_WIDTHS.at(-1) ?? width);
  return [...IMAGE_WIDTHS.filter((each) => each < largest), largest];
}

/**
 * The sizes a picture this big is drawn at: its widths, each scaled down
 * further where it would be taller than WebP allows, and each once.
 */
export function imageSizes(
  width: number,
  height: number
): { width: number; height: number }[] {
  const sizes = new Map<number, number>();
  for (const size of imageWidths(width)) {
    const scale = Math.min(1, MAX_WEBP_SIDE / ((height * size) / width));
    const wide = Math.max(1, Math.floor(size * scale));
    const tall = Math.round((height * wide) / width);
    sizes.set(wide, Math.max(1, Math.min(MAX_WEBP_SIDE, tall)));
  }
  return [...sizes].map(([wide, tall]) => ({ height: tall, width: wide }));
}

/**
 * Whether a link can go in a published post: to a web or mail address, and
 * not into the app, which readers can't open and whose addresses would tell
 * them what's in it.
 */
export function isPublicLink(url: string, appOrigin: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const { origin, protocol } = new URL(url);
  return (
    protocol === "mailto:" ||
    ((protocol === "https:" || protocol === "http:") && origin !== appOrigin)
  );
}

/**
 * Whether a picture can show in a published post: from an `https://`
 * address, or `http://` on this machine, to try a media server out.
 */
export function isImageAddress(url: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const { hostname, protocol } = new URL(url);
  return (
    protocol === "https:" || (protocol === "http:" && LOCAL_HOSTS.has(hostname))
  );
}

/** The post's address on the website: the main language's under `/blog`, the others' under their code. */
export function postUrl(
  website: Pick<WebsiteConfig, "url" | "locales">,
  locale: string,
  slug: string
): string {
  const prefix = locale === website.locales[0] ? "" : `/${locale}`;
  return `${website.url}${prefix}/blog/${slug}`;
}

/** A Markdown token, as marked and Tiptap both describe it. */
interface TextToken {
  type?: string;
  text?: string;
  tokens?: TextToken[];
}

function tokenText(tokens: readonly TextToken[]): string {
  return tokens
    .map((token) =>
      token.tokens ? tokenText(token.tokens) : (token.text ?? "")
    )
    .join("");
}

/** Alt text as written: the text of its tokens, without Markdown. */
export function plainAlt(tokens: readonly TextToken[] | undefined): string {
  return tokenText(tokens ?? [])
    .replaceAll(/\s+/gu, " ")
    .trim();
}

// Any punctuation Markdown could read as formatting inside the brackets.
const ALT_SYNTAX = /[\\`*_[\]<>~&!|]/gu;
const TITLE_SYNTAX = /[\\"]/gu;
const PLAIN_URL = /^[^\s()<>]+$/u;

/** A picture as Markdown: `![alt](url "caption")`, escaped so it reads back as written. */
export function imageMarkdown({
  url,
  alt,
  caption,
}: {
  url: string;
  alt: string;
  caption?: string;
}): string {
  const text = alt.replaceAll(/\s+/gu, " ").trim().replace(ALT_SYNTAX, "\\$&");
  const target = PLAIN_URL.test(url) ? url : `<${url}>`;
  const title = caption?.replaceAll(/\s+/gu, " ").trim();
  return title
    ? `![${text}](${target} "${title.replace(TITLE_SYNTAX, "\\$&")}")`
    : `![${text}](${target})`;
}

/** The pictures the text shows, in order, each once, with the alt text it first gives them. */
export function imagesIn(content: string): TextImage[] {
  const found = new Map<string, TextImage>();
  markdown.walkTokens(markdown.lexer(content), (token) => {
    if (token.type === "image") {
      const { href, tokens } = token as Tokens.Image;
      if (!found.has(href)) {
        found.set(href, { alt: plainAlt(tokens), url: href });
      }
    }
  });
  return [...found.values()];
}

export function imetaTag(image: ImageMeta): string[] {
  const alt = image.alt.replaceAll(/\s+/gu, " ").trim();
  return [
    "imeta",
    `url ${image.url}`,
    `m ${WEBP}`,
    `x ${image.hash}`,
    `dim ${image.width}x${image.height}`,
    ...(alt ? [`alt ${alt}`] : []),
    `srcset ${image.sizes.map(({ url, width }) => `${url} ${width}w`).join(", ")}`,
  ];
}

/** A picture's `imeta` tag, if it names its address, hash, size and sizes. */
export function parseImeta(tag: string[]): ImageMeta | undefined {
  const [name, ...entries] = tag;
  if (name !== "imeta") {
    return undefined;
  }
  const fields = new Map<string, string>();
  for (const entry of entries) {
    const space = entry.indexOf(" ");
    if (space > 0 && !fields.has(entry.slice(0, space))) {
      fields.set(entry.slice(0, space), entry.slice(space + 1));
    }
  }
  const url = fields.get("url");
  const hash = fields.get("x");
  const dim = DIMENSIONS.exec(fields.get("dim") ?? "")?.groups;
  const sizes = (fields.get("srcset") ?? "").split(",").flatMap((item) => {
    const size = SIZE.exec(item.trim())?.groups;
    return size?.url && size.width
      ? [{ url: size.url, width: Number(size.width) }]
      : [];
  });
  if (!(url && hash && dim?.width && dim.height && sizes.length > 0)) {
    return undefined;
  }
  return {
    alt: fields.get("alt") ?? "",
    hash,
    height: Number(dim.height),
    sizes,
    url,
    width: Number(dim.width),
  };
}

/**
 * The pictures a version uses, the cover first, each with what's known of
 * it and the alt text it's given now. Pictures from elsewhere on the web,
 * which no one uploaded here, have none.
 */
export function usedImages(fields: PostFields): ImageMeta[] {
  const known = new Map(fields.images.map((image) => [image.url, image]));
  const used = imagesIn(fields.content);
  if (fields.cover) {
    used.unshift({ alt: fields.coverAlt, url: fields.cover });
  }
  const seen = new Set<string>();
  return used.flatMap(({ url, alt }) => {
    const image = known.get(url);
    if (!image || seen.has(url)) {
      return [];
    }
    seen.add(url);
    return [{ ...image, alt }];
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Topics as typed: trimmed, in lowercase, each once. */
export function cleanTopics(topics: string[]): string[] {
  return unique(
    topics
      .map((topic) => topic.replaceAll(/\s+/gu, " ").trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * A version of one language of the post: a draft as it's being written, or
 * what the website publishes. A draft's `prev` names the draft it was edited
 * from, so a teammate's editor can merge edits made at once, as doc pages do.
 */
export function postTemplate(
  project: Pick<Project, "address">,
  fields: PostFields,
  kind: PostKind,
  prev?: NostrEvent
): Template {
  const tags = [
    ["d", postAddress(fields.post, fields.locale)],
    ["a", project.address],
    ["post", fields.post],
    ["L", LANGUAGE_LABELS],
    ["l", fields.locale, LANGUAGE_LABELS],
    ["title", fields.title],
    ["slug", fields.slug],
    ...unique(fields.oldSlugs)
      .filter((slug) => slug && slug !== fields.slug)
      .map((slug) => ["old_slug", slug]),
    ["summary", fields.summary],
  ];
  if (fields.cover) {
    tags.push(["image", fields.cover]);
  }
  if (fields.publishedAt !== undefined) {
    tags.push(["published_at", String(fields.publishedAt)]);
  }
  for (const topic of cleanTopics(fields.topics)) {
    tags.push(["t", topic]);
  }
  for (const pubkey of unique(fields.authors)) {
    tags.push(["p", pubkey, "", AUTHOR]);
  }
  for (const image of usedImages(fields)) {
    tags.push(imetaTag(image));
  }
  if (kind === POST_DRAFT_KIND && prev && isSigned(prev)) {
    tags.push(["prev", prev.id]);
  }
  tags.push(["alt", `Blog post: ${postTitle(fields)}`]);
  return { content: fields.content, kind, tags };
}

/**
 * Takes one language of the post off the website (30023), or discards its
 * draft (30024). It keeps what says which post and language it was, so the
 * website's indexer can find it without the version it replaces, and, when
 * unpublishing, every link it was published under as an old one, so they're
 * kept when it's published again.
 */
export function postTombstoneTemplate(
  project: Pick<Project, "address">,
  post: string,
  locale: string,
  kind: PostKind,
  oldSlugs: readonly string[] = []
): Template {
  return {
    content: "",
    kind,
    tags: [
      ["d", postAddress(post, locale)],
      ["a", project.address],
      ["post", post],
      ["L", LANGUAGE_LABELS],
      ["l", locale, LANGUAGE_LABELS],
      ...unique([...oldSlugs])
        .filter(Boolean)
        .map((slug) => ["old_slug", slug]),
      ["deleted"],
    ],
  };
}

function oldSlugTags(event: NostrEvent): string[] {
  return event.tags.flatMap(([name, slug]) =>
    name === "old_slug" && slug ? [slug] : []
  );
}

/** A language of a post, as one of its versions says it. */
export function parsePostVersion(event: NostrEvent): PostVersion | undefined {
  const address = parsePostAddress(getTagValue(event, "d"));
  if (!address || getTagValue(event, "post") !== address.post) {
    return undefined;
  }
  const images = event.tags.flatMap((tag) => parseImeta(tag) ?? []);
  const cover = getTagValue(event, "image") || undefined;
  return {
    author: event.pubkey,
    authors: unique(
      event.tags.flatMap(([name, pubkey, , role]) =>
        name === "p" && role === AUTHOR && isPubkey(pubkey) ? [pubkey] : []
      )
    ),
    content: event.content,
    cover,
    coverAlt: images.find((image) => image.url === cover)?.alt ?? "",
    event,
    images,
    locale: address.locale,
    oldSlugs: oldSlugTags(event),
    post: address.post,
    publishedAt: integer(getTagValue(event, "published_at")),
    slug: getTagValue(event, "slug") ?? "",
    summary: getTagValue(event, "summary") ?? "",
    title: getTagValue(event, "title") ?? "",
    topics: event.tags.flatMap(([name, topic]) =>
      name === "t" && topic ? [topic] : []
    ),
    updatedAt: event.created_at,
  };
}

/** A language with nothing written yet, from whoever starts it. */
export function blankFields(
  post: string,
  locale: string,
  creator: string
): PostFields {
  return {
    authors: [creator],
    content: "",
    coverAlt: "",
    images: [],
    locale,
    oldSlugs: [],
    post,
    slug: "",
    summary: "",
    title: "",
    topics: [],
  };
}

/**
 * The fields with every link the language was published under as an old
 * one, so the website keeps sending them on. Taking a link back makes it
 * current again.
 */
export function withOldSlugs(
  fields: PostFields,
  publishedSlugs: readonly string[]
): PostFields {
  return {
    ...fields,
    oldSlugs: unique([...fields.oldSlugs, ...publishedSlugs]).filter(
      (slug) => slug && slug !== fields.slug
    ),
  };
}

/**
 * Whether the language was ever published, so readers may have its link:
 * it has a publication date, or links the website knows.
 */
export function wasPublished(
  fields: Pick<PostFields, "publishedAt">,
  language?: Pick<PostLanguage, "publishedSlugs">
): boolean {
  return (
    fields.publishedAt !== undefined ||
    (language?.publishedSlugs.length ?? 0) > 0
  );
}

/** The version of a language that people edit: its draft, or else what's published. */
export function currentVersion(
  language: PostLanguage
): PostVersion | undefined {
  return language.draft ?? language.published;
}

function pickShared(fields: PostFields): SharedFields {
  return {
    authors: fields.authors,
    cover: fields.cover,
    topics: fields.topics,
  };
}

/**
 * The fields with the shared ones changed. A new cover comes with what's
 * known of it, so the version can describe it.
 */
export function withShared(
  fields: PostFields,
  shared: Partial<SharedFields>,
  cover?: ImageMeta
): PostFields {
  const images =
    cover && !fields.images.some((image) => image.url === cover.url)
      ? [...fields.images, cover]
      : fields.images;
  // The old cover's alt text doesn't describe a new one.
  const coverAlt =
    "cover" in shared && shared.cover !== fields.cover ? "" : fields.coverAlt;
  return { ...fields, ...shared, coverAlt, images };
}

/**
 * What any version of the post says about its pictures, in any language: a
 * text pasted from one language into another keeps their sizes.
 */
export function postImages(post: Post): ImageMeta[] {
  const known = new Map<string, ImageMeta>();
  for (const language of post.languages) {
    const versions = [
      language.draft,
      language.published,
      ...language.drafts.map(parsePostVersion),
    ];
    for (const image of versions.flatMap((version) => version?.images ?? [])) {
      if (!known.has(image.url)) {
        known.set(image.url, image);
      }
    }
  }
  return [...known.values()];
}

/**
 * A new language of the post, with what the languages share, and the
 * cover's alt text in the language it came from, to translate.
 */
export function startLanguage(
  post: Post,
  locale: string,
  creator: string
): PostFields {
  const source = post.languages.map(currentVersion).find(Boolean);
  const blank = blankFields(post.id, locale, creator);
  if (!source) {
    return blank;
  }
  const shared = withShared(
    blank,
    pickShared(source),
    source.images.find((image) => image.url === source.cover)
  );
  return { ...shared, coverAlt: source.coverAlt };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Whether the draft says what's published. A draft without a date keeps
 * the published one, as publishing it would.
 */
export function samePost(draft: PostFields, published: PostFields): boolean {
  return (
    draft.title === published.title &&
    draft.slug === published.slug &&
    sameList(unique(draft.oldSlugs), unique(published.oldSlugs)) &&
    draft.summary === published.summary &&
    draft.content === published.content &&
    draft.cover === published.cover &&
    draft.coverAlt === published.coverAlt &&
    (draft.publishedAt === undefined ||
      draft.publishedAt === published.publishedAt) &&
    sameList(cleanTopics(draft.topics), cleanTopics(published.topics)) &&
    sameList(unique(draft.authors), unique(published.authors))
  );
}

export function languageStatus(language: PostLanguage): PostStatus {
  if (!language.published) {
    return "draft";
  }
  return language.draft && !samePost(language.draft, language.published)
    ? "changed"
    : "published";
}

/**
 * Another post of the blog that uses the link in the same language, in its
 * draft or as published, now or as an old link the website sends on, if any.
 * Published ones come first: two of those can't share a link on the website.
 */
export function slugTakenBy(
  blog: BlogContent,
  { post, locale, slug }: Pick<PostFields, "post" | "locale" | "slug">
): { post: Post; published: boolean } | undefined {
  if (!slug) {
    return undefined;
  }
  let drafted: Post | undefined;
  for (const other of blog.posts) {
    const language = other.languages.find((each) => each.locale === locale);
    if (other.id === post || !language) {
      continue;
    }
    const uses = (version?: PostFields) =>
      version !== undefined &&
      (version.slug === slug || version.oldSlugs.includes(slug));
    if (uses(language.published)) {
      return { post: other, published: true };
    }
    if (uses(language.draft)) {
      drafted ??= other;
    }
  }
  return drafted && { post: drafted, published: false };
}

/**
 * What the language needs before it can be published: a title, and a link
 * of its own among the posts published in that language.
 */
export function publishProblem(
  blog: BlogContent,
  fields: Pick<PostFields, "post" | "locale" | "title" | "slug">
): string | undefined {
  if (!fields.title.trim()) {
    return "Give it a title first.";
  }
  if (!isValidSlug(fields.slug)) {
    return "Give it a link first: lowercase letters, digits and hyphens.";
  }
  return slugTakenBy(blog, fields)?.published
    ? "Another published post has this link."
    : undefined;
}

function ofProject(project: Project) {
  const members = new Set(project.members);
  return (event: NostrEvent) =>
    members.has(event.pubkey) &&
    addressOf(event, PROJECT_KIND) === project.address;
}

/** A version unless it deletes the language. */
function liveVersion(event: NostrEvent | undefined): PostVersion | undefined {
  return event && !isDeleted(event) ? parsePostVersion(event) : undefined;
}

/** Every link the newest 30023 says the language was published under. */
function slugsPublished(event: NostrEvent | undefined): string[] {
  if (!event) {
    return [];
  }
  const live = liveVersion(event);
  return unique(
    live ? [live.slug, ...live.oldSlugs] : oldSlugTags(event)
  ).filter(Boolean);
}

/**
 * The project's blog, resolved across every member's versions: for each
 * language of each post, the newest draft and the newest published version
 * whose author is a member and which names the project. Languages the
 * website doesn't publish are left out.
 */
export function resolveBlog(
  project: Project,
  events: NostrEvent[],
  locales: readonly string[]
): BlogContent {
  const own = events.filter(ofProject(project));
  const members = new Set(project.members);
  const drafts = latestVersions(own, POST_DRAFT_KIND, members);
  const published = latestVersions(own, POST_KIND, members);
  const draftEvents = new Map<string, NostrEvent[]>();
  for (const event of own) {
    const d = getTagValue(event, "d");
    if (event.kind === POST_DRAFT_KIND && d && !isDeleted(event)) {
      draftEvents.set(d, [...(draftEvents.get(d) ?? []), event]);
    }
  }
  const byId = new Map<string, Post>();
  for (const d of new Set([...drafts.keys(), ...published.keys()])) {
    const address = parsePostAddress(d);
    const draft = liveVersion(drafts.get(d));
    const publishedEvent = published.get(d);
    const live = liveVersion(publishedEvent);
    if (!(address && locales.includes(address.locale) && (draft || live))) {
      continue;
    }
    const post = byId.get(address.post) ?? {
      id: address.post,
      languages: [],
      updatedAt: 0,
    };
    post.languages.push({
      draft,
      drafts: draftEvents.get(d) ?? [],
      locale: address.locale,
      published: live,
      publishedEvent,
      publishedSlugs: slugsPublished(publishedEvent),
    });
    post.updatedAt = Math.max(
      post.updatedAt,
      draft?.updatedAt ?? 0,
      live?.updatedAt ?? 0
    );
    byId.set(address.post, post);
  }
  for (const post of byId.values()) {
    post.languages.sort(
      (a, b) => locales.indexOf(a.locale) - locales.indexOf(b.locale)
    );
  }
  const posts = [...byId.values()].toSorted(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
  );
  return { byId, posts };
}
