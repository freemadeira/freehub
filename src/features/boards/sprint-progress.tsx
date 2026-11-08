import { cn } from "cn";
import { Link } from "wouter";

import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import type { BoardScope } from "@/features/board/board-context";
import { boardPath } from "@/features/board/board-context";
import {
  daysLeft,
  remainingLabel,
  sprintDates,
} from "@/features/board/sprint-view";
import { STATUS_STYLES } from "@/features/card/card-fields";
import type { Board } from "@/lib/model";
import { activeSprint, isClosed } from "@/lib/model";

const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** How much of the sprint is closed, as a ring that fills clockwise. */
function ProgressRing({ share }: { share: number }) {
  return (
    <svg
      aria-hidden
      className={cn(
        "size-3.5 shrink-0 -rotate-90",
        STATUS_STYLES.done.className
      )}
      viewBox="0 0 14 14"
    >
      <circle
        className="stroke-current opacity-25"
        cx="7"
        cy="7"
        fill="none"
        r={RADIUS}
        strokeWidth="2"
      />
      {share > 0 && (
        <circle
          className="stroke-current"
          cx="7"
          cy="7"
          fill="none"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - share)}
          strokeLinecap="round"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

function BoardProgress({
  scope,
  boards,
}: {
  scope: BoardScope;
  boards: Board[];
}) {
  const { board, content } = scope;
  const sprint = activeSprint(content);
  if (!sprint) {
    return null;
  }
  // The whole sprint, whoever's cards are on screen.
  const cards = content.cards.filter((card) => card.sprint === sprint.id);
  const closed = cards.filter((card) => isClosed(card.status)).length;
  const days = daysLeft(sprint);
  const remaining = days === undefined ? undefined : remainingLabel(days);
  const label = [board.code, `${closed} of ${cards.length} closed`, remaining]
    .filter(Boolean)
    .join(", ");
  return (
    <li>
      <FluidTooltip.Root>
        <FluidTooltip.Trigger>
          <Link
            aria-label={label}
            className="hover:text-foreground focus-visible:ring-ring/50 -mx-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors duration-150 outline-none focus-visible:ring-3"
            href={boardPath(board, boards)}
          >
            <ProgressRing
              share={cards.length > 0 ? closed / cards.length : 0}
            />
            <span className="text-foreground/80 font-medium">{board.code}</span>
            <span className="tabular-nums">
              {closed}/{cards.length}
            </span>
            {remaining && (
              <span
                className={cn(
                  "tabular-nums",
                  days !== undefined && days < 0 && "text-destructive"
                )}
              >
                · {remaining}
              </span>
            )}
          </Link>
        </FluidTooltip.Trigger>
        <FluidTooltip.Content>
          {[board.title, sprint.title, sprintDates(sprint)]
            .filter(Boolean)
            .join(" · ")}
        </FluidTooltip.Content>
      </FluidTooltip.Root>
    </li>
  );
}

interface SprintProgressProps {
  /** The boards in view; those without an active sprint are left out. */
  scopes: BoardScope[];
  /** Every board, to tell apart boards sharing a code in their links. */
  boards: Board[];
}

/**
 * Each board's sprint at a glance: how much of it is closed and how long it
 * has left, linking to the board.
 */
export function SprintProgress({ scopes, boards }: SprintProgressProps) {
  return (
    <FluidTooltip.Group>
      <ul
        aria-label="Sprint progress"
        className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs"
      >
        {scopes.map((scope) => (
          <BoardProgress
            boards={boards}
            key={scope.board.address}
            scope={scope}
          />
        ))}
      </ul>
    </FluidTooltip.Group>
  );
}
