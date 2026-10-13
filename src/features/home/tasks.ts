import {
  addDays,
  endOfWeek,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
} from "date-fns";

import type { MyCard } from "@/hooks/use-my-cards";
import type { PriorityFilter, TaskFilters } from "@/lib/home";
import type { Board, Priority } from "@/lib/model";
import { cardKey, PRIORITIES, STATUSES } from "@/lib/model";
import type { Project } from "@/lib/project";
import { inProject } from "@/lib/project";
import { firstDayOfWeek } from "@/lib/utils";

/** Weeks start where they do for the person, as their calendars show it. */
export const WEEK_STARTS_ON = firstDayOfWeek();

export const DUE_BUCKETS = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This week" },
  { id: "later", label: "Later" },
  { id: "none", label: "No date" },
] as const;

export type DueBucket = (typeof DUE_BUCKETS)[number]["id"];

export function dueBucket(due: string | undefined, today: Date): DueBucket {
  if (!due) {
    return "none";
  }
  const day = parseISO(due);
  if (isBefore(day, today)) {
    return "overdue";
  }
  if (isSameDay(day, today)) {
    return "today";
  }
  if (isSameDay(day, addDays(today, 1))) {
    return "tomorrow";
  }
  return isAfter(day, endOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }))
    ? "later"
    : "week";
}

const PRIORITY_ORDER = new Map<Priority | undefined, number>(
  PRIORITIES.map(({ id }, index) => [id, index])
);
const STATUS_ORDER = new Map(STATUSES.map(({ id }, index) => [id, index]));

/** Soonest first, then the most urgent, the furthest along, and by key. */
export function compareTasks(a: MyCard, b: MyCard): number {
  return (
    (a.card.due ?? "~").localeCompare(b.card.due ?? "~") ||
    (PRIORITY_ORDER.get(a.card.priority) ?? PRIORITIES.length) -
      (PRIORITY_ORDER.get(b.card.priority) ?? PRIORITIES.length) ||
    (STATUS_ORDER.get(b.card.status) ?? 0) -
      (STATUS_ORDER.get(a.card.status) ?? 0) ||
    cardKey(a.board, a.card).localeCompare(cardKey(b.board, b.card))
  );
}

/** Where a card sits: its board, and the project the board is in, if any. */
export function placesOf(board: Board, projects: Project[]): string[] {
  return [
    board.address,
    ...projects
      .filter((project) => inProject(board, project))
      .map((project) => project.address),
  ];
}

export function priorityOf(item: MyCard): PriorityFilter {
  return item.card.priority ?? "none";
}

/** The cards whose owner the scope picks. */
export function inScope(cards: MyCard[], filters: TaskFilters): MyCard[] {
  if (filters.scope === "assigned") {
    return cards.filter((item) => item.assigned);
  }
  return filters.scope === "created"
    ? cards.filter((item) => item.created)
    : cards;
}

/**
 * The filters as they apply now: projects and boards the person no longer
 * sees drop out, so they can't hide every card.
 */
export function liveFilters(
  filters: TaskFilters,
  known: ReadonlySet<string>
): TaskFilters {
  return {
    ...filters,
    places: filters.places.filter((place) => known.has(place)),
  };
}

/** How many of the filters narrow the cards, not counting the scope. */
export function activeFilters(filters: TaskFilters): number {
  return [filters.places, filters.statuses, filters.priorities].filter(
    (values) => values.length > 0
  ).length;
}

/** The cards in scope that pass every filter; within one, any value picked passes. */
export function filterTasks(
  cards: MyCard[],
  filters: TaskFilters,
  projects: Project[]
): MyCard[] {
  const places = new Set(filters.places);
  return inScope(cards, filters).filter(
    (item) =>
      (places.size === 0 ||
        placesOf(item.board, projects).some((place) => places.has(place))) &&
      (filters.statuses.length === 0 ||
        filters.statuses.includes(item.card.status)) &&
      (filters.priorities.length === 0 ||
        filters.priorities.includes(priorityOf(item)))
  );
}
