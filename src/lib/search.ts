/** Searching what the team wrote. No browser APIs here, so tests run it as is. */

/** Longest search taken, in characters; the rest is left off. */
export const MAX_QUERY = 100;

/** How much of the text around a match a result shows, in characters. */
const SNIPPET = 140;

/** The kinds of things search finds in what people wrote. */
export const SEARCH_KINDS = [
  "card",
  "doc",
  "record",
  "file",
  "link",
  "comment",
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** The places kept among the ones the user opened lately. */
export const PLACE_KINDS = [
  "project",
  "board",
  "card",
  "doc",
  "table",
  "record",
  "folder",
  "catalog",
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** A card's key, like `FREE-12`, typed in any case. */
export const CARD_KEY = /^(?<code>[a-z][a-z0-9]{0,9})-(?<number>\d+)$/iu;

/** The text's words, lowercase, in order. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The words searched for, lowercase, each once, in the order typed. */
export function searchTerms(text: string): string[] {
  return [...new Set(wordsOf(text.slice(0, MAX_QUERY)))];
}

/**
 * Text made ready to search many times: its words, lowercase, each after a
 * space, so a word starting with a term is a plain substring check.
 */
export function searchable(text: string): string {
  return ` ${wordsOf(text).join(" ")}`;
}

/** Whether every word searched for starts a word of text made `searchable`. */
export function hasTerms(text: string, terms: string[]): boolean {
  return terms.length > 0 && terms.every((term) => text.includes(` ${term}`));
}

/** `matchScore` of a name made `searchable` already. */
export function searchableScore(name: string, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const said = name.slice(1);
  const wanted = terms.join(" ");
  if (said === wanted) {
    return 3;
  }
  if (said.startsWith(wanted)) {
    return 2;
  }
  return hasTerms(name, terms) ? 1 : 0;
}

/**
 * How well a name matches the words searched for: 3 when it's just those
 * words, 2 when it starts with them, 1 when each starts one of its words,
 * and 0 when it doesn't match.
 */
export function matchScore(name: string, terms: string[]): number {
  return searchableScore(searchable(name), terms);
}

/**
 * Markdown as it reads: without its marks, link targets, images or mention
 * references, on one line. Links to the app keep their address.
 */
export function plainText(markdown: string): string {
  return (
    markdown
      // Images first, so their brackets don't read as links.
      .replaceAll(/!\[[^\]]*\]\([^)]*\)/gu, " ")
      .replaceAll(/\[(?<text>[^\]]*)\]\([^)]*\)/gu, "$<text>")
      .replaceAll(/<(?<address>https?:\/\/[^\s<>]+)>/gu, "$<address>")
      .replaceAll(/nostr:(?:npub|nprofile)1[02-9ac-hj-np-z]+/gu, " ")
      .replaceAll(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/gmu, "")
      .replaceAll(/\[[ xX]\]\s/gu, "")
      .replaceAll("&nbsp;", " ")
      .replaceAll(/[*_~`|\\]+/gu, "")
      .replaceAll(/\s+/gu, " ")
      .trim()
  );
}

/** Where a word starting with the term begins in the text, or -1. */
function wordAt(lower: string, term: string): number {
  let at = lower.indexOf(term);
  while (at > 0 && /[\p{L}\p{N}]/u.test(lower[at - 1] ?? "")) {
    at = lower.indexOf(term, at + 1);
  }
  return at;
}

/**
 * The part of plain text around the first word searched for, with an
 * ellipsis where it was cut. Undefined when no word is in it.
 */
export function snippet(plain: string, terms: string[]): string | undefined {
  const lower = plain.toLowerCase();
  const at = Math.min(
    ...terms.map((term) => wordAt(lower, term)).filter((index) => index !== -1)
  );
  if (!Number.isFinite(at)) {
    return undefined;
  }
  // A little before the match, starting on a word.
  let start = Math.max(0, at - SNIPPET / 4);
  if (start > 0) {
    const space = plain.indexOf(" ", start);
    start = space !== -1 && space < at ? space + 1 : start;
  }
  const end = Math.min(plain.length, start + SNIPPET);
  return `${start > 0 ? "…" : ""}${plain.slice(start, end).trim()}${end < plain.length ? "…" : ""}`;
}
