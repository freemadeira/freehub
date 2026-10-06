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

const REFERENCE = /nostr:(?<bech32>(?:npub|nprofile)1[02-9ac-hj-np-z]+)/gu;
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
