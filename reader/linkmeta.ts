/**
 * What a link's page says about it: its title, its words, its picture, who
 * made it and when. Pages that don't show themselves to readers like this
 * one (videos and posts, mostly) answer through their platform's oEmbed
 * instead, which needs no key. Only what pages say about themselves is read,
 * never what's in them: no transcripts, no article text.
 */
import type { Byline, LinkType } from "@/lib/catalogs";
import {
  cleanDate,
  isYoutubeShort,
  platformName,
  platformOf,
  youtubeId,
} from "@/lib/catalogs";

import {
  cleanText,
  fetchJson,
  fetchPage,
  imageUrl,
  metaTags,
  readStart,
} from "./pages";

/** Pictures kept for links: no bigger than a Drive thumbnail, which the app opens the same way. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TITLE = 300;
const MAX_TEXT = 1000;
const MAX_NAME = 120;
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export interface LinkMeta {
  title?: string;
  /** What the page says about itself, or a post's own words. */
  text?: string;
  siteName?: string;
  creator?: Byline;
  /** `YYYY-MM-DD`. */
  publishedAt?: string;
  /** Seconds. */
  duration?: number;
  /** Where its picture is, best first; the first that loads is kept. */
  images: string[];
  /** What the platform says it is, when it says. */
  type?: LinkType;
}

interface OEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  html?: string;
  provider_name?: string;
  duration?: number;
  upload_date?: string;
  description?: string;
}

function oembed(endpoint: string, url: string): Promise<OEmbed | null> {
  return fetchJson<OEmbed>(`${endpoint}${encodeURIComponent(url)}`);
}

