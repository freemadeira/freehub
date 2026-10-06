import { createContext, use } from "react";

import type { Board, BoardContent, Card, CardFields } from "@/lib/model";
import { cardKey } from "@/lib/model";

/** History state that lets the card dialog close with a plain back navigation. */
export const OPENED_FROM_BOARD = { fromBoard: true };

/** Where a new card starts, from the column or list it was added in. */
export type CardPlacement = Pick<CardFields, "status" | "sprint">;

export interface BoardScope {
  board: Board;
  content: BoardContent;
  cards: Card[];
  pubkey: string;
  cardHref: (card: Card) => string;
  /** Opens the new card dialog. */
  newCard: (placement: CardPlacement) => void;
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
