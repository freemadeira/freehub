import type { BoardTab } from "@/features/board/board-context";
import type { BoardContent, Card, Sprint } from "@/lib/model";
import { activeSprint, isClosed, STATUSES } from "@/lib/model";

/** Cards a status at a time, in the order the statuses come, as columns and lists show them. */
export function groupedByStatus(cards: Card[]): Card[] {
  return STATUSES.flatMap(({ id }) =>
    cards.filter((card) => card.status === id)
  );
}

/**
 * The open cards, for planning: each future sprint's, then the rest. Those
 * in a sprint that ended are back in the backlog; the active sprint's show
 * on its own tab.
 */
export function backlogGroups(
  content: BoardContent,
  cards: Card[]
): { future: Sprint[]; planned: Map<string, Card[]>; backlog: Card[] } {
  const active = activeSprint(content);
  const future = content.sprints.filter((sprint) => sprint.status === "future");
  const planned = new Map(
    future.map((sprint): [string, Card[]] => [sprint.id, []])
  );
  const backlog: Card[] = [];
  for (const card of cards) {
    if (!isClosed(card.status) && !(active && card.sprint === active.id)) {
      const bucket = card.sprint ? planned.get(card.sprint) : undefined;
      (bucket ?? backlog).push(card);
    }
  }
  return { backlog, future, planned };
}

export interface DoneGroup {
  id: string;
  title: string;
  cards: Card[];
}

/** Closed cards outside the active sprint, latest sprint first and latest closed first. */
export function doneGroups(content: BoardContent, cards: Card[]): DoneGroup[] {
  const active = activeSprint(content);
  const done = cards
    .filter(
      (card) => isClosed(card.status) && !(active && card.sprint === active.id)
    )
    .toSorted((a, b) => b.event.created_at - a.event.created_at);
  const sprints = content.sprints
    .filter((sprint) => sprint !== active)
    .toReversed();
  const known = new Set(sprints.map((sprint) => sprint.id));
  return [
    ...sprints.map((sprint) => ({
      cards: done.filter((card) => card.sprint === sprint.id),
      id: sprint.id,
      title: sprint.title,
    })),
    {
      cards: done.filter((card) => !(card.sprint && known.has(card.sprint))),
      id: "none",
      title: "No sprint",
    },
  ].filter((group) => group.cards.length > 0);
}

/** The cards in the order a tab lists them, top to bottom and column by column. */
export function cardOrder(
  tab: BoardTab,
  content: BoardContent,
  cards: Card[]
): Card[] {
  switch (tab) {
    case "sprint": {
      const sprint = activeSprint(content);
      return sprint
        ? groupedByStatus(cards.filter((card) => card.sprint === sprint.id))
        : [];
    }
    case "backlog": {
      const { backlog, future, planned } = backlogGroups(content, cards);
      return [
        ...future.flatMap((sprint) => planned.get(sprint.id) ?? []),
        ...backlog,
      ];
    }
    case "done": {
      return doneGroups(content, cards).flatMap((group) => group.cards);
    }
    default: {
      return [];
    }
  }
}

/** The cards either side of one in an order, unless the order leaves it out. */
export function cardNeighbours(
  card: Card,
  order: Card[]
): { previous?: Card; next?: Card } | undefined {
  const index = order.findIndex((item) => item.id === card.id);
  if (index === -1) {
    return undefined;
  }
  return { next: order[index + 1], previous: order[index - 1] };
}
