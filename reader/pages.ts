/**
 * Fetching what's on the web for links, from the reader: pages and pictures,
 * never from the network the reader runs in, and only so much of each.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const TIMEOUT = 8000;
/** Enough for the longest heads, like a video page's; the rest is never read. */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const HEAD_END = /<\/head\s*>|<body[\s>]/iu;
const USER_AGENT = "Mozilla/5.0 (compatible; FreehubReader/1.0)";
const HTML = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function isPrivateIpv4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b < 128) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b < 32) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(?<v4>\d+\.\d+\.\d+\.\d+)$/u.exec(lower)?.groups?.v4;
  if (mapped) {
    return isPrivateIpv4(mapped);
  }
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff")
  );
}

/** An address on the reader's own network, or one that isn't anyone's. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isPrivateIpv4(address);
  }
  return family === 6 ? isPrivateIpv6(address) : true;
}

/**
 * Whether the address may be fetched: on the web, by a name that points only
 * at public addresses. A name can point elsewhere by the time it's fetched,
 * so this keeps out mistakes and casual tries, not a determined attacker;
 * whoever saves links is on the team.
 */
export async function isFetchable(url: URL): Promise<boolean> {
  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/u, "")
    .replaceAll(/^\[|\]$/gu, "");
  if (
    !(url.protocol === "http:" || url.protocol === "https:") ||
    url.username ||
    url.password ||
    host === "" ||
    host === "localhost" ||
    LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return false;
  }
  if (isIP(host)) {
    return !isPrivateAddress(host);
  }
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return (
      addresses.length > 0 &&
      addresses.every(({ address }) => !isPrivateAddress(address))
    );
  } catch {
    return false;
  }
}

/**
 * The page at `url`, following redirects one hop at a time so each one is
 * checked before it's fetched. Null unless it answered with what was asked.
 */
export async function fetchPage(
  url: string,
  accept = HTML
): Promise<Response | null> {
  let next = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each hop is checked before the next
    if (!(await isFetchable(next))) {
      return null;
    }
    // oxlint-disable-next-line no-await-in-loop -- each hop is checked before the next
    const response = await fetch(next, {
      headers: { accept, "user-agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      // oxlint-disable-next-line no-await-in-loop -- the redirect's body is let go before following it
      await response.body?.cancel();
      next = new URL(location, next);
      continue;
    }
    return response.ok ? response : null;
  }
  return null;
}

/**
 * The start of the body as text: up to `MAX_BYTES`, and only as far as its
 * head unless `whole` says to read on.
 */
export async function readStart(
  response: Response,
  { whole = false }: { whole?: boolean } = {}
): Promise<string> {
  const charset = /charset=["']?(?<name>[\w-]+)/iu.exec(
    response.headers.get("content-type") ?? ""
  )?.groups?.name;
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset ?? "utf-8");
  } catch {
    decoder = new TextDecoder();
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return text.slice(0, MAX_BYTES);
  }
  let text = "";
  let read = 0;
  while (read < MAX_BYTES) {
    // oxlint-disable-next-line no-await-in-loop -- a stream is read a chunk at a time
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    read += value.byteLength;
    const chunk = decoder.decode(value, { stream: true });
    // The head is all that's read. A tag can start in the chunk before.
    const recent = text.slice(-8) + chunk;
    text += chunk;
    if (!whole && HEAD_END.test(recent)) {
      break;
    }
  }
  await reader.cancel();
  return text + decoder.decode();
}

/** JSON from an API, when it answers with a little of it. */
export async function fetchJson<T>(
  url: string,
  maxBytes = 512 * 1024
): Promise<T | null> {
  try {
    const response = await fetchPage(url, "application/json");
    const size = Number(response?.headers.get("content-length") ?? 0);
    if (!response || size > maxBytes) {
      await response?.body?.cancel();
      return null;
    }
    const text = await readStart(response, { whole: true });
    return text.length > maxBytes ? null : (JSON.parse(text) as T);
  } catch {
    return null;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  rsquo: "’",
};

export function decodeEntities(text: string): string {
  return text.replaceAll(
    /&(?:#(?<decimal>\d+)|#x(?<hex>[\da-f]+)|(?<name>[a-z]+));/giu,
    (entity, decimal?: string, hex?: string, name?: string) => {
      if (name) {
        return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
      }
      const code = decimal ? Number(decimal) : Number.parseInt(hex ?? "", 16);
      try {
        return String.fromCodePoint(code);
      } catch {
        return entity;
      }
    }
  );
}

/** The text with its entities read, on one line, cut to `max`; nothing when it's empty. */
export function cleanText(
  text: string | undefined,
  max: number
): string | undefined {
  const clean = decodeEntities(text ?? "")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (!clean) {
    return undefined;
  }
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const ATTRIBUTE =
  /(?<name>[^\s"'/=>]+)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'=<>`]+)))?/gu;

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  // Past the tag's name.
  for (const match of tag.slice(5).matchAll(ATTRIBUTE)) {
    const { name, double, single, bare } = match.groups ?? {};
    if (name) {
      attributes.set(name.toLowerCase(), double ?? single ?? bare ?? "");
    }
  }
  return attributes;
}

/** Each meta tag's content by its property, name or itemprop, the first of each kept. */
export function metaTags(head: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const [tag] of head.matchAll(/<meta\s[^>]*>/giu)) {
    const attributes = attributesOf(tag);
    const key = (
      attributes.get("property") ??
      attributes.get("name") ??
      attributes.get("itemprop") ??
      ""
    ).toLowerCase();
    const content = attributes.get("content");
    if (key && content !== undefined && !tags.has(key)) {
      tags.set(key, content);
    }
  }
  return tags;
}

/** A picture's address, made whole against the page's, if it's on the web. */
export function imageUrl(
  src: string | undefined,
  base: string
): string | undefined {
  if (!src) {
    return undefined;
  }
  try {
    const url = new URL(decodeEntities(src.trim()), base);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
