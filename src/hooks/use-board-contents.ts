import type { NostrEvent } from "applesauce-core/helpers/event";
import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { Board, BoardContent } from "@/lib/model";
import {
  boardsOf,
  CARD_KIND,
  RELATION_KIND,
  resolveBoard,
  SPRINT_KIND,
} from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { addressFilters, sync, whileLoading } from "@/lib/relays";

const KINDS = [CARD_KIND, SPRINT_KIND, RELATION_KIND];

function resolveBoards(
  boards: Board[],
  events: NostrEvent[]
): Map<string, BoardContent> {
  const byBoard = new Map<string, NostrEvent[]>();
  for (const event of events) {
    // Cards related across boards count on both.
    for (const address of boardsOf(event)) {
      byBoard.set(address, [...(byBoard.get(address) ?? []), event]);
    }
  }
  return new Map(
    boards.map((board) => [
      board.address,
      resolveBoard(board, byBoard.get(board.address) ?? []),
    ])
  );
}

/**
 * Cards and sprints of every board given, by board address, each board
 * resolved whole across every member's versions.
 */
export function useBoardContents(boards: Board[]): {
  contents: Map<string, BoardContent> | undefined;
  loaded: boolean;
} {
  const addresses = boards.map((board) => board.address).toSorted();
  const authors = [...new Set(boards.flatMap((board) => board.members))];
  const key = `${addresses.join(",")}|${authors.toSorted().join(",")}`;
  const feed = () =>
    sync(addressFilters("#a", addresses, { kinds: KINDS }, authors));
  const loaded = useObservableValue(feed, [key]);
  const contents = useObservableValue(
    () =>
      addresses.length > 0
        ? whileLoading(
            eventStore.timeline([{ "#a": addresses, kinds: KINDS }]),
            feed()
          ).pipe(map((events) => resolveBoards(boards, events)))
        : undefined,
    [key, boards.map((board) => board.event.id).join(",")]
  );
  return { contents, loaded: (loaded ?? false) || addresses.length === 0 };
}
