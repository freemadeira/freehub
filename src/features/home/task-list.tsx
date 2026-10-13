import { startOfToday } from "date-fns";
import { AnimatePresence, motion } from "motion/react";

import type { BoardScope } from "@/features/board/board-context";
import { BoardContext } from "@/features/board/board-context";
import { Bucket } from "@/features/board/bucket";
import { CardRow } from "@/features/board/card-tile";
import { compareTasks, DUE_BUCKETS, dueBucket } from "@/features/home/tasks";
import type { MyCard } from "@/hooks/use-my-cards";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export function taskKey(item: MyCard): string {
  return `${item.board.address}/${item.card.id}`;
}

/** A card of the person's on Home, edited as on its board; done, it folds away. */
export function TaskRow({
  item,
  scopes,
}: {
  item: MyCard;
  scopes: Map<string, BoardScope>;
}) {
  return (
    // Clipped only while folding, so the card's shadow shows the rest of the time.
    <motion.li
      animate={{
        height: "auto",
        opacity: 1,
        transitionEnd: { overflow: "visible" },
      }}
      exit={{ height: 0, opacity: 0, overflow: "hidden" }}
      initial={{ height: 0, opacity: 0, overflow: "hidden" }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
    >
      <div className="pb-1">
        <BoardContext value={scopes.get(item.board.address) ?? null}>
          <CardRow card={item.card} unsetDue />
        </BoardContext>
      </div>
    </motion.li>
  );
}

/** The cards by when they're due: overdue first, those without a date last. */
export function TaskList({
  tasks,
  scopes,
}: {
  tasks: MyCard[];
  scopes: Map<string, BoardScope>;
}) {
  const today = startOfToday();
  const groups = DUE_BUCKETS.map((bucket) => ({
    ...bucket,
    tasks: tasks
      .filter((item) => dueBucket(item.card.due, today) === bucket.id)
      .toSorted(compareTasks),
  })).filter((group) => group.tasks.length > 0);
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <Bucket count={group.tasks.length} key={group.id} title={group.label}>
          <ul className="-mb-1 flex flex-col">
            <AnimatePresence initial={false}>
              {group.tasks.map((item) => (
                <TaskRow item={item} key={taskKey(item)} scopes={scopes} />
              ))}
            </AnimatePresence>
          </ul>
        </Bucket>
      ))}
    </div>
  );
}