function isWebAddress(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function creatorOf(name: string | undefined, url?: string): Byline | undefined {
  const clean = cleanText(name, MAX_NAME);
  if (!clean) {
    return undefined;
  }
  return url && isWebAddress(url) ? { name: clean, url } : { name: clean };
}

/** ISO 8601 durations, like `PT12M4S`, in seconds. */
function isoSeconds(value: string | undefined): number | undefined {
  const parts =
    /^P(?:(?<days>\d+)D)?T?(?:(?<hours>\d+)H)?(?:(?<minutes>\d+)M)?(?:(?<seconds>\d+(?:\.\d+)?)S)?$/u.exec(
      value?.trim() ?? ""
    )?.groups;
  if (!parts) {
    return undefined;
  }
  const total =
    Number(parts.days ?? 0) * 86_400 +
    Number(parts.hours ?? 0) * 3600 +
    Number(parts.minutes ?? 0) * 60 +
    Number(parts.seconds ?? 0);
  return total > 0 ? Math.round(total) : undefined;
}

/** The page's head, read as far as the head goes, or null when it can't be. */
async function readHead(
  url: string
): Promise<{ head: string; url: string } | null> {
  try {
    const response = await fetchPage(url);
    if (!response) {
      return null;
    }
    const type = response.headers.get("content-type") ?? "";
    if (!/html/iu.test(type)) {
      await response.body?.cancel();
      return null;
    }
    const html = await readStart(response);
    return {
      head: html.split(/<\/head\s*>/iu)[0] ?? html,
      url: response.url || url,
    };
  } catch {
    return null;
  }
}

function typeFromOg(ogType: string | undefined): LinkType | undefined {
  const type = ogType?.toLowerCase() ?? "";
  if (type.startsWith("video")) {
    return "video";
  }
  if (type.startsWith("music")) {
    return "music";
  }
  if (type === "article") {
    return "article";
  }
  if (type === "product" || type.startsWith("product.")) {
    return "product";
  }
  return undefined;
}

/** What any page's head says: Open Graph first, then plain tags. */
async function pageMeta(url: string): Promise<LinkMeta | null> {
  const read = await readHead(url);
  if (!read) {
    return null;
  }
  const meta = metaTags(read.head);
  const pick = (...keys: string[]) =>
    keys.map((key) => meta.get(key)).find(Boolean);
  const title =
    pick("og:title", "twitter:title") ??
    /<title[^>]*>(?<text>[\s\S]*?)<\/title>/iu.exec(read.head)?.groups?.text;
  const image = imageUrl(
    pick("og:image:secure_url", "og:image", "og:image:url", "twitter:image"),
    read.url
  );
  const author = pick("author", "article:author", "twitter:creator");
  return {
    creator: author?.startsWith("http") ? undefined : creatorOf(author),
    duration:
      Number(pick("og:video:duration", "video:duration")) ||
      isoSeconds(pick("duration")),
    images: image ? [image] : [],
    publishedAt: cleanDate(
      pick(
        "article:published_time",
        "og:published_time",
        "date",
        "datepublished",
        "uploaddate"
      )
    ),
    siteName: cleanText(pick("og:site_name", "application-name"), MAX_NAME),
    text: cleanText(
      pick("og:description", "twitter:description", "description"),
      MAX_TEXT
    ),
    title: cleanText(title, MAX_TITLE),
    type: typeFromOg(pick("og:type")),
  };
}

async function youtubeMeta(url: string, id: string): Promise<LinkMeta> {
  const short = isYoutubeShort(url);
  const watch = short
    ? `https://www.youtube.com/shorts/${id}`
    : `https://www.youtube.com/watch?v=${id}`;
  const [embed, page] = await Promise.all([
    oembed("https://www.youtube.com/oembed?format=json&url=", watch),
    pageMeta(`https://www.youtube.com/watch?v=${id}`),
  ]);
  const thumbs = `https://i.ytimg.com/vi/${id}`;
  return {
    creator: creatorOf(embed?.author_name, embed?.author_url),
    duration: page?.duration,
    // Shorts have an upright picture of their own; videos the widest there is.
    images: short
      ? [`${thumbs}/oardefault.jpg`, `${thumbs}/hq720.jpg`]
      : [
          `${thumbs}/maxresdefault.jpg`,
          `${thumbs}/hq720.jpg`,
          `${thumbs}/mqdefault.jpg`,
        ],
    publishedAt: page?.publishedAt,
    siteName: "YouTube",
    text: page?.text,
    title: cleanText(embed?.title, MAX_TITLE) ?? page?.title,
    type: short ? "short" : "video",
  };
}

interface FxTweet {
  tweet?: {
    text?: string;
    created_timestamp?: number;
    author?: { name?: string; screen_name?: string };
    media?: {
      photos?: { url?: string }[];
      videos?: { thumbnail_url?: string; duration?: number }[];
    };
  };
}

const POST_ID = /\/status(?:es)?\/(?<id>\d+)/u;

/** A post's text from X's own embed: its first paragraph, without tags. */
function postText(html: string | undefined): string | undefined {
  const paragraph = /<p[^>]*>(?<text>[\s\S]*?)<\/p>/iu.exec(html ?? "")?.groups
    ?.text;
  if (!paragraph) {
    return undefined;
  }
  const text = paragraph
    .replaceAll(/<br\s*\/?>/giu, "\n")
    .replaceAll(/<a[^>]*>pic\.twitter\.com\/\w+<\/a>/giu, "")
    .replaceAll(/<[^>]+>/gu, "");
  return cleanText(text, MAX_TEXT);
}

/** The page's own words, where the platform's left gaps. */
function filledIn(
  meta: LinkMeta | null,
  page: LinkMeta | null
): LinkMeta | null {
  if (!(meta && page)) {
    return meta ?? page;
  }
  return {
    creator: meta.creator ?? page.creator,
    duration: meta.duration ?? page.duration,
    images: [...meta.images, ...page.images],
    publishedAt: meta.publishedAt ?? page.publishedAt,
    siteName: meta.siteName ?? page.siteName,
    text: meta.text ?? page.text,
    title: meta.title ?? page.title,
    type: meta.type ?? page.type,
  };
}

/** What FixTweet says of a post: its words, who wrote it, its picture and when. */
function fromFixTweet(tweet: NonNullable<FxTweet["tweet"]>): LinkMeta {
  const video = tweet.media?.videos?.[0];
  const picture = tweet.media?.photos?.[0]?.url ?? video?.thumbnail_url;
  const handle = tweet.author?.screen_name;
  return {
    creator: creatorOf(
      tweet.author?.name,
      handle ? `https://x.com/${handle}` : undefined
    ),
    duration: video?.duration ? Math.round(video.duration) : undefined,
    images: picture ? [picture] : [],
    publishedAt: tweet.created_timestamp
      ? new Date(tweet.created_timestamp * 1000).toISOString().slice(0, 10)
      : undefined,
    siteName: "X",
    text: cleanText(tweet.text, MAX_TEXT),
    type: "post",
  };
}

/** What X's own embed says of a post: its words and who wrote it. */
function fromPostEmbed(embed: OEmbed): LinkMeta {
  return {
    creator: creatorOf(embed.author_name, embed.author_url),
    images: [],
    siteName: "X",
    text: postText(embed.html),
    type: "post",
  };
}

/**
 * A post on X. X's own embed gives its words and who wrote it; FixTweet's
 * open API (api.fxtwitter.com) adds its picture and date, which X keeps from
 * readers like this one.
 */
async function xMeta(url: string): Promise<LinkMeta | null> {
  const id = POST_ID.exec(url)?.groups?.id;
  const [embed, fx] = await Promise.all([
    oembed("https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=", url),
    id
      ? fetchJson<FxTweet>(`https://api.fxtwitter.com/status/${id}`)
      : Promise.resolve(null),
  ]);
  return filledIn(
    fx?.tweet ? fromFixTweet(fx.tweet) : null,
    embed ? fromPostEmbed(embed) : null
  );
}

interface TikTokItem {
  desc?: string;
  createTime?: string | number;
  author?: { nickname?: string; uniqueId?: string };
  video?: {
    cover?: string;
    originCover?: string;
    duration?: number;
  };
}

/** Where a TikTok's page keeps what the video is, as JSON. */
const TIKTOK_DATA =
  /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(?<json>[\s\S]*?)<\/script>/u;

/** The video on a TikTok's page, as the data the page loads with says. */
async function tiktokItem(url: string): Promise<TikTokItem | undefined> {
  try {
    const response = await fetchPage(url);
    if (!response) {
      return undefined;
    }
    const html = await readStart(response, { whole: true });
    const json = TIKTOK_DATA.exec(html)?.groups?.json;
    const data = json
      ? (JSON.parse(json) as {
          __DEFAULT_SCOPE__?: Record<
            string,
            { itemInfo?: { itemStruct?: TikTokItem } } | undefined
          >;
        })
      : undefined;
    return data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo
      ?.itemStruct;
  } catch {
    return undefined;
  }
}

/**
 * A TikTok. Its oEmbed now gives little more than the player, so what it is
 * comes from the data on its page: its caption, who made it, its cover,
 * which is copied before its signed address runs out, and how long it is.
 */
async function tiktokMeta(url: string): Promise<LinkMeta | null> {
  const [item, embed] = await Promise.all([
    tiktokItem(url),
    oembed("https://www.tiktok.com/oembed?url=", url),
  ]);
  const handle = item?.author?.uniqueId;
  const page: LinkMeta | null = item
    ? {
        creator: creatorOf(
          item.author?.nickname,
          handle ? `https://www.tiktok.com/@${handle}` : undefined
        ),
        duration: item.video?.duration || undefined,
        images: [item.video?.originCover, item.video?.cover].filter(
          (image): image is string => Boolean(image)
        ),
        publishedAt: item.createTime
          ? new Date(Number(item.createTime) * 1000).toISOString().slice(0, 10)
          : undefined,
        siteName: "TikTok",
        text: cleanText(item.desc, MAX_TEXT),
        // A TikTok's title is its caption.
        title: cleanText(item.desc, MAX_TITLE),
        type: "short",
      }
    : null;
  const told: LinkMeta | null = embed
    ? {
        creator: creatorOf(embed.author_name, embed.author_url),
        images: embed.thumbnail_url ? [embed.thumbnail_url] : [],
        siteName: "TikTok",
        text: cleanText(embed.title, MAX_TEXT),
        title: cleanText(embed.title, MAX_TITLE),
        type: "short",
      }
    : null;
  return filledIn(page, told);
}

/** Platforms whose oEmbed says enough on its own: where, and what it is. */
async function oembedMeta(
  endpoint: string,
  url: string,
  siteName: string,
  type: LinkType
): Promise<LinkMeta | null> {
  const embed = await oembed(endpoint, url);
  if (!embed) {
    return null;
  }
  return {
    creator: creatorOf(embed.author_name, embed.author_url),
    duration: embed.duration ? Math.round(embed.duration) : undefined,
    images: embed.thumbnail_url ? [embed.thumbnail_url] : [],
    publishedAt: cleanDate(embed.upload_date),
    siteName,
    text: cleanText(embed.description, MAX_TEXT),
    title: cleanText(embed.title, MAX_TITLE),
    type,
  };
}

function spotifyType(url: string): LinkType {
  return /\/(?:episode|show)\//u.test(url) ? "podcast" : "music";
}

/**
 * Pages that keep readers out answer with their site's name, like
 * "Instagram", for every link: that says nothing about the link, so it goes.
 */
function withoutSiteTitle(url: string, meta: LinkMeta | null): LinkMeta | null {
  const site = platformName(platformOf(url)).toLowerCase();
  const title = meta?.title?.toLowerCase();
  if (
    !(meta && title) ||
    (title !== site && title !== meta.siteName?.toLowerCase())
  ) {
    return meta;
  }
  return { ...meta, title: undefined };
}

async function readMeta(url: string): Promise<LinkMeta | null> {
  const video = youtubeId(url);
  if (video) {
    return await youtubeMeta(url, video);
  }
  switch (platformOf(url)) {
    case "tiktok": {
      return await tiktokMeta(url);
    }
    case "x": {
      return await xMeta(url);
    }
    case "vimeo": {
      return await oembedMeta(
        "https://vimeo.com/api/oembed.json?url=",
        url,
        "Vimeo",
        "video"
      );
    }
    case "spotify": {
      return await oembedMeta(
        "https://open.spotify.com/oembed?url=",
        url,
        "Spotify",
        spotifyType(url)
      );
    }
    case "soundcloud": {
      return await oembedMeta(
        "https://soundcloud.com/oembed?format=json&url=",
        url,
        "SoundCloud",
        "music"
      );
    }
    case "reddit": {
      return filledIn(
        await oembedMeta(
          "https://www.reddit.com/oembed?url=",
          url,
          "Reddit",
          "post"
        ),
        await pageMeta(url)
      );
    }
    case "github": {
      const page = await pageMeta(url);
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      return page && parts.length === 2 ? { ...page, type: "repo" } : page;
    }
    default: {
      return await pageMeta(url);
    }
  }
}

/** What the link's page, or its platform, says about it; null when nothing could be read. */
export async function readLinkMeta(url: string): Promise<LinkMeta | null> {
  return withoutSiteTitle(url, await readMeta(url));
}

/* oxlint-disable no-bitwise -- image headers keep sizes in bits and bytes */
function webpSize(
  bytes: Uint8Array,
  view: DataView,
  chunk: string
): { width: number; height: number } | undefined {
  const at = (index: number) => bytes[index] ?? 0;
  if (chunk === "VP8 ") {
    return {
      height: view.getUint16(28, true) & 0x3f_ff,
      width: view.getUint16(26, true) & 0x3f_ff,
    };
  }
  if (chunk === "VP8L") {
    return {
      height:
        1 + (((at(24) & 0x0f) << 10) | (at(23) << 2) | ((at(22) & 0xc0) >> 6)),
      width: 1 + (((at(22) & 0x3f) << 8) | at(21)),
    };
  }
  if (chunk === "VP8X") {
    return {
      height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)),
      width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)),
    };
  }
  return undefined;
}

