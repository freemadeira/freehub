import { createContext, use } from "react";
import { useLocation, useSearchParams } from "wouter";

import type { BoardLayout } from "@/features/board/layout-switch";
import type { Board, BoardContent, Card, CardFields } from "@/lib/model";

/** The tabs a board shows its cards in. */
export const BOARD_TABS = ["backlog", "sprint", "done"] as const;
export const DEFAULT_TAB = "sprint";

export type BoardTab = (typeof BOARD_TABS)[number];

/** The board tab a link opens, from its `tab` parameter. */
export function parseTab(value: string | null): BoardTab {
  return BOARD_TABS.find((tab) => tab === value) ?? DEFAULT_TAB;
}

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

/** The board the current page shows, if any: its own page, or one of its cards. */
export function useOpenBoard(boards: Board[]): Board | undefined {
  const [location] = useLocation();
  const [search] = useSearchParams();
  // Board pages sit one level deep: `/FREE` or `/FREE-12`.
  const [, segment = "", ...rest] = location.split("/");
  const slug = rest.length === 0 ? parseSlug(segment) : undefined;
  return slug ? findBoard(boards, slug.code, search.get("board")) : undefined;
}

type Navigate = ReturnType<typeof useLocation>[1];

/** Swaps the open card for another, kept as one history entry with how it was opened. */
export function swapCard(navigate: Navigate, href: string) {
  navigate(href, { replace: true, state: history.state });
}
