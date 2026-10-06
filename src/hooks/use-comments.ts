import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
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

export function useComments(board: Board, card: Card): Comment[] {
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
  const comments = useObservableValue(
    () =>
      eventStore.timeline(filters).pipe(
        map((events) =>
          events
            .filter((event) => board.members.includes(event.pubkey))
            .map(parseComment)
            .toReversed()
        )
      ),
    [key]
  );
  const ids =
    comments?.flatMap((comment) => (comment.event.sig ? [comment.id] : [])) ??
    [];
  useObservableValue(
    () =>
      ids.length > 0 ? sync([{ "#e": ids, kinds: [DELETE_KIND] }]) : undefined,
    [ids.join(",")]
  );
  return comments ?? [];
}
