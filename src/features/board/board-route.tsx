import { Link } from "wouter";

import { TopBar } from "@/components/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BoardPage,
  BoardSkeleton,
  boardCrumbs,
} from "@/features/board/board-page";
import type { Board } from "@/lib/model";
import type { Project } from "@/lib/project";

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

interface BoardRouteProps {
  /** The code the link names, shown until the board turns up. */
  code: string;
  board?: Board;
  boards: Board[];
  cardNumber?: number;
  loaded: boolean;
  /** The project the board belongs to, if the user sees it. */
  project?: Project;
  projects: Project[];
  pubkey: string;
}

export function BoardRoute({ code, board, loaded, ...props }: BoardRouteProps) {
  if (board) {
    return <BoardPage board={board} key={board.address} {...props} />;
  }
  if (!loaded) {
    return (
      <>
        <TopBar crumbs={boardCrumbs(code)} />
        <main aria-busy className="flex grow flex-col gap-4 px-4 pb-8 sm:px-6">
          <Skeleton className="h-9 w-64 rounded-full" />
          <BoardSkeleton />
        </main>
      </>
    );
  }
  return (
    <>
      <TopBar crumbs={boardCrumbs(code)} />
      <Empty>
        <EmptyTitle>Board not found</EmptyTitle>
        <Link className={buttonVariants({ variant: "outline" })} href="/">
          All boards
        </Link>
      </Empty>
    </>
  );
}