/* oxlint-enable no-bitwise */

function jpegSize(
  bytes: Uint8Array,
  view: DataView
): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    // Markers that stand alone, without a length.
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    // Start of frame, in any of its kinds: the size follows.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return undefined;
}

/** A picture's size from the first bytes of its file: PNG, GIF, WebP or JPEG. */
export function imageSize(
  bytes: Uint8Array
): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) =>
    String.fromCodePoint(...bytes.subarray(start, start + length));
  try {
    if (ascii(1, 3) === "PNG") {
      return { height: view.getUint32(20), width: view.getUint32(16) };
    }
    if (ascii(0, 3) === "GIF") {
      return {
        height: view.getUint16(8, true),
        width: view.getUint16(6, true),
      };
    }
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
      return webpSize(bytes, view, ascii(12, 4));
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      return jpegSize(bytes, view);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface FetchedImage {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
  width?: number;
  height?: number;
}

/** The picture at the address, when it's a picture and not too big. */
async function fetchImage(url: string): Promise<FetchedImage | null> {
  try {
    const response = await fetchPage(url, "image/webp,image/*;q=0.9");
    if (!response) {
      return null;
    }
    const type = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    const size = Number(response.headers.get("content-length") ?? 0);
    if (!(type && IMAGE_TYPES.has(type)) || size > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }
    const measured = imageSize(bytes);
    // YouTube answers a missing size with a gray 120 × 90 stand-in.
    if (measured && measured.width <= 120 && measured.height <= 90) {
      return null;
    }
    return { bytes, type, ...measured };
  } catch {
    return null;
  }
}

/** The first of the pictures that loads. */
export async function firstImage(
  urls: readonly string[]
): Promise<FetchedImage | null> {
  for (const url of urls.slice(0, 4)) {
    // oxlint-disable-next-line no-await-in-loop -- the first that loads is kept, so they're tried in turn
    const image = await fetchImage(url);
    if (image) {
      return image;
    }
  }
  return null;
}
