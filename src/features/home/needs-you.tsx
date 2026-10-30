import { startOfToday } from "date-fns";
import { AnimatePresence } from "motion/react";
import { use } from "react";

import { Section } from "@/components/page-section";
import { boardScopes } from "@/features/home/board-scopes";
import { needsYou, newlyAssigned, reasonLabel } from "@/features/home/pressing";
import { TaskRow } from "@/features/home/task-list";
import { taskKey } from "@/features/home/tasks";
import { InboxContext } from "@/features/inbox/inbox-context";
import { useMyCards } from "@/hooks/use-my-cards";
import type { Board } from "@/lib/model";
import { holdUps, relationsOf } from "@/lib/relations";

/** The person's few most pressing cards, each with why; nothing when none are. */
export function NeedsYou({
  boards,
  pubkey,
}: {
  boards: Board[];
  pubkey: string;
}) {
  const mine = useMyCards(boards, pubkey);
  const inbox = use(InboxContext);
  const today = startOfToday();
  const pressing = needsYou(mine.cards, {
    assigned: newlyAssigned(inbox?.groups ?? [], pubkey),
    blocking: (item) =>
      holdUps(item.card, relationsOf(item.content, item, mine.findCard))
        .blocking.length,
    today,
  });
  if (pressing.length === 0) {
    return null;
  }
  const scopes = boardScopes(mine.cards, boards, pubkey, mine.findCard);
  return (
    <Section title="Needs you">
      <ul aria-label="Needs you" className="-mb-1 flex flex-col">
        <AnimatePresence initial={false}>
          {pressing.map(({ item, reason }) => (
            <TaskRow item={item} key={taskKey(item)} scopes={scopes}>
              {/* Phones keep the room for the title. */}
              <span className="text-muted-foreground shrink-0 text-xs max-sm:hidden">
                {reasonLabel(reason, today)}
              </span>
            </TaskRow>
          ))}
        </AnimatePresence>
      </ul>
    </Section>
  );
}
