/**
 * What the reader asks a model about a link, and how what the page and the
 * model said become the link's reading. No fetching here, so tests run it.
 */
import type {
  Catalog,
  CatalogCategory,
  LinkThumb,
  LinkType,
  ReadingFields,
  SavedLink,
} from "@/lib/catalogs";
import {
  categoryKey,
  cleanCategoryName,
  cleanDate,
  clip,
  isLinkType,
  LINK_TYPES,
  MAX_BYLINE,
  MAX_EXCERPT,
  MAX_LINK_CATEGORIES,
  MAX_LINK_TITLE,
  MAX_SUGGESTED,
  MAX_SUMMARY,
  platformName,
  platformOf,
} from "@/lib/catalogs";

import type { JsonSchema } from "./ai";
import { fields, numbers, text, texts } from "./ai";
import type { LinkMeta } from "./linkmeta";

/** How much of a post's words stand for its title, until the model writes one. */
const POST_TITLE = 90;
/** Links one run sorts at once, when they're checked for a category. */
export const SORT_BATCH = 25;

export const READING_INSTRUCTIONS = `You catalog links that people save to a shared collection called a catalog, from what each link's page says about itself. Write in English, whatever language the page is in.

- title: what it is, plain and specific, in at most 80 characters. Keep the page's own title when it says that well already. Leave out clickbait, emoji, hashtags, and channel or site names. Sentence case.
- summary: one or two short sentences, at most 200 characters, on what it covers, shows or argues, so someone can tell whether to open it. Don't start with "This video", "This post" or "This article". Say only what the page's words support; when they say little, say little.
- type: video (a video), short (an upright short video, like a TikTok, a Short or a Reel), post (a social media post or thread), article (an article, blog post, newsletter or doc), podcast, music, repo (a code repository), product (a product, app or tool), or other.
- categories: the catalog's categories it belongs in, best first, up to 3. Only ones that clearly fit; none is fine.
- newCategories: only when none of the catalog's categories fits, up to 2 new ones it belongs in: broad topics other links in the catalog would share, of 1 to 3 words in Title Case, like "Security" or "Product Launches". Use a suggested name when one fits. Otherwise an empty list.
- creator: who made it, as the page names them: a channel, an author or an account. Null when the page doesn't say.
- publishedAt: YYYY-MM-DD when the page says when it was published, else null.
- A note, when there is one, is what the person who saved it wrote: let it steer the summary and categories, but don't quote it.`;

export const SORT_INSTRUCTIONS = `You sort links saved to a catalog into one of its categories. You're given the category, and a numbered list of links with their titles and summaries. Return the numbers of the links that clearly belong in the category, in matches. When in doubt, leave a link out: an empty list is fine.`;

/** What reading a link knows besides the link: its catalog, and names other links suggested lately. */
export interface ReadSource {
  catalog: Pick<Catalog, "title" | "description">;
  categories: CatalogCategory[];
  suggested: string[];
  url: string;
  note: string;
}

/** What the model made of a link. */
export interface AiReading {
  title: string;
  summary: string;
  type: LinkType;
  categories: string[];
  newCategories: string[];
  creator: string | null;
  publishedAt: string | null;
}

const NULLABLE_STRING = { type: ["string", "null"] };

export function readingSchema(categoryNames: string[]): JsonSchema {
  return {
    additionalProperties: false,
    properties: {
      categories: {
        items:
          categoryNames.length > 0
            ? { enum: categoryNames, type: "string" }
            : { type: "string" },
        type: "array",
      },
      creator: NULLABLE_STRING,
      newCategories: { items: { type: "string" }, type: "array" },
      publishedAt: NULLABLE_STRING,
      summary: { type: "string" },
      title: { type: "string" },
      type: { enum: [...LINK_TYPES], type: "string" },
    },
    required: [
      "title",
      "summary",
      "type",
      "categories",
      "newCategories",
      "creator",
      "publishedAt",
    ],
    type: "object",
  };
}

