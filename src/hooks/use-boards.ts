import type { Filter } from "applesauce-core/helpers/filter";
import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { Board } from "@/lib/model";
import { BOARD_KIND, DELETE_KIND, parseBoard } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { sync } from "@/lib/relays";

function boardFilters(pubkey: string): Filter[] {
  return [
    { authors: [pubkey], kinds: [BOARD_KIND] },
    { "#p": [pubkey], kinds: [BOARD_KIND] },
  ];
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
    () =>
      eventStore.timeline(boardFilters(pubkey)).pipe(
        map((events) =>
          events
            .map(parseBoard)
            .filter((board) => board !== undefined)
            .toSorted((a, b) => a.title.localeCompare(b.title))
        )
      ),
    [pubkey]
  );
  return { boards: boards ?? [], loaded: loaded ?? false };
}
