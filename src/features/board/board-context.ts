import { createContext, use } from "react";

import type { BoardLayout } from "@/features/board/layout-switch";
import type { Board, BoardContent, Card, CardFields } from "@/lib/model";

/** History state that lets leaving a card's page be a plain back navigation. */
export const OPENED_FROM_BOARD = { fromBoard: true };

/** Where a new card starts, from the column or list it was added in. */
export type CardPlacement = Pick<CardFields, "status" | "sprint">;

export interface BoardScope {
  board: Board;
  content: BoardContent;
  cards: Card[];
  /** Whether the sprint's cards show as a column per status or a list. */
  layout: BoardLayout;
  pubkey: string;
  /** Whether the user is a member, not just a viewer, of the board. */
  canEdit: boolean;
  cardHref: (card: Card) => string;
  /** Names the board in links when another board the user sees shares its code. */
  boardQuery: URLSearchParams;
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

/** `?board=` with the board's id when another of the boards shares its code. */
export function boardQuery(board: Board, boards: Board[]): URLSearchParams {
  const shared = boards.some(
    (item) => item.code === board.code && item.address !== board.address
  );
  return new URLSearchParams(shared ? { board: board.id } : {});
}

export function boardPath(board: Board, boards: Board[]): string {
  const search = boardQuery(board, boards).toString();
  return `/${board.code}${search ? `?${search}` : ""}`;
}

const SLUG = /^(?<code>[A-Z][A-Z0-9]{0,9})(?:-(?<number>\d+))?$/u;

/**
 * The board a link points at. Codes are picked per person, so two boards can
 * share one; a link then names the board by id in `?board=`.
 */
export function findBoard(
  boards: Board[],
  code: string,
  id: string | null
): Board | undefined {
  return id === null
    ? boards.find((board) => board.code === code)
    : boards.find((board) => board.id === id);
}

/** Splits a path segment like `FREE-12` into the board code and card number. */
export function parseSlug(
  value: string
): { code: string; number?: number } | undefined {
  const groups = SLUG.exec(value.toUpperCase())?.groups;
  if (!groups?.code) {
    return undefined;
  }
  return {
    code: groups.code,
    number: groups.number ? Number(groups.number) : undefined,
  };
}
