import { move } from "@dnd-kit/helpers";
import type {
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/react";
import { KeyboardSensor, PointerSensor } from "@dnd-kit/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { createDragTilt } from "@/features/board/drag-tilt";
import type { Card } from "@/lib/model";
import { rankBetween } from "@/lib/model";

/** Anything ordered by rank within a group: cards, CRM records. */
interface Ranked {
  id: string;
  rank: number;
}

export interface CardMove<K extends string, T extends Ranked = Card> {
  card: T;
  group: K;
  rank: number;
}

type Groups<K extends string, T> = Record<K, T[]>;

// Enter follows the card link, so only Space picks a card up.
export const SENSORS = [
  PointerSensor,
  KeyboardSensor.configure({
    keyboardCodes: {
      ...KeyboardSensor.defaults.keyboardCodes,
      start: ["Space"],
    },
  }),
];

/** Which items share an order, and which groups an item may go into. */
export interface DragRules<K extends string, T extends Ranked> {
  /** Whether two items are ranked against each other; by default all of a group's are. */
  peers?: (a: T, b: T) => boolean;
  /** Whether the item may be dropped in the group; by default in any. */
  accepts?: (item: T, group: K) => boolean;
}

function everyone(): boolean {
  return true;
}

function rerank<K extends string, T extends Ranked>(
  cards: T[],
  index: number,
  group: K,
  peers: (a: T, b: T) => boolean
): CardMove<K, T>[] {
  const card = cards[index];
  if (!card) {
    return [];
  }
  // Placed between its peers only, so the others keep their own order.
  const ranked = cards.filter((item) => item === card || peers(item, card));
  const at = ranked.indexOf(card);
  const before = ranked[at - 1]?.rank;
  const after = ranked[at + 1]?.rank;
  const rank = rankBetween(before, after);
  if (
    (before === undefined || before < rank) &&
    (after === undefined || rank < after)
  ) {
    return [{ card, group, rank }];
  }
  // Tied or exhausted ranks leave no room in between, so space the group out again.
  return ranked.flatMap((item, position) =>
    item === card || item.rank !== position + 1
      ? [{ card: item, group, rank: position + 1 }]
      : []
  );
}

/** The group an item is in, and where in it. */
function locate<K extends string, T extends Ranked>(
  groups: Groups<K, T>,
  id: unknown
): { group: K; index: number } | undefined {
  for (const group of Object.keys(groups) as K[]) {
    const index = groups[group].findIndex((card) => card.id === id);
    if (index !== -1) {
      return { group, index };
    }
  }
  return undefined;
}

/**
 * Keeps a local copy of the groups while dragging and reports the new ranks on
 * drop. A card dragged by pointer tilts with its movement.
 */
export function useCardDrag<K extends string, T extends Ranked = Card>(
  groups: Groups<K, T>,
  onMove: (moves: CardMove<K, T>[]) => void,
  { peers = everyone, accepts }: DragRules<K, T> = {}
) {
  const [dragGroups, setDragGroups] = useState<Groups<K, T> | null>(null);
  const latest = useRef<Groups<K, T> | null>(null);
  const tilt = useMemo(() => createDragTilt(), []);

  useEffect(() => tilt.stop, [tilt]);

  const update = (next: Groups<K, T> | null) => {
    latest.current = next;
    setDragGroups(next);
  };

  const start = (event: DragStartEvent) => {
    update(groups);
    const { activatorEvent, position, source } = event.operation;
    if (!(activatorEvent instanceof KeyboardEvent)) {
      tilt.start(source?.element, position.current);
    }
  };

  const drop = (event: DragEndEvent) => {
    tilt.stop();
    const final = latest.current;
    update(null);
    const id = event.operation.source?.id;
    if (event.canceled || !final || id === undefined) {
      return;
    }
    const place = locate(final, id);
    if (place && groups[place.group][place.index]?.id !== id) {
      onMove(rerank(final[place.group], place.index, place.group, peers));
    }
  };

  const over = (event: DragOverEvent) => {
    const next = move(latest.current ?? groups, event);
    const place = locate(next, event.operation.source?.id);
    const item = place && next[place.group][place.index];
    // Over a group it can't go to, it shows back where it started, so letting
    // go there changes nothing. The sortable mustn't make room for it either.
    if (accepts && item && !accepts(item, place.group)) {
      event.preventDefault();
      update(groups);
      return;
    }
    update(next);
  };

  return {
    groups: dragGroups ?? groups,
    props: {
      onDragEnd: drop,
      onDragMove: ({ operation }: DragMoveEvent) =>
        tilt.move(operation.source?.element, operation.position.current),
      onDragOver: over,
      onDragStart: start,
      sensors: SENSORS,
    },
  };
}
