import { createContext, use } from "react";

import type { NewCard } from "@/lib/actions";
import type { Board, BoardContent, Card } from "@/lib/model";
import { cardKey } from "@/lib/model";

export interface BoardScope {
  board: Board;
  content: BoardContent;
  cards: Card[];
  pubkey: string;
  cardHref: (card: Card) => string;
  addCard: (fields: Pick<NewCard, "title" | "status" | "sprint">) => void;
}

export const BoardContext = createContext<BoardScope | null>(null);

export function useBoard(): BoardScope {
  const scope = use(BoardContext);
  if (!scope) {
    throw new Error("useBoard needs a BoardContext provider.");
  }
  return scope;
}

/** Cards from clients that don't number them are addressed by id instead. */
export function cardPath(
  board: Board,
  card: Card,
  query?: URLSearchParams
): string {
  const params = new URLSearchParams(query);
  if (card.number === undefined) {
    params.set("card", card.id);
  }
  const search = params.toString();
  return `/${cardKey(board, card)}${search ? `?${search}` : ""}`;
}
