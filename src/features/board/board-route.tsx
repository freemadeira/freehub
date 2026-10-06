import { Link } from "wouter";

import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { BoardPage, BoardSkeleton } from "@/features/board/board-page";
import type { Board } from "@/lib/model";
import type { Project } from "@/lib/project";

const SLUG = /^(?<code>[A-Z][A-Z0-9]{0,9})(?:-(?<number>\d+))?$/u;

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
  board?: Board;
  boards: Board[];
  cardNumber?: number;
  loaded: boolean;
  projects: Project[];
  pubkey: string;
}

export function BoardRoute({ board, loaded, ...props }: BoardRouteProps) {
  if (board) {
    return <BoardPage board={board} key={board.address} {...props} />;
  }
  if (!loaded) {
    return (
      <main aria-busy className="flex grow flex-col gap-4 px-4 pb-8 sm:px-6">
        <Skeleton className="h-9 w-64 rounded-full" />
        <BoardSkeleton />
      </main>
    );
  }
  return (
    <Empty>
      <EmptyTitle>Board not found</EmptyTitle>
      <Link className={buttonVariants({ variant: "outline" })} href="/">
        All boards
      </Link>
    </Empty>
  );
}
