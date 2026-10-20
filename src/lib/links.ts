/**
 * Web addresses written out in plain text, found the way GitHub links them
 * up. No browser APIs here, so a bot or an email bridge can reuse it.
 */

const ADDRESS = /https?:\/\/[^\s<>]+/giu;
const LEADING_ADDRESS = /^https?:\/\/[^\s<>]+/iu;
// Punctuation that ends a sentence, not the address before it.
const TRAILING = /[!"'*,.:;?_~]+$/u;

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

/**
 * The address without what closes the sentence around it: trailing
 * punctuation, and a ")" that closes a bracket opened before the address.
 */
function trimAddress(address: string): string {
  let trimmed = address.replace(TRAILING, "");
  while (trimmed.endsWith(")") && count(trimmed, "(") < count(trimmed, ")")) {
    trimmed = trimmed.slice(0, -1).replace(TRAILING, "");
  }
  return trimmed;
}

export type LinkSegment =
  | { type: "text"; text: string }
  | { type: "link"; url: string };

/** The address the text starts with, if it does. */
export function leadingAddress(text: string): string | undefined {
  const match = LEADING_ADDRESS.exec(text);
  const address = match ? trimAddress(match[0]) : "";
  return URL.canParse(address) ? address : undefined;
}

/** Splits text into plain text and the web addresses written in it, in order. */
export function splitLinks(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(ADDRESS)) {
    const url = trimAddress(match[0]);
    if (!URL.canParse(url)) {
      continue;
    }
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index), type: "text" });
    }
    segments.push({ type: "link", url });
    last = match.index + url.length;
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last), type: "text" });
  }
  return segments;
}
