import { useBoardContents } from "@/hooks/use-board-contents";
import type { Board, BoardContent } from "@/lib/model";
import type { CardFinder } from "@/lib/relations";
import { cardFinder } from "@/lib/relations";

/**
 * Finds the board's cards, and those on the other boards its cards are
 * related to, whose cards load along with it.
 */
export function useCardFinder(
  board: Board,
  content: BoardContent | undefined,
  boards: Board[]
): CardFinder {
  const reached = new Set(
    content?.relations.flatMap(({ from, to }) => [from.board, to.board])
  );
  const others = boards.filter(
    (other) => other.address !== board.address && reached.has(other.address)
  );
  const { contents } = useBoardContents(others);
  return cardFinder(
    [board, ...others],
    new Map([
      ...(contents ?? []),
      ...(content ? [[board.address, content] as const] : []),
    ])
  );
}
