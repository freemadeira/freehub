import { Link } from "wouter";

import { ConnectionStatus } from "@/components/connection-status";
import { Logo } from "@/components/logo";
import { UserMenu } from "@/components/user-menu";
import type { Board } from "@/lib/model";

export function Header({ board, pubkey }: { board?: Board; pubkey: string }) {
  return (
    <header className="bg-background/85 sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 px-4 backdrop-blur-md sm:px-6">
      <Link
        aria-label="All boards"
        className="focus-visible:ring-ring/50 -mx-1.5 flex shrink-0 items-center rounded-lg px-1.5 py-1 outline-none focus-visible:ring-3"
        href="/"
      >
        <Logo className="h-7" />
      </Link>
      {board && (
        <>
          <span
            aria-hidden
            className="bg-foreground/15 h-5 w-px shrink-0 rotate-12"
          />
          <h1 className="min-w-0 truncate font-medium">{board.title}</h1>
        </>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ConnectionStatus />
        <UserMenu pubkey={pubkey} />
      </div>
    </header>
  );
}
