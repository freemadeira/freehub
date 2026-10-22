import { map, of } from "rxjs";

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

/**
 * Every comment these people wrote on things of one kind, like cards, for
 * search. Comments name what they're on, not where it sits, so they're asked
 * for by author and matched afterwards. Activity shares the thread and is
 * left out.
 */
export function useCommentsOn(
  kind: number,
  people: string[]
): { comments: Comment[]; loaded: boolean } {
  const members = [...new Set(people)];
  const key = `${kind}:${members.toSorted().join(",")}`;
  const filters = [
    { "#K": [String(kind)], authors: members, kinds: [COMMENT_KIND] },
  ];
  const loaded = useObservableValue(
    () =>
      members.length > 0
        ? sync([
            ...filters,
            // Comments deleted since, which the store then lets go of.
            {
              "#k": [String(COMMENT_KIND)],
              authors: members,
              kinds: [DELETE_KIND],
            },
          ])
        : of(true),
    [key]
  );
  const comments = useObservableValue(
    () =>
      members.length > 0
        ? eventStore
            .timeline(filters)
            .pipe(
              map((events) =>
                events
                  .filter((event) => !isCardActivity(event))
                  .map(parseComment)
              )
            )
        : of([]),
    [key]
  );
  return { comments: comments ?? [], loaded: loaded ?? false };
}

/** Every comment the boards' members wrote on cards, for search. */
export function useCardComments(boards: Board[]): {
  comments: Comment[];
  loaded: boolean;
} {
  return useCommentsOn(
    CARD_KIND,
    boards.flatMap((board) => board.members)
  );
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
