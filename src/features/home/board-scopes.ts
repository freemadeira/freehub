import type { BoardScope } from "@/features/board/board-context";
import { boardQuery } from "@/features/board/board-context";
import type { MyCard } from "@/hooks/use-my-cards";
import type { Board } from "@/lib/model";
import { canEdit, needsCardId } from "@/lib/model";
import { cardPath } from "@/lib/paths";

/**
 * What each board's cards need to show and edit from Home, as they would on
 * the board itself, by board address.
 */
export function boardScopes(
  cards: MyCard[],
  boards: Board[],
  pubkey: string
): Map<string, BoardScope> {
  const scopes = new Map<string, BoardScope>();
  for (const { board, content } of cards) {
    if (scopes.has(board.address)) {
      continue;
    }
    const query = boardQuery(board, boards);
    scopes.set(board.address, {
      board,
      boardQuery: query,
      canEdit: canEdit(board, pubkey),
      cardHref: (card) =>
        cardPath(board, card, { query, withId: needsCardId(content, card) }),
      cards: content.cards,
      content,
      layout: "list",
      // Home adds no cards; boards do.
      newCard: () => {
        // Nothing to open.
      },
      pubkey,
    });
  }
  return scopes;
}
