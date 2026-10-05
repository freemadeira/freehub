import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { BoardDialog } from "@/features/boards/board-dialog";
import type { Board } from "@/lib/model";

const VISIBLE_MEMBERS = 5;

function BoardCard({ board }: { board: Board }) {
  const hidden = board.members.length - VISIBLE_MEMBERS;
  return (
    <Link
      className="bg-card shadow-surface hover:shadow-raised focus-visible:ring-ring/50 flex min-h-36 flex-col gap-2 rounded-2xl p-5 transition-[box-shadow,scale] duration-150 ease-out outline-none focus-visible:ring-3 active:scale-[0.99]"
      href={`/${board.code}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 leading-snug font-medium">{board.title}</h2>
        <span className="bg-muted text-muted-foreground shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs">
          {board.code}
        </span>
      </div>
      {board.description && (
        <p className="text-muted-foreground line-clamp-2 text-sm">
          {board.description}
        </p>
      )}
      <AvatarGroup className="mt-auto pt-2">
        {board.members.slice(0, VISIBLE_MEMBERS).map((member) => (
          <UserAvatar key={member} pubkey={member} size="sm" />
        ))}
        {hidden > 0 && <AvatarGroupCount>+{hidden}</AvatarGroupCount>}
      </AvatarGroup>
    </Link>
  );
}

interface BoardsPageProps {
  boards: Board[];
  loaded: boolean;
  pubkey: string;
}

export function BoardsPage({ boards, loaded, pubkey }: BoardsPageProps) {
  const [creating, setCreating] = useState(false);
  const newBoard = (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon />
      New board
    </Button>
  );

  let content = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {boards.map((board) => (
        <BoardCard board={board} key={board.id} />
      ))}
    </div>
  );
  if (boards.length === 0) {
    content = loaded ? (
      <Empty className="py-24">
        <EmptyTitle>No boards yet</EmptyTitle>
        {newBoard}
      </Empty>
    ) : (
      <div aria-busy className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl max-lg:hidden" />
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex h-9 items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Boards</h1>
        {boards.length > 0 && newBoard}
      </div>
      {content}
      <BoardDialog
        boards={boards}
        onOpenChange={setCreating}
        open={creating}
        pubkey={pubkey}
      />
    </main>
  );
}
