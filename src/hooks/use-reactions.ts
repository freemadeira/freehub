import type { NostrEvent } from "applesauce-core/helpers/event";
import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { Board, Card, Comment } from "@/lib/model";
import {
  CARD_KIND,
  cardCommentAddresses,
  DELETE_KIND,
  REACTION_KIND,
} from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Reaction } from "@/lib/reactions";
import { groupReactions } from "@/lib/reactions";
import { addressFilters, sync } from "@/lib/relays";

const NONE: ReadonlyMap<string, Reaction[]> = new Map();

/** The last of a tag, which NIP-25 says names what was reacted to. */
function lastTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.findLast(([tag]) => tag === name)?.[1];
}

/** Something reactions are on: its id, its address under every member, and who those are. */
export interface ReactedTo {
  id: string;
  kind: number;
  addresses: string[];
  members: string[];
  /** Changes when any of the above do. */
  key: string;
}

/**
 * The reactions to a card or link and to its comments, by the card's, link's
 * or comment's id. Only members' count, as with everything else there.
 */
export function useThreadReactions(
  { id, kind, addresses, members, key }: ReactedTo,
  comments: Comment[]
): ReadonlyMap<string, Reaction[]> {
  const commentIds = comments.flatMap((comment) =>
    comment.event.sig ? [comment.id] : []
  );
  const commentsKey = commentIds.join(",");
  useObservableValue(
    () =>
      sync(
        addressFilters(
          "#a",
          addresses,
          { "#k": [String(kind)], kinds: [REACTION_KIND] },
          members
        )
      ),
    [key]
  );
  useObservableValue(
    () =>
      commentIds.length > 0
        ? sync([{ "#e": commentIds, kinds: [REACTION_KIND] }])
        : undefined,
    [commentsKey]
  );
  const events = useObservableValue(
    () =>
      eventStore
        .timeline([
          { "#a": addresses, kinds: [REACTION_KIND] },
          ...(commentIds.length > 0
            ? [{ "#e": commentIds, kinds: [REACTION_KIND] }]
            : []),
        ])
        .pipe(
          map((all) => all.filter((event) => members.includes(event.pubkey)))
        ),
    [key, commentsKey]
  );
  const ids = events?.flatMap((event) => (event.sig ? [event.id] : [])) ?? [];
  useObservableValue(
    () =>
      ids.length > 0 ? sync([{ "#e": ids, kinds: [DELETE_KIND] }]) : undefined,
    [ids.join(",")]
  );
  if (!events) {
    return NONE;
  }
  const onThing = new Set(addresses);
  const onComment = new Set(commentIds);
  return groupReactions(events, (event) => {
    const address = lastTag(event, "a");
    if (address !== undefined && onThing.has(address)) {
      return id;
    }
    const comment = lastTag(event, "e");
    return comment !== undefined && onComment.has(comment)
      ? comment
      : undefined;
  });
}

/** The reactions to a card and to its comments, by the card's or comment's id. */
export function useCardReactions(
  board: Board,
  card: Card,
  comments: Comment[]
): ReadonlyMap<string, Reaction[]> {
  return useThreadReactions(
    {
      addresses: cardCommentAddresses(board, card),
      id: card.id,
      key: `${board.event.id}:${card.id}`,
      kind: CARD_KIND,
      members: board.members,
    },
    comments
  );
}
