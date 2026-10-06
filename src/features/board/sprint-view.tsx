import { CollisionPriority } from "@dnd-kit/abstract";
import { DragDropProvider, useDroppable } from "@dnd-kit/react";
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
import { CardTile } from "@/features/board/card-tile";
import { AddButton } from "@/features/board/quick-add";
import { SprintDialog } from "@/features/board/sprint-dialog";
import { useCardDrag } from "@/features/board/use-card-drag";
import { endSprint, startSprint, updateCard } from "@/lib/actions";
import type { BoardContent, Card, Sprint, Status } from "@/lib/model";
import { activeSprint, STATUSES, upcomingSprint } from "@/lib/model";
import { plural } from "@/lib/utils";

function upcomingTitle(content: BoardContent): string {
  return upcomingSprint(content)?.title ?? `Sprint ${content.nextSprintNumber}`;
}

function sprintDates(sprint: Sprint): string | undefined {
  if (!(sprint.start && sprint.end)) {
    return undefined;
  }
  const end = parseISO(sprint.end);
  const days = differenceInCalendarDays(end, new Date());
  let remaining = "Last day";
  if (days > 0) {
    remaining = `${plural(days, "day")} left`;
  } else if (days < 0) {
    remaining = `${plural(-days, "day")} over`;
  }
  return `${format(parseISO(sprint.start), "MMM d")} – ${format(end, "MMM d")} · ${remaining}`;
}

function EndSprint({ sprint }: { sprint: Sprint }) {
  const { board, content } = useBoard();
  const unfinished = content.cards.filter(
    (card) => card.sprint === sprint.id && card.status !== "done"
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
              ? "All cards are done."
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
      <IconButton
        className="text-muted-foreground -ml-1.5"
        label="Edit sprint"
        onClick={() => setEditing(true)}
      >
        <PencilIcon />
      </IconButton>
      <EndSprint sprint={sprint} />
      <SprintDialog onOpenChange={setEditing} open={editing} sprint={sprint} />
    </div>
  );
}

interface ColumnProps {
  status: Status;
  label: string;
  cards: Card[];
  onAdd?: () => void;
}

function Column({ status, label, cards, onAdd }: ColumnProps) {
  const { ref } = useDroppable({
    accept: "card",
    collisionPriority: CollisionPriority.Low,
    id: status,
    type: "column",
  });
  return (
    <section
      className="bg-muted/60 flex flex-col gap-2 rounded-2xl p-2"
      ref={ref}
    >
      <h3 className="flex h-8 items-center gap-2 px-1.5 text-sm font-medium">
        {label}
        <span className="text-muted-foreground tabular-nums">
          {cards.length}
        </span>
      </h3>
      {cards.map((card, index) => (
        <CardTile card={card} group={status} index={index} key={card.id} />
      ))}
      {onAdd && <AddButton label="Add card" onClick={onAdd} />}
    </section>
  );
}

function Kanban({ sprint }: { sprint: Sprint }) {
  const { board, cards, newCard } = useBoard();
  const columns: Record<Status, Card[]> = { done: [], progress: [], todo: [] };
  for (const card of cards) {
    if (card.sprint === sprint.id) {
      columns[card.status].push(card);
    }
  }
  const drag = useCardDrag(columns, (moves) => {
    for (const { card, group, rank } of moves) {
      updateCard(board, card, { rank, status: group });
    }
  });

  return (
    <DragDropProvider {...drag.props}>
      <div className="-mx-4 grid grow auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
        {STATUSES.map(({ id, label }) => (
          <Column
            cards={drag.groups[id]}
            key={id}
            label={label}
            onAdd={
              id === "done"
                ? undefined
                : () => newCard({ sprint: sprint.id, status: id })
            }
            status={id}
          />
        ))}
      </div>
    </DragDropProvider>
  );
}

function NoActiveSprint() {
  const { board, content } = useBoard();
  return (
    <Empty>
      <EmptyTitle>No active sprint</EmptyTitle>
      <Button
        onClick={() => startSprint(board, upcomingSprint(content), content)}
      >
        Start {upcomingTitle(content)}
      </Button>
    </Empty>
  );
}

export function SprintView() {
  const { content } = useBoard();
  const sprint = activeSprint(content);
  if (!sprint) {
    return <NoActiveSprint />;
  }
  return (
    <div className="flex grow flex-col gap-4">
      <SprintHeader sprint={sprint} />
      <Kanban sprint={sprint} />
    </div>
  );
}
