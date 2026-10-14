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

/**
 * The reactions to a card and to its comments, by the card's or comment's
 * id. Only members' count, as with everything on the board.
 */
export function useCardReactions(
  board: Board,
  card: Card,
  comments: Comment[]
): ReadonlyMap<string, Reaction[]> {
  const addresses = cardCommentAddresses(board, card);
  const commentIds = comments.flatMap((comment) =>
    comment.event.sig ? [comment.id] : []
  );
  const key = `${board.event.id}:${card.id}`;
  const commentsKey = commentIds.join(",");
  useObservableValue(
    () =>
      sync(
        addressFilters(
          "#a",
          addresses,
          { "#k": [String(CARD_KIND)], kinds: [REACTION_KIND] },
          board.members
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
          map((all) =>
            all.filter((event) => board.members.includes(event.pubkey))
          )
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
  const onCard = new Set(addresses);
  const onComment = new Set(commentIds);
  return groupReactions(events, (event) => {
    const address = lastTag(event, "a");
    if (address !== undefined && onCard.has(address)) {
      return card.id;
    }
    const id = lastTag(event, "e");
    return id !== undefined && onComment.has(id) ? id : undefined;
  });
}
