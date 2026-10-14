import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue, isAddressableKind } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";

import type { Board, Card, Comment, Template } from "@/lib/model";
import { cardCommentAddresses, DELETE_KIND, REACTION_KIND } from "@/lib/model";

/** Different emoji one card or comment can be reacted with. */
export const MAX_REACTION_KINDS = 20;
/** Longer than any emoji, family and flag sequences included. */
const MAX_EMOJI = 32;
/** What emoji are made of: pictures, joiners, skin tones and the like. */
const EMOJI_PARTS = /^[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;
/** What makes them a picture, not a digit or a letter on its own. */
const PICTURE = /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;
/** NIP-25's like, which other Nostr clients send as "+". */
const LIKE = "👍";

export interface Reaction {
  emoji: string;
  /** Who reacted with it, first first. */
  people: string[];
}

/** For a card or a comment no one reacted to. Never changed. */
export const NO_REACTIONS: Reaction[] = [];

/** A card or a comment, and where its reactions are found. */
export interface ReactionTarget {
  /** The card's or comment's id, which its reactions are grouped under. */
  id: string;
  /** The version reacted to. */
  event: NostrEvent;
  /** Its reactions, from anyone. */
  filter: Filter;
}

function isEmoji(text: string): boolean {
  return (
    text.length <= MAX_EMOJI && EMOJI_PARTS.test(text) && PICTURE.test(text)
  );
}

/** The emoji a reaction is, or nothing for a dislike or a custom emoji. */
export function reactionEmoji(event: NostrEvent): string | undefined {
  const content = event.content.trim();
  if (content === "+" || content === "") {
    return LIKE;
  }
  return isEmoji(content) ? content : undefined;
}

/**
 * A card, by its address on every member's version, so reactions outlast the
 * version they were made on.
 */
export function cardReactionTarget(board: Board, card: Card): ReactionTarget {
  return {
    event: card.event,
    filter: { "#a": cardCommentAddresses(board, card), kinds: [REACTION_KIND] },
    id: card.id,
  };
}

export function commentReactionTarget(comment: Comment): ReactionTarget {
  return {
    event: comment.event,
    filter: { "#e": [comment.id], kinds: [REACTION_KIND] },
    id: comment.id,
  };
}

/**
 * The reactions to each card or comment, by its id: each emoji once, with who
 * reacted with it, in the order they were first used.
 */
export function groupReactions(
  events: NostrEvent[],
  targetOf: (event: NostrEvent) => string | undefined
): Map<string, Reaction[]> {
  const groups = new Map<string, Map<string, string[]>>();
  for (const event of events.toSorted((a, b) => a.created_at - b.created_at)) {
    const target = targetOf(event);
    const emoji = reactionEmoji(event);
    if (target === undefined || emoji === undefined) {
      continue;
    }
    const byEmoji = groups.get(target) ?? new Map<string, string[]>();
    groups.set(target, byEmoji);
    const people = byEmoji.get(emoji) ?? [];
    byEmoji.set(emoji, people);
    if (!people.includes(event.pubkey)) {
      people.push(event.pubkey);
    }
  }
  return new Map(
    [...groups].map(([target, byEmoji]) => [
      target,
      [...byEmoji].map(([emoji, people]) => ({ emoji, people })),
    ])
  );
}

/**
 * A NIP-25 reaction. A card's also names its address, which every member's
 * version shares; one still at the signer has no id to name yet.
 */
export function reactionTemplate(target: NostrEvent, emoji: string): Template {
  const id = isAddressableKind(target.kind)
    ? getTagValue(target, "d")
    : undefined;
  return {
    content: emoji,
    kind: REACTION_KIND,
    tags: [
      ...(target.sig ? [["e", target.id]] : []),
      ...(id === undefined
        ? []
        : [["a", `${target.kind}:${target.pubkey}:${id}`]]),
      ["p", target.pubkey],
      ["k", String(target.kind)],
    ],
  };
}

/** Takes reactions back, as NIP-25 has it: by deleting them (NIP-09). */
export function deleteReactionsTemplate(reactions: NostrEvent[]): Template {
  return {
    content: "",
    kind: DELETE_KIND,
    tags: [
      ...reactions.map((reaction) => ["e", reaction.id]),
      ["k", String(REACTION_KIND)],
    ],
  };
}