/** The model's answer about a link, if it's in shape. */
export function parseAiReading(value: unknown): AiReading | undefined {
  const answer = fields(value);
  const title = text(answer?.title);
  const summary = text(answer?.summary);
  const type = text(answer?.type);
  if (!(answer && title !== undefined && summary !== undefined)) {
    return undefined;
  }
  return {
    categories: texts(answer.categories),
    creator: text(answer.creator) ?? null,
    newCategories: texts(answer.newCategories),
    publishedAt: text(answer.publishedAt) ?? null,
    summary,
    title,
    type: isLinkType(type) ? type : "other",
  };
}

/** What the model is told about the link: the catalog it's in, then what the page says. */
export function readingPrompt(
  source: ReadSource,
  meta: LinkMeta | null
): string {
  const lines = [
    `Catalog: ${source.catalog.title}`,
    source.catalog.description && `About it: ${source.catalog.description}`,
    `Categories: ${source.categories.map((category) => category.name).join(", ") || "none yet"}`,
    source.suggested.length > 0 &&
      `Suggested already: ${source.suggested.join(", ")}`,
    "",
    `Link: ${source.url}`,
    `From: ${meta?.siteName ?? platformName(platformOf(source.url))}`,
    meta?.type && `Platform says it's: ${meta.type}`,
    meta?.title && `Title on the page: ${meta.title}`,
    meta?.text && `Words on the page: ${meta.text}`,
    meta?.creator && `By: ${meta.creator.name}`,
    meta?.publishedAt && `Published: ${meta.publishedAt}`,
    source.note && `\nNote from whoever saved it: ${source.note}`,
    meta ? "" : "\nThe page couldn't be read: go by the address alone.",
  ];
  return lines
    .filter((line) => line !== false && line !== undefined)
    .join("\n");
}

/** Category ids for the names the model picked, best first, as many as a link takes. */
function categoryIds(
  categories: readonly CatalogCategory[],
  names: readonly string[]
): string[] {
  const ids: string[] = [];
  for (const name of names) {
    const found = categories.find(
      (category) => categoryKey(category.name) === categoryKey(name)
    );
    if (found && !ids.includes(found.id)) {
      ids.push(found.id);
    }
  }
  return ids.slice(0, MAX_LINK_CATEGORIES);
}

/** New categories the model suggests: named, not ones the catalog has or waved away, each once. */
function suggestions(
  catalog: Pick<Catalog, "categories" | "dismissed">,
  names: readonly string[]
): string[] {
  const known = new Set([
    ...catalog.categories.map((category) => categoryKey(category.name)),
    ...catalog.dismissed,
  ]);
  const kept: string[] = [];
  for (const name of names) {
    const clean = cleanCategoryName(name);
    if (
      clean &&
      !known.has(categoryKey(clean)) &&
      !kept.some((item) => categoryKey(item) === categoryKey(clean))
    ) {
      kept.push(clean);
    }
  }
  return kept.slice(0, MAX_SUGGESTED);
}

/** Words that stand for a title, for posts that have none: their first line. */
function firstWords(words: string | undefined): string {
  const line = words?.split("\n")[0] ?? "";
  return clip(line, POST_TITLE);
}

/**
 * What the page says about itself, as a summary until the model writes one;
 * nothing when those words are its title already, as a post's are.
 */
function pageSummary(meta: LinkMeta | null): string {
  const words = meta?.text ?? "";
  const title = meta?.title ?? "";
  return title && !words.startsWith(title.slice(0, POST_TITLE / 2))
    ? words
    : "";
}

/** The model's title, or else the page's, with the page's kept when it differs. */
function titles(
  meta: LinkMeta | null,
  ai: AiReading | undefined
): Pick<ReadingFields, "title" | "originalTitle"> {
  const pageTitle = clip(meta?.title, MAX_LINK_TITLE);
  const title =
    clip(ai?.title, MAX_LINK_TITLE) || pageTitle || firstWords(meta?.text);
  const differs =
    pageTitle && title && pageTitle.toLowerCase() !== title.toLowerCase();
  return {
    originalTitle: differs ? pageTitle : undefined,
    title: title || undefined,
  };
}

