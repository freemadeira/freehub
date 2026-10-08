import { CollisionPriority } from "@dnd-kit/abstract";
import { DragDropProvider, useDroppable } from "@dnd-kit/react";
import { cn } from "cn";

import { useBoard } from "@/features/board/board-context";
import { CardTile } from "@/features/board/card-tile";
import { AddButton } from "@/features/board/quick-add";
import { useCardDrag } from "@/features/board/use-card-drag";
import { STATUS_STYLES } from "@/features/card/card-fields";
import { updateCard } from "@/lib/actions";
import type { Card, Sprint, Status } from "@/lib/model";
import { isClosed, STATUSES } from "@/lib/model";

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
  const { icon: Icon, className } = STATUS_STYLES[status];
  return (
    <section
      className="bg-muted/60 flex min-h-0 flex-col rounded-2xl"
      ref={ref}
    >
      <h3 className="flex h-10 shrink-0 items-center gap-2 px-3.5 pt-2 text-sm font-medium">
        <Icon aria-hidden className={cn("size-4 shrink-0", className)} />
        {label}
        <span className="text-muted-foreground tabular-nums">
          {cards.length}
        </span>
      </h3>
      {/* Scrolls on its own under the header, so the page stays put. */}
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain p-2">
        {cards.map((card, index) => (
          <CardTile card={card} group={status} index={index} key={card.id} />
        ))}
        {onAdd && <AddButton label="Add card" onClick={onAdd} />}
      </div>
    </section>
  );
}

/**
 * The cards in a group per status, kept in drag order while one moves; a card
 * dropped in another group takes its status.
 */
export function useStatusDrag(cards: Card[]) {
  const { board } = useBoard();
  const columns = Object.fromEntries(
    STATUSES.map(({ id }): [Status, Card[]] => [id, []])
  ) as Record<Status, Card[]>;
  for (const card of cards) {
    columns[card.status].push(card);
  }
  const drag = useCardDrag(columns, (moves) => {
    for (const { card, group, rank } of moves) {
      updateCard(board, card, { rank, status: group });
    }
  });
  return { ...drag, columns };
}

interface KanbanProps {
  cards: Card[];
  /** The sprint the cards are in, which new cards join. */
  sprint: Sprint;
}

/** Cards in a column per status. */
export function Kanban({ cards, sprint }: KanbanProps) {
  const { canEdit, newCard } = useBoard();
  const drag = useStatusDrag(cards);

  return (
    <DragDropProvider {...drag.props}>
      <div className="-mx-4 grid min-h-0 grow auto-cols-[minmax(17rem,1fr)] grid-flow-col grid-rows-1 gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
        {STATUSES.map(({ id, label }) => (
          <Column
            cards={drag.groups[id]}
            key={id}
            label={label}
            onAdd={
              canEdit && !isClosed(id)
                ? () => newCard({ sprint: sprint.id, status: id })
                : undefined
            }
            status={id}
          />
        ))}
      </div>
    </DragDropProvider>
  );
}
