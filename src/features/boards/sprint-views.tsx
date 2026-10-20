import { DragDropProvider } from "@dnd-kit/react";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { BoardContext } from "@/features/board/board-context";
import { CardTile, SortableCardRow } from "@/features/board/card-tile";
import { Column, Columns } from "@/features/board/kanban";
import { Group, useFolded } from "@/features/board/list-view";
import { useCardDrag } from "@/features/board/use-card-drag";
import type { SprintCard } from "@/features/boards/sprint-cards";
import { byStatus, takes } from "@/features/boards/sprint-cards";
import { updateCard } from "@/lib/actions";
import type { Status } from "@/lib/model";
import { STATUSES, startingStatus } from "@/lib/model";

function sameBoard(a: SprintCard, b: SprintCard): boolean {
  return a.scope.board.address === b.scope.board.address;
}

/**
 * The cards in a group per status, kept in drag order while one moves. A card
 * goes only to statuses its board uses, and is ranked among its board's cards.
 */
function useSprintDrag(cards: SprintCard[]) {
  const columns = byStatus(cards);
  const drag = useCardDrag(
    columns,
    (moves) => {
      for (const { card: item, group, rank } of moves) {
        updateCard(item.scope.board, item.card, { rank, status: group });
      }
    },
    { accepts: takes, peers: sameBoard }
  );
  return { ...drag, columns };
}

interface SprintViewProps {
  cards: SprintCard[];
  /** Statuses a card can be added in, on one of the boards. */
  adds: ReadonlySet<Status>;
  onAdd: (status: Status) => void;
}

/**
 * Every board's sprint cards in a column per status the boards use. Any other
 * status shows only while cards are in it.
 */
export function SprintKanban({
  cards,
  statuses,
  adds,
  onAdd,
}: SprintViewProps & {
  /** The statuses the boards use. */
  statuses: ReadonlySet<Status>;
}) {
  const drag = useSprintDrag(cards);
  // Which columns show goes by the cards before the drag, so a column emptied
  // by it stays put until the drop.
  const shown = STATUSES.filter(
    ({ id }) => statuses.has(id) || drag.columns[id].length > 0
  );
  return (
    <DragDropProvider {...drag.props}>
      <Columns>
        {shown.map(({ id, label }) => (
          <Column
            count={drag.groups[id].length}
            key={id}
            label={label}
            onAdd={adds.has(id) ? () => onAdd(id) : undefined}
            status={id}
          >
            {drag.groups[id].map((item, index) => (
              <BoardContext key={item.id} value={item.scope}>
                <CardTile
                  card={item.card}
                  group={id}
                  id={item.id}
                  index={index}
                />
              </BoardContext>
            ))}
          </Column>
        ))}
      </Columns>
    </DragDropProvider>
  );
}

/** Every board's sprint cards in a row each, grouped by status. */
export function SprintList({
  cards,
  adds,
  onAdd,
  foldedKey,
}: SprintViewProps & {
  /** Where the folded statuses are remembered on this device. */
  foldedKey: string;
}) {
  const [folded, setOpen] = useFolded(foldedKey);
  const drag = useSprintDrag(cards);
  // Which groups show goes by the cards before the drag, so a group emptied
  // by it stays put until the drop.
  const shown = STATUSES.filter(({ id }) => drag.columns[id].length > 0);

  if (shown.length === 0) {
    return (
      <Empty>
        <EmptyTitle>No cards</EmptyTitle>
        {adds.size > 0 && (
          <Button onClick={() => onAdd(startingStatus([...adds]))}>
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
            count={drag.groups[id].length}
            key={id}
            label={label}
            onAdd={adds.has(id) ? () => onAdd(id) : undefined}
            onOpenChange={(open) => setOpen(id, open)}
            open={!folded.has(id)}
            status={id}
          >
            {drag.groups[id].map((item, index) => (
              <BoardContext key={item.id} value={item.scope}>
                <SortableCardRow
                  card={item.card}
                  group={id}
                  id={item.id}
                  index={index}
                />
              </BoardContext>
            ))}
          </Group>
        ))}
      </div>
    </DragDropProvider>
  );
}