/** Who made it: as the page names them, or else as the model read it. */
function bylineOf(
  meta: LinkMeta | null,
  ai: AiReading | undefined
): ReadingFields["byline"] {
  if (meta?.creator) {
    return meta.creator;
  }
  const name = clip(ai?.creator ?? "", MAX_BYLINE);
  return name ? { name } : undefined;
}

/** What the page says about itself, as it's kept. */
function pageFields(
  meta: LinkMeta | null
): Pick<ReadingFields, "duration" | "excerpt" | "siteName"> {
  return {
    duration: meta?.duration ? Math.round(meta.duration) : undefined,
    excerpt: meta?.text?.slice(0, MAX_EXCERPT),
    siteName: meta?.siteName,
  };
}

/** Where the model filed it, and the new categories it would file it under. */
function filing(
  catalog: Pick<Catalog, "categories" | "dismissed">,
  ai: AiReading | undefined
): Pick<ReadingFields, "categories" | "suggested"> {
  return ai
    ? {
        categories: categoryIds(catalog.categories, ai.categories),
        suggested: suggestions(catalog, ai.newCategories),
      }
    : { categories: [], suggested: [] };
}

/**
 * The link's reading, from what its page said, what the model made of it and
 * its picture. Without the model, the page's own title and words stand.
 */
export function readingFields(
  link: Pick<SavedLink, "id" | "url" | "readAt">,
  catalog: Pick<Catalog, "categories" | "dismissed">,
  meta: LinkMeta | null,
  ai: AiReading | undefined,
  picture: { thumb?: LinkThumb; image?: string }
): ReadingFields {
  return {
    ...titles(meta, ai),
    ...pageFields(meta),
    ...filing(catalog, ai),
    byline: bylineOf(meta, ai),
    image: picture.image,
    link: link.id,
    publishedAt: meta?.publishedAt ?? cleanDate(ai?.publishedAt),
    readAt: link.readAt ?? 0,
    state: meta || ai ? "ready" : "failed",
    summary: clip(ai?.summary ?? pageSummary(meta), MAX_SUMMARY) || undefined,
    thumb: picture.thumb,
    type: ai?.type ?? meta?.type,
    url: link.url,
  };
}

/** A link as sorting reads it: what it's called and what it's about. */
export interface SortCandidate {
  id: string;
  title: string;
  summary: string;
  note: string;
}

export const SORT_SCHEMA: JsonSchema = {
  additionalProperties: false,
  properties: { matches: { items: { type: "number" }, type: "array" } },
  required: ["matches"],
  type: "object",
};

/** What the model is told when sorting links into a category. */
export function sortPrompt(
  catalog: Pick<Catalog, "title" | "description" | "categories">,
  category: CatalogCategory,
  batch: SortCandidate[]
): string {
  const others =
    catalog.categories
      .filter((item) => item.id !== category.id)
      .map((item) => item.name)
      .join(", ") || "none";
  const numbered = batch
    .map(
      (link, index) =>
        `${index + 1}. ${link.title}${link.summary ? ` — ${link.summary}` : ""}${link.note ? ` (note: ${link.note.slice(0, 200)})` : ""}`
    )
    .join("\n");
  return `Catalog: ${catalog.title}${catalog.description ? ` — ${catalog.description}` : ""}\nCategory: ${category.name}\nIts other categories: ${others}\n\nLinks:\n${numbered}`;
}

/** The links of the batch the model said belong, by their numbers in it. */
export function sortMatches(
  value: unknown,
  batch: SortCandidate[]
): SortCandidate[] {
  const picked = new Set<SortCandidate>();
  for (const number of numbers(fields(value)?.matches)) {
    const link = batch[Math.round(number) - 1];
    if (link) {
      picked.add(link);
    }
  }
  return [...picked];
}
