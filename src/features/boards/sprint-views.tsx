import { CollisionPriority } from "@dnd-kit/abstract";
import { DragDropProvider, useDroppable } from "@dnd-kit/react";
import { cn } from "cn";
import {
  ChevronRightIcon,
  PlusIcon,
  SquareKanbanIcon,
  UserRoundIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { UserAvatar } from "@/components/user-avatar";
import { BoardContext } from "@/features/board/board-context";
import { CardTile, SortableCardRow } from "@/features/board/card-tile";
import { Column, Columns } from "@/features/board/kanban";
import { Group, useFolded } from "@/features/board/list-view";
import { useCardDrag } from "@/features/board/use-card-drag";
import type { Lane, SprintCard } from "@/features/boards/sprint-cards";
import { byStatus, takes } from "@/features/boards/sprint-cards";
import { STATUS_STYLES } from "@/features/card/card-fields";
import { useProfile } from "@/hooks/use-profile";
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

function Person({ pubkey }: { pubkey: string }) {
  const { name } = useProfile(pubkey);
  return (
    <>
      <UserAvatar pubkey={pubkey} size="xs" />
      <span className="truncate">{name}</span>
    </>
  );
}

/** Whose or which board's cards a row holds, and how many. */
function LaneTitle({ lane }: { lane: Lane }) {
  let title: ReactNode;
  if (lane.kind === "board") {
    title = (
      <>
        <SquareKanbanIcon
          aria-hidden
          className="text-muted-foreground size-4 shrink-0"
        />
        <span className="truncate">{lane.scope.board.title}</span>
      </>
    );
  } else if (lane.pubkey) {
    title = <Person pubkey={lane.pubkey} />;
  } else {
    title = (
      <>
        <UserRoundIcon
          aria-hidden
          className="text-muted-foreground size-4 shrink-0"
        />
        <span className="truncate">Unassigned</span>
      </>
    );
  }
  return (
    <>
      {title}
      <span className="text-muted-foreground tabular-nums">
        {lane.cards.length}
      </span>
    </>
  );
}

/** One status's cards in a row: a drop target that grows with them. */
function LaneCell({
  status,
  children,
}: {
  status: Status;
  children: ReactNode;
}) {
  const { ref } = useDroppable({
    accept: "card",
    collisionPriority: CollisionPriority.Low,
    id: status,
    type: "column",
  });
  return (
    <div
      className="bg-muted/60 flex min-h-16 flex-col gap-2 rounded-2xl p-2"
      ref={ref}
    >
      {children}
    </div>
  );
}

/**
 * A row's cards under each column. Cards move between statuses within the
 * row only: each row drags on its own.
 */
function KanbanLane({
  lane,
  shown,
}: {
  lane: Lane;
  /** The columns, in order. */
  shown: (typeof STATUSES)[number][];
}) {
  const [open, setOpen] = useState(true);
  const drag = useSprintDrag(lane.cards);
  return (
    <section className="col-span-full grid grid-cols-subgrid gap-y-2">
      <h3 className="col-span-full pt-4">
        {/* Stays in sight while the columns scroll sideways. */}
        <button
          aria-expanded={open}
          className="focus-visible:ring-ring/50 sticky left-4 flex w-fit max-w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-sm font-medium outline-none focus-visible:ring-3 sm:left-6 [&>svg:first-child]:transition-transform [&>svg:first-child]:duration-200 [&>svg:first-child]:ease-out aria-expanded:[&>svg:first-child]:rotate-90"
          onClick={() => setOpen(!open)}
          type="button"
        >
          <ChevronRightIcon
            aria-hidden
            className="text-muted-foreground size-3.5 shrink-0"
          />
          <LaneTitle lane={lane} />
        </button>
      </h3>
      {open && (
        <DragDropProvider {...drag.props}>
          {shown.map(({ id }) => (
            <LaneCell key={id} status={id}>
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
            </LaneCell>
          ))}
        </DragDropProvider>
      )}
    </section>
  );
}

/**
 * Every board's sprint cards in a row per board or person, under one set of
 * columns. The rows scroll together, both ways, under the column headers.
 */
export function SprintLaneKanban({
  cards,
  lanes,
  statuses,
  adds,
  onAdd,
}: SprintViewProps & {
  lanes: Lane[];
  /** The statuses the boards use. */
  statuses: ReadonlySet<Status>;
}) {
  const columns = byStatus(cards);
  const shown = STATUSES.filter(
    ({ id }) => statuses.has(id) || columns[id].length > 0
  );
  const grid: CSSProperties = {
    gridTemplateColumns: `repeat(${shown.length}, minmax(17rem, 1fr))`,
  };
  return (
    <div className="-mx-4 min-h-0 grow overflow-auto overscroll-contain px-4 pb-1 sm:-mx-6 sm:px-6">
      <div className="grid min-w-fit gap-x-3" style={grid}>
        {shown.map(({ id, label }) => {
          const { icon: Icon, className } = STATUS_STYLES[id];
          return (
            <div
              className="bg-background sticky top-0 z-10 flex h-10 items-center gap-2 px-3.5 text-sm font-medium"
              key={id}
            >
              <Icon aria-hidden className={cn("size-4 shrink-0", className)} />
              {label}
              <span className="text-muted-foreground tabular-nums">
                {columns[id].length}
              </span>
              {adds.has(id) && (
                <IconButton
                  className="text-muted-foreground ml-auto"
                  label={`Add card to ${label}`}
                  onClick={() => onAdd(id)}
                >
                  <PlusIcon />
                </IconButton>
              )}
            </div>
          );
        })}
        {lanes.map((lane) => (
          <KanbanLane key={lane.key} lane={lane} shown={shown} />
        ))}
      </div>
    </div>
  );
}

/** The cards in a group per status, each folded or not as given. */
function StatusGroups({
  cards,
  adds,
  onAdd,
  folded,
  onOpenChange,
}: SprintViewProps & {
  folded: ReadonlySet<Status>;
  onOpenChange: (status: Status, open: boolean) => void;
}) {
  const drag = useSprintDrag(cards);
  // Which groups show goes by the cards before the drag, so a group emptied
  // by it stays put until the drop.
  const shown = STATUSES.filter(({ id }) => drag.columns[id].length > 0);
  return (
    <DragDropProvider {...drag.props}>
      <div className="flex flex-col gap-3">
        {shown.map(({ id, label }) => (
          <Group
            count={drag.groups[id].length}
            key={id}
            label={label}
            onAdd={adds.has(id) ? () => onAdd(id) : undefined}
            onOpenChange={(open) => onOpenChange(id, open)}
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

function NoCards({ adds, onAdd }: Pick<SprintViewProps, "adds" | "onAdd">) {
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

interface SprintListProps extends SprintViewProps {
  /** Where the folded statuses are remembered on this device. */
  foldedKey: string;
}

/** Every board's sprint cards in a row each, grouped by status. */
export function SprintList({ cards, adds, onAdd, foldedKey }: SprintListProps) {
  const [folded, setOpen] = useFolded(foldedKey);
  if (cards.length === 0) {
    return <NoCards adds={adds} onAdd={onAdd} />;
  }
  return (
    <StatusGroups
      adds={adds}
      cards={cards}
      folded={folded}
      onAdd={onAdd}
      onOpenChange={setOpen}
    />
  );
}

/**
 * Every board's sprint cards in a section per board or person, grouped by
 * status in each. A status folded in one section folds in all of them.
 */
export function SprintLaneList({
  lanes,
  adds,
  onAdd,
  foldedKey,
}: Omit<SprintListProps, "cards"> & { lanes: Lane[] }) {
  const [folded, setOpen] = useFolded(foldedKey);
  return (
    <div className="flex flex-col gap-6">
      {lanes.map((lane) => (
        <section className="flex flex-col gap-2" key={lane.key}>
          <h3 className="flex min-w-0 items-center gap-2 px-1.5 text-sm font-medium">
            <LaneTitle lane={lane} />
          </h3>
          <StatusGroups
            adds={adds}
            cards={lane.cards}
            folded={folded}
            onAdd={onAdd}
            onOpenChange={setOpen}
          />
        </section>
      ))}
    </div>
  );
}
