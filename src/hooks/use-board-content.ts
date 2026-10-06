import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { Board, BoardContent } from "@/lib/model";
import { CARD_KIND, resolveBoard, SPRINT_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { addressFilters, sync } from "@/lib/relays";

const KINDS = [CARD_KIND, SPRINT_KIND];

/** Cards and sprints of a board, resolved across every member's versions. */
export function useBoardContent(board: Board): {
  content: BoardContent | undefined;
  loaded: boolean;
} {
  const filters = [{ "#a": [board.address], kinds: KINDS }];
  const loaded = useObservableValue(
    () =>
      sync(
        addressFilters("#a", [board.address], { kinds: KINDS }, board.members)
      ),
    [board.address, board.members.join(",")]
  );
  const content = useObservableValue(
    () =>
      eventStore
        .timeline(filters)
        .pipe(map((events) => resolveBoard(board, events))),
    [board.address, board.event.id]
  );
  return { content, loaded: loaded ?? false };
}
