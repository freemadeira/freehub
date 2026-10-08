/**
 * Mentions follow NIP-27: the content carries a `nostr:npub1…` reference and
 * the event a `p` tag per person, so other Nostr clients render them too and
 * relays can route them with `#p` queries. No browser APIs here, so a bot or
 * an email bridge can reuse it.
 */
import {
  normalizeToPubkey,
  npubEncode,
} from "applesauce-core/helpers/pointers";

import { shortNpub } from "@/lib/utils";

// An npub is always 58 characters after its `1`, so text written right after
// one, with no space, stays text.
const REFERENCE =
  /nostr:(?<bech32>npub1[02-9ac-hj-np-z]{58}|nprofile1[02-9ac-hj-np-z]+)/gu;
const LEADING_REFERENCE =
  /^nostr:(?<bech32>npub1[02-9ac-hj-np-z]{58}|nprofile1[02-9ac-hj-np-z]+)/u;
const SYNTAX = /[$()*+.?[\\\]^{|}]/gu;

/** Someone picked from the mention list while writing, by the name shown. */
export interface Mention {
  name: string;
  pubkey: string;
}

export type MentionSegment =
  | { type: "text"; text: string }
  | { type: "mention"; pubkey: string };

export function mentionReference(pubkey: string): string {
  return `nostr:${npubEncode(pubkey)}`;
}

/** The mention the text starts with: who, and the reference as written. */
export function leadingMention(
  text: string
): { pubkey: string; reference: string } | undefined {
  const match = LEADING_REFERENCE.exec(text);
  const bech32 = match?.groups?.bech32;
  const pubkey = bech32 ? normalizeToPubkey(bech32) : null;
  return match && pubkey ? { pubkey, reference: match[0] } : undefined;
}

/** Splits content into plain text and the people it mentions, in order. */
export function splitMentions(content: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of content.matchAll(REFERENCE)) {
    const [reference] = match;
    const bech32 = match.groups?.bech32;
    const pubkey = bech32 ? normalizeToPubkey(bech32) : null;
    if (!pubkey) {
      continue;
    }
    if (match.index > last) {
      segments.push({ text: content.slice(last, match.index), type: "text" });
    }
    segments.push({ pubkey, type: "mention" });
    last = match.index + reference.length;
  }
  if (last < content.length) {
    segments.push({ text: content.slice(last), type: "text" });
  }
  return segments;
}

/** Everyone mentioned in the content, once each. */
export function mentionedPubkeys(content: string): string[] {
  return [
    ...new Set(
      splitMentions(content).flatMap((segment) =>
        segment.type === "mention" ? [segment.pubkey] : []
      )
    ),
  ];
}

export function mentions(content: string, pubkey: string): boolean {
  return mentionedPubkeys(content).includes(pubkey);
}

/** Where the content first mentions the person, or -1. */
export function mentionIndex(content: string, pubkey: string): number {
  for (const match of content.matchAll(REFERENCE)) {
    const bech32 = match.groups?.bech32;
    if (bech32 && normalizeToPubkey(bech32) === pubkey) {
      return match.index;
    }
  }
  return -1;
}

/**
 * About `length` characters of the text from about `from`, starting at a
 * word, with "…" where it was cut. A mention is never split: one at either
 * end is kept whole.
 */
export function excerptText(
  text: string,
  from: number,
  length: number
): string {
  let start = from > 0 ? text.lastIndexOf(" ", from) + 1 : 0;
  let end = Math.min(text.length, start + length);
  for (const match of text.matchAll(REFERENCE)) {
    const after = match.index + match[0].length;
    if (match.index < start && after > start) {
      start = match.index;
    }
    if (match.index < end && after > end) {
      end = after;
    }
  }
  const excerpt = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${excerpt}${end < text.length ? "…" : ""}`;
}

/**
 * The name each person is offered by when mentioning. People who share a
 * display name also show their npub, so each `@Name` stays theirs.
 */
export function mentionNames(
  people: string[],
  names: Map<string, string>
): Map<string, string> {
  const uses = new Map<string, number>();
  for (const pubkey of people) {
    const name = names.get(pubkey) ?? "";
    uses.set(name, (uses.get(name) ?? 0) + 1);
  }
  return new Map(
    people.map((pubkey) => {
      const name = names.get(pubkey) ?? "";
      return [
        pubkey,
        (uses.get(name) ?? 0) > 1 ? `${name} ${shortNpub(pubkey)}` : name,
      ];
    })
  );
}

/**
 * Turns every `@Name` the writer picked into its reference. Longer names win,
 * so `@Ana Lu` is never read as `@Ana`, and a name the writer edited after
 * picking it stays plain text.
 */
export function encodeMentions(text: string, picked: Mention[]): string {
  const byName = new Map<string, string>();
  for (const { name, pubkey } of picked) {
    if (!byName.has(name)) {
      byName.set(name, pubkey);
    }
  }
  if (byName.size === 0) {
    return text;
  }
  const names = [...byName.keys()]
    .toSorted((a, b) => b.length - a.length)
    .map((name) => name.replaceAll(SYNTAX, String.raw`\$&`));
  const pattern = new RegExp(
    `@(?<name>${names.join("|")})(?![\\p{L}\\p{N}_])`,
    "gu"
  );
  return text.replace(pattern, (match, name: string) => {
    const pubkey = byName.get(name);
    return pubkey ? mentionReference(pubkey) : match;
  });
}
