import { ChevronRightIcon, SquareKanbanIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { BacklogView } from "@/features/board/backlog-view";
import type { BoardScope } from "@/features/board/board-context";
import { BoardContext } from "@/features/board/board-context";
import { backlogGroups } from "@/features/board/card-order";
import { readStorage, writeStorage } from "@/lib/utils";

function readFolded(key: string): Set<string> {
  try {
    const value: unknown = JSON.parse(readStorage(key) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : []
    );
  } catch {
    return new Set();
  }
}

/** The boards folded away, by address, remembered on this device. */
function useFoldedBoards(
  key: string
): [ReadonlySet<string>, (address: string, open: boolean) => void] {
  const [folded, setFolded] = useState(() => readFolded(key));
  const change = (address: string, open: boolean) => {
    const next = new Set(folded);
    if (open) {
      next.delete(address);
    } else {
      next.add(address);
    }
    setFolded(next);
    writeStorage(key, next.size > 0 ? JSON.stringify([...next]) : null);
  };
  return [folded, change];
}

function BoardBacklog({
  scope,
  open,
  onOpenChange,
}: {
  scope: BoardScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { board, content, cards } = scope;
  const { backlog, planned } = backlogGroups(content, cards);
  const count = [...planned.values()].reduce(
    (sum, group) => sum + group.length,
    backlog.length
  );
  return (
    <Collapsible onOpenChange={onOpenChange} open={open}>
      <h2 className="flex min-w-0">
        {/* Heavier than the sprints under it, which are the board's own. */}
        <CollapsibleTrigger className="focus-visible:ring-ring/50 flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 font-semibold outline-none focus-visible:ring-3 [&>svg:first-child]:transition-transform [&>svg:first-child]:duration-200 [&>svg:first-child]:ease-out data-panel-open:[&>svg:first-child]:rotate-90">
          <ChevronRightIcon
            aria-hidden
            className="text-muted-foreground size-4 shrink-0"
          />
          <SquareKanbanIcon
            aria-hidden
            className="text-muted-foreground size-4 shrink-0"
          />
          <span className="truncate">{board.title}</span>
          <span className="text-muted-foreground text-sm font-normal tabular-nums">
            {count}
          </span>
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent>
        <div className="pt-2">
          <BoardContext value={scope}>
            <BacklogView
              onSprintStarted={() =>
                toast.success(`Sprint started on ${board.title}`)
              }
            />
          </BoardContext>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface BoardsBacklogProps {
  /** The boards in view, each with the cards to plan. */
  scopes: BoardScope[];
  /** Where the folded boards are remembered on this device. */
  foldedKey: string;
}

/**
 * Every board's upcoming sprints and backlog, a board at a time, to plan
 * them all in one sitting. Cards move between a board's own sprints only.
 */
export function BoardsBacklog({ scopes, foldedKey }: BoardsBacklogProps) {
  const [folded, setOpen] = useFoldedBoards(foldedKey);
  if (scopes.length === 0) {
    return (
      <Empty>
        <EmptyTitle>No boards</EmptyTitle>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {scopes.map((scope) => (
        <section aria-label={scope.board.title} key={scope.board.address}>
          <BoardBacklog
            onOpenChange={(open) => setOpen(scope.board.address, open)}
            open={!folded.has(scope.board.address)}
            scope={scope}
          />
        </section>
      ))}
    </div>
  );
}
