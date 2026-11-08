import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { PencilIcon } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/icon-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { useBoard } from "@/features/board/board-context";
import { Kanban } from "@/features/board/kanban";
import { CardList } from "@/features/board/list-view";
import { SprintDialog } from "@/features/board/sprint-dialog";
import { endSprint, startSprint } from "@/lib/actions";
import type { BoardContent, Sprint } from "@/lib/model";
import { activeSprint, isClosed, upcomingSprint } from "@/lib/model";
import { plural } from "@/lib/utils";

/** What the next sprint is called: the upcoming one's title, or a new one's. */
export function upcomingTitle(content: BoardContent): string {
  return upcomingSprint(content)?.title ?? `Sprint ${content.nextSprintNumber}`;
}

/** Days to the sprint's last day: none on it, fewer than none once it ran over. */
export function daysLeft(sprint: Sprint): number | undefined {
  return sprint.end === undefined
    ? undefined
    : differenceInCalendarDays(parseISO(sprint.end), new Date());
}

/** "5 days left", "Last day", or "2 days over". */
export function remainingLabel(days: number): string {
  if (days > 0) {
    return `${plural(days, "day")} left`;
  }
  return days < 0 ? `${plural(-days, "day")} over` : "Last day";
}

/** When the sprint runs and how long it has left, like "Nov 1 – Nov 15 · 5 days left". */
export function sprintDates(sprint: Sprint): string | undefined {
  const days = daysLeft(sprint);
  if (!(sprint.start && sprint.end) || days === undefined) {
    return undefined;
  }
  return `${format(parseISO(sprint.start), "MMM d")} – ${format(parseISO(sprint.end), "MMM d")} · ${remainingLabel(days)}`;
}

function EndSprint({ sprint }: { sprint: Sprint }) {
  const { board, content } = useBoard();
  const unfinished = content.cards.filter(
    (card) => card.sprint === sprint.id && !isClosed(card.status)
  ).length;
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button className="ml-auto" size="sm" variant="outline" />}
      >
        End sprint
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>End {sprint.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            {unfinished === 0
              ? "No cards left open."
              : `${plural(unfinished, "unfinished card")} ${unfinished === 1 ? "moves" : "move"} to ${upcomingTitle(content)}.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => endSprint(board, sprint, content)}>
            End sprint
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SprintHeader({ sprint }: { sprint: Sprint }) {
  const { canEdit } = useBoard();
  const [editing, setEditing] = useState(false);
  const dates = sprintDates(sprint);
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-3">
        <h2 className="truncate font-semibold">{sprint.title}</h2>
        {dates && (
          <p className="text-muted-foreground text-sm tabular-nums">{dates}</p>
        )}
      </div>
      {canEdit && (
        <>
          <IconButton
            className="text-muted-foreground -ml-1.5"
            label="Edit sprint"
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </IconButton>
          <EndSprint sprint={sprint} />
          <SprintDialog
            onOpenChange={setEditing}
            open={editing}
            sprint={sprint}
          />
        </>
      )}
    </div>
  );
}

function NoActiveSprint() {
  const { board, canEdit, content } = useBoard();
  return (
    <Empty>
      <EmptyTitle>No active sprint</EmptyTitle>
      {canEdit && (
        <Button
          onClick={() => startSprint(board, upcomingSprint(content), content)}
        >
          Start {upcomingTitle(content)}
        </Button>
      )}
    </Empty>
  );
}

export function SprintView() {
  const { cards, content, layout } = useBoard();
  const sprint = activeSprint(content);
  if (!sprint) {
    return <NoActiveSprint />;
  }
  const sprintCards = cards.filter((card) => card.sprint === sprint.id);
  return (
    <div className="flex min-h-0 grow flex-col gap-4">
      <SprintHeader sprint={sprint} />
      {layout === "list" ? (
        <CardList cards={sprintCards} sprint={sprint} />
      ) : (
        <Kanban cards={sprintCards} sprint={sprint} />
      )}
    </div>
  );
}
