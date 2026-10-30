import { differenceInCalendarDays, format, parseISO } from "date-fns";

import { compareTasks, taskKey } from "@/features/home/tasks";
import type { InboxGroup } from "@/hooks/use-inbox";
import type { MyCard } from "@/hooks/use-my-cards";
import { activeSprint } from "@/lib/model";
import { plural } from "@/lib/utils";

/** Cards shown, the most pressing ones. */
const SHOWN = 5;
/** How near its end a running sprint makes its open cards pressing, in days. */
const SPRINT_ENDING = 2;

/** Why a card needs the person now. */
export type Reason =
  | { id: "overdue"; days: number }
  | { id: "today" }
  | { id: "blocking"; cards: number }
  | { id: "urgent" }
  | { id: "assigned" }
  | { id: "sprint"; end: string };

/** The most pressing first. */
const RANKS: readonly Reason["id"][] = [
  "overdue",
  "today",
  "blocking",
  "urgent",
  "assigned",
  "sprint",
];

export interface Pressing {
  item: MyCard;
  reason: Reason;
}

export interface Signals {
  today: Date;
  /** How many open cards wait on the card. */
  blocking: (item: MyCard) => number;
  /** Cards newly assigned to the person, by `taskKey`. */
  assigned: ReadonlySet<string>;
}

/** Whose turn a card is: theirs when assigned, or when they made it and nobody is. */
function isTheirs(item: MyCard): boolean {
  return item.assigned || item.card.assignees.length === 0;
}

/** The most pressing reason the card needs the person, if any. */
function reasonFor(
  item: MyCard,
  { today, blocking, assigned }: Signals
): Reason | undefined {
  const { card } = item;
  const late = card.due && differenceInCalendarDays(today, parseISO(card.due));
  if (late && late > 0) {
    return { days: late, id: "overdue" };
  }
  if (late === 0) {
    return { id: "today" };
  }
  const cards = blocking(item);
  if (cards > 0) {
    return { cards, id: "blocking" };
  }
  if (card.priority === "urgent") {
    return { id: "urgent" };
  }
  if (assigned.has(taskKey(item))) {
    return { id: "assigned" };
  }
  const sprint = activeSprint(item.content);
  if (sprint?.end && card.sprint === sprint.id) {
    const left = differenceInCalendarDays(parseISO(sprint.end), today);
    if (left >= 0 && left <= SPRINT_ENDING) {
      return { end: sprint.end, id: "sprint" };
    }
  }
  return undefined;
}

/** Those holding up the most cards first; otherwise as My tasks lists them. */
function compare(a: Pressing, b: Pressing): number {
  return (
    RANKS.indexOf(a.reason.id) - RANKS.indexOf(b.reason.id) ||
    (a.reason.id === "blocking" && b.reason.id === "blocking"
      ? b.reason.cards - a.reason.cards
      : 0) ||
    compareTasks(a.item, b.item)
  );
}

/** The person's few most pressing cards, each with why. */
export function needsYou(items: MyCard[], signals: Signals): Pressing[] {
  return items
    .flatMap((item) => {
      const reason = isTheirs(item) ? reasonFor(item, signals) : undefined;
      return reason ? [{ item, reason }] : [];
    })
    .toSorted(compare)
    .slice(0, SHOWN);
}

/** Cards the person was put on and hasn't opened since, by `taskKey`. */
export function newlyAssigned(
  groups: InboxGroup[],
  pubkey: string
): Set<string> {
  return new Set(
    groups.flatMap((group) =>
      group.items.flatMap((item) =>
        !item.read &&
        "card" in item &&
        item.notification.reason === "change" &&
        item.notification.changes.some(
          (change) =>
            change.field === "assignees" && change.added.includes(pubkey)
        )
          ? [taskKey(item)]
          : []
      )
    )
  );
}

export function reasonLabel(reason: Reason, today: Date): string {
  switch (reason.id) {
    case "overdue": {
      return `${plural(reason.days, "day")} overdue`;
    }
    case "today": {
      return "Due today";
    }
    case "blocking": {
      return `Blocking ${plural(reason.cards, "card")}`;
    }
    case "urgent": {
      return "Urgent";
    }
    case "assigned": {
      return "Newly assigned";
    }
    default: {
      const end = parseISO(reason.end);
      const left = differenceInCalendarDays(end, today);
      if (left === 0) {
        return "Sprint ends today";
      }
      return `Sprint ends ${left === 1 ? "tomorrow" : format(end, "EEEE")}`;
    }
  }
}
