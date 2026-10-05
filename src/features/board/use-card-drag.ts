import { move } from "@dnd-kit/helpers";
import type { DragEndEvent, DragOverEvent } from "@dnd-kit/react";
import { KeyboardSensor, PointerSensor } from "@dnd-kit/react";
import { useRef, useState } from "react";

import type { Card } from "@/lib/model";
import { rankBetween } from "@/lib/model";

export interface CardMove<K extends string> {
  card: Card;
  group: K;
  rank: number;
}

type Groups<K extends string> = Record<K, Card[]>;

// Enter follows the card link, so only Space picks a card up.
const SENSORS = [
  PointerSensor,
  KeyboardSensor.configure({
    keyboardCodes: {
      ...KeyboardSensor.defaults.keyboardCodes,
      start: ["Space"],
    },
  }),
];

function rerank<K extends string>(
  cards: Card[],
  index: number,
  group: K
): CardMove<K>[] {
  const card = cards[index];
  if (!card) {
    return [];
  }
  const before = cards[index - 1]?.rank;
  const after = cards[index + 1]?.rank;
  const rank = rankBetween(before, after);
  if (
    (before === undefined || before < rank) &&
    (after === undefined || rank < after)
  ) {
    return [{ card, group, rank }];
  }
  // Tied or exhausted ranks leave no room in between, so space the group out again.
  return cards.flatMap((item, position) =>
    item === card || item.rank !== position + 1
      ? [{ card: item, group, rank: position + 1 }]
      : []
  );
}

/** Keeps a local copy of the groups while dragging and reports the new ranks on drop. */
export function useCardDrag<K extends string>(
  groups: Groups<K>,
  onMove: (moves: CardMove<K>[]) => void
) {
  const [dragGroups, setDragGroups] = useState<Groups<K> | null>(null);
  const latest = useRef<Groups<K> | null>(null);

  const update = (next: Groups<K> | null) => {
    latest.current = next;
    setDragGroups(next);
  };

  const drop = (event: DragEndEvent) => {
    const final = latest.current;
    update(null);
    const id = event.operation.source?.id;
    if (event.canceled || !final || id === undefined) {
      return;
    }
    for (const group of Object.keys(final) as K[]) {
      const index = final[group].findIndex((card) => card.id === id);
      if (index !== -1) {
        if (groups[group][index]?.id !== id) {
          onMove(rerank(final[group], index, group));
        }
        return;
      }
    }
  };

  return {
    groups: dragGroups ?? groups,
    props: {
      onDragEnd: drop,
      onDragOver: (event: DragOverEvent) =>
        update(move(latest.current ?? groups, event)),
      onDragStart: () => update(groups),
      sensors: SENSORS,
    },
  };
}
