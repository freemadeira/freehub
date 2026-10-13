import type { NostrEvent } from "applesauce-core/helpers/event";
import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { Board, BoardContent, Card } from "@/lib/model";
import {
  addressOf,
  BOARD_KIND,
  CARD_KIND,
  isClosed,
  resolveBoard,
} from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { addressFilters, sync, whileLoading } from "@/lib/relays";

const KINDS = [CARD_KIND];

/** An open card of the person's, with the board it's on. */
export interface MyCard {
  card: Card;
  board: Board;
  content: BoardContent;
  assigned: boolean;
  created: boolean;
}

function resolveBoards(
  boards: Board[],
  events: NostrEvent[]
): Map<string, BoardContent> {
  const byBoard = new Map<string, NostrEvent[]>();
  for (const event of events) {
    const address = addressOf(event, BOARD_KIND);
    if (address) {
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
 * Open cards assigned to the person or made by them, on every board they're
 * on. Each board is resolved whole, across every member's versions, so a
 * newer version that took them off a card counts.
 */
export function useMyCards(
  boards: Board[],
  pubkey: string
): { cards: MyCard[]; loaded: boolean } {
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

  const cards = boards.flatMap((board) => {
    const content = contents?.get(board.address);
    if (!content) {
      return [];
    }
    return content.cards.flatMap((card): MyCard[] => {
      const assigned = card.assignees.includes(pubkey);
      const created = card.creator === pubkey;
      return !isClosed(card.status) && (assigned || created)
        ? [{ assigned, board, card, content, created }]
        : [];
    });
  });
  return { cards, loaded: (loaded ?? false) || addresses.length === 0 };
}
