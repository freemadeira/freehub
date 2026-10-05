import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { Board, BoardContent } from "@/lib/model";
import { CARD_KIND, resolveBoard, SPRINT_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { sync } from "@/lib/relays";

/** Cards and sprints of a board, resolved across every member's versions. */
export function useBoardContent(board: Board): {
  content: BoardContent | undefined;
  loaded: boolean;
} {
  const filters = [{ "#a": [board.address], kinds: [CARD_KIND, SPRINT_KIND] }];
  const loaded = useObservableValue(() => sync(filters), [board.address]);
  const content = useObservableValue(
    () =>
      eventStore
        .timeline(filters)
        .pipe(map((events) => resolveBoard(board, events))),
    [board.address, board.event.id]
  );
  return { content, loaded: loaded ?? false };
}
