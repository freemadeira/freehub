import { useMemo } from "react";
import { map, of } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { CardActivity } from "@/lib/card-activity";
import { isCardActivity, parseCardActivity } from "@/lib/card-activity";
import type { Board, Card, Comment } from "@/lib/model";
import {
  applyEdits,
  CARD_KIND,
  cardCommentAddresses,
  COMMENT_KIND,
  DELETE_KIND,
  EDIT_KIND,
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
 * search, as they last left them. Comments name what they're on, not where
 * it sits, so they're asked for by author and matched afterwards. Activity
 * shares the thread and is left out.
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
  // Edits name the comment, not what it's on, so theirs all come.
  const edits = [
    { "#k": [String(COMMENT_KIND)], authors: members, kinds: [EDIT_KIND] },
  ];
  const loaded = useObservableValue(
    () =>
      members.length > 0
        ? sync([
            ...filters,
            // Comments deleted or edited since: the store lets go of the
            // deleted ones.
            {
              "#k": [String(COMMENT_KIND)],
              authors: members,
              kinds: [DELETE_KIND, EDIT_KIND],
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
  const edited = useObservableValue(
    () => (members.length > 0 ? eventStore.timeline(edits) : of([])),
    [key]
  );
  // Kept the same until something changes, as search indexes by it.
  const current = useMemo(
    () => applyEdits(comments ?? [], edited ?? []),
    [comments, edited]
  );
  return { comments: current, loaded: loaded ?? false };
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

/**
 * The card's comments, as their writers last left them, and activity, which
 * share its NIP-22 thread.
 */
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
      ids.length > 0
        ? sync([{ "#e": ids, kinds: [DELETE_KIND, EDIT_KIND] }])
        : undefined,
    [ids.join(",")]
  );
  const edits = useObservableValue(
    () =>
      ids.length > 0
        ? eventStore.timeline([{ "#e": ids, kinds: [EDIT_KIND] }])
        : of([]),
    [ids.join(",")]
  );
  return useMemo(
    () =>
      thread
        ? { ...thread, comments: applyEdits(thread.comments, edits ?? []) }
        : { activity: [], comments: [] },
    [thread, edits]
  );
}
