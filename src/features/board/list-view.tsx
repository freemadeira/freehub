import { CollisionPriority } from "@dnd-kit/abstract";
import { DragDropProvider, useDroppable } from "@dnd-kit/react";
import { cn } from "cn";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { useBoard } from "@/features/board/board-context";
import { SortableCardRow } from "@/features/board/card-tile";
import { useStatusDrag } from "@/features/board/kanban";
import { STATUS_STYLES } from "@/features/card/card-fields";
import type { Board, Card, Sprint, Status } from "@/lib/model";
import { isClosed, STATUSES } from "@/lib/model";
import { readStorage, writeStorage } from "@/lib/utils";

function foldedKey(board: Pick<Board, "address">): string {
  return `board:${board.address}:folded`;
}

/** The statuses folded away in the list, remembered on this device. */
function useFolded(
  board: Pick<Board, "address">
): [Set<Status>, (status: Status, open: boolean) => void] {
  const [folded, setFolded] = useState(() => {
    const stored = readStorage(foldedKey(board))?.split(",") ?? [];
    return new Set(
      STATUSES.flatMap(({ id }) => (stored.includes(id) ? [id] : []))
    );
  });
  const change = (status: Status, open: boolean) => {
    const next = new Set(folded);
    if (open) {
      next.delete(status);
    } else {
      next.add(status);
    }
    setFolded(next);
    writeStorage(foldedKey(board), next.size > 0 ? [...next].join(",") : null);
  };
  return [folded, change];
}

interface GroupProps {
  status: Status;
  label: string;
  cards: Card[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd?: () => void;
}

/** A status's cards, under a header that stays in sight while they scroll by. */
function Group({
  status,
  label,
  cards,
  open,
  onOpenChange,
  onAdd,
}: GroupProps) {
  // A folded group takes no drops: the card would vanish into it mid-drag.
  const { ref } = useDroppable({
    accept: "card",
    collisionPriority: CollisionPriority.Low,
    disabled: !open,
    id: status,
    type: "group",
  });
  const { icon: Icon, className } = STATUS_STYLES[status];
  return (
    <section className="bg-muted/60 rounded-2xl p-1.5" ref={ref}>
      <Collapsible onOpenChange={onOpenChange} open={open}>
        {/* Opaque in the tray's own colour, so cards pass under it unseen. */}
        <div className="sticky top-14 z-10 flex h-9 items-center gap-1 rounded-lg bg-[color-mix(in_srgb,var(--muted)_60%,var(--background))]">
          <h3 className="flex h-full min-w-0 flex-1">
            <CollapsibleTrigger className="focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-2 rounded-lg pl-1.5 text-sm font-medium outline-none focus-visible:ring-3 [&>svg:first-child]:transition-transform [&>svg:first-child]:duration-200 [&>svg:first-child]:ease-out data-panel-open:[&>svg:first-child]:rotate-90">
              <ChevronRightIcon
                aria-hidden
                className="text-muted-foreground size-3.5 shrink-0"
              />
              <Icon aria-hidden className={cn("size-4 shrink-0", className)} />
              <span className="truncate">{label}</span>
              <span className="text-muted-foreground tabular-nums">
                {cards.length}
              </span>
            </CollapsibleTrigger>
          </h3>
          {onAdd && (
            <IconButton
              className="text-muted-foreground"
              label={`Add card to ${label}`}
              onClick={onAdd}
            >
              <PlusIcon />
            </IconButton>
          )}
        </div>
        {/* Reaches into the tray's padding so the cards' edges aren't clipped. */}
        <CollapsibleContent className="-mx-1.5 -mb-1.5">
          <div className="flex flex-col gap-1 px-1.5 pt-1 pb-1.5">
            {cards.map((card, index) => (
              <SortableCardRow
                card={card}
                group={status}
                index={index}
                key={card.id}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

interface CardListProps {
  cards: Card[];
  /** The sprint the cards are in, which new cards join. */
  sprint: Sprint;
}

/** Cards in a row each, grouped by status; statuses without cards stay out. */
export function CardList({ cards, sprint }: CardListProps) {
  const { board, canEdit, newCard } = useBoard();
  const [folded, setOpen] = useFolded(board);
  const drag = useStatusDrag(cards);
  // Which groups show goes by the cards before the drag, so a group emptied
  // by it stays put until the drop.
  const shown = STATUSES.filter(({ id }) => drag.columns[id].length > 0);

  if (shown.length === 0) {
    return (
      <Empty>
        <EmptyTitle>No cards</EmptyTitle>
        {canEdit && (
          <Button
            onClick={() => newCard({ sprint: sprint.id, status: "todo" })}
          >
            <PlusIcon />
            Add card
          </Button>
        )}
      </Empty>
    );
  }

  return (
    <DragDropProvider {...drag.props}>
      <div className="flex flex-col gap-3">
        {shown.map(({ id, label }) => (
          <Group
            cards={drag.groups[id]}
            key={id}
            label={label}
            onAdd={
              canEdit && !isClosed(id)
                ? () => newCard({ sprint: sprint.id, status: id })
                : undefined
            }
            onOpenChange={(open) => setOpen(id, open)}
            open={!folded.has(id)}
            status={id}
          />
        ))}
      </div>
    </DragDropProvider>
  );
}
