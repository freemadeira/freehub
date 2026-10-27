import { useBoardContents } from "@/hooks/use-board-contents";
import type { Board, BoardContent, Card } from "@/lib/model";
import { isClosed } from "@/lib/model";
import type { CardFinder } from "@/lib/relations";
import { cardFinder } from "@/lib/relations";

/** An open card of the person's, with the board it's on. */
export interface MyCard {
  card: Card;
  board: Board;
  content: BoardContent;
  assigned: boolean;
  created: boolean;
}

/**
 * Open cards assigned to the person or made by them, on every board they're
 * on. Each board is resolved whole, across every member's versions, so a
 * newer version that took them off a card counts. Any card on those boards
 * can be found, as the cards related to them are.
 */
export function useMyCards(
  boards: Board[],
  pubkey: string
): { cards: MyCard[]; findCard: CardFinder; loaded: boolean } {
  const { contents, loaded } = useBoardContents(boards);
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
  return { cards, findCard: cardFinder(boards, contents), loaded };
}
