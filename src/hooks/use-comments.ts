import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { CardActivity } from "@/lib/card-activity";
import { isCardActivity, parseCardActivity } from "@/lib/card-activity";
import type { Board, Card, Comment } from "@/lib/model";
import {
  CARD_KIND,
  cardCommentAddresses,
  COMMENT_KIND,
  DELETE_KIND,
  parseComment,
} from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { addressFilters, sync } from "@/lib/relays";

export interface CardThread {
  /** Oldest first. */
  comments: Comment[];
  /** What happened to the card, oldest first. */
  activity: CardActivity[];
}

/** The card's comments and activity, which share its NIP-22 thread. */
export function useCardThread(board: Board, card: Card): CardThread {
  const addresses = cardCommentAddresses(board, card);
  const filters = [{ "#A": addresses, kinds: [COMMENT_KIND] }];
  const key = `${board.event.id}:${card.id}`;
  useObservableValue(
    () =>
      sync(
        addressFilters(
          "#A",
          addresses,
          { "#K": [String(CARD_KIND)], kinds: [COMMENT_KIND] },
          board.members
        )
      ),
    [key]
  );
  const thread = useObservableValue(
    () =>
      eventStore.timeline(filters).pipe(
        map((events): CardThread => {
          const own = events
            .filter((event) => board.members.includes(event.pubkey))
            .toReversed();
          return {
            activity: own.flatMap((event) => parseCardActivity(event) ?? []),
            comments: own
              .filter((event) => !isCardActivity(event))
              .map(parseComment),
          };
        })
      ),
    [key]
  );
  const ids =
    thread?.comments.flatMap((comment) =>
      comment.event.sig ? [comment.id] : []
    ) ?? [];
  useObservableValue(
    () =>
      ids.length > 0 ? sync([{ "#e": ids, kinds: [DELETE_KIND] }]) : undefined,
    [ids.join(",")]
  );
  return thread ?? { activity: [], comments: [] };
}
