import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { Board } from "@/lib/model";
import { BOARD_KIND, DELETE_KIND, parseBoard } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { sync } from "@/lib/relays";

const EVERY_BOARD: Filter[] = [{ kinds: [BOARD_KIND] }];

function boardFilters(pubkey: string): Filter[] {
  return [
    { authors: [pubkey], kinds: [BOARD_KIND] },
    { "#p": [pubkey], kinds: [BOARD_KIND] },
  ];
}

function parseBoards(events: NostrEvent[]): Board[] {
  return events
    .map(parseBoard)
    .filter((board) => board !== undefined)
    .toSorted(
      (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
    );
}

/** Boards the user created or was added to. */
export function useBoards(pubkey: string): {
  boards: Board[];
  loaded: boolean;
} {
  const loaded = useObservableValue(
    () =>
      sync([
        ...boardFilters(pubkey),
        { "#k": [String(BOARD_KIND)], kinds: [DELETE_KIND] },
      ]),
    [pubkey]
  );
  const boards = useObservableValue(
    () => eventStore.timeline(boardFilters(pubkey)).pipe(map(parseBoards)),
    [pubkey]
  );
  return { boards: boards ?? [], loaded: loaded ?? false };
}

/**
 * Every board on the team relays, also the ones the user isn't in, so a new
 * code can't clash with a board someone else sees.
 */
export function useEveryBoard(): Board[] {
  useObservableValue(() => sync(EVERY_BOARD), []);
  const boards = useObservableValue(
    () => eventStore.timeline(EVERY_BOARD).pipe(map(parseBoards)),
    []
  );
  return boards ?? [];
}
