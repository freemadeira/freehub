import type { BoardScope } from "@/features/board/board-context";
import type { Card, Status } from "@/lib/model";
import { activeSprint, STATUSES } from "@/lib/model";

/** A card in its board's active sprint, among every board's on the Boards page. */
export interface SprintCard {
  /** The board's address and the card's id, so no two boards' cards clash. */
  id: string;
  rank: number;
  card: Card;
  scope: BoardScope;
}

/** The cards in each board's active sprint; boards without one have none. */
export function sprintCards(scopes: BoardScope[]): SprintCard[] {
  return scopes.flatMap((scope) => {
    const sprint = activeSprint(scope.content);
    if (!sprint) {
      return [];
    }
    return scope.content.cards
      .filter((card) => card.sprint === sprint.id)
      .map((card) => ({
        card,
        id: `${scope.board.address}/${card.id}`,
        rank: card.rank,
        scope,
      }));
  });
}

/**
 * The cards in a group per status, by rank: each board's in its own order,
 * interleaved with the others'. Ties keep the boards' order.
 */
export function byStatus(cards: SprintCard[]): Record<Status, SprintCard[]> {
  const groups = Object.fromEntries(
    STATUSES.map(({ id }): [Status, SprintCard[]] => [id, []])
  ) as Record<Status, SprintCard[]>;
  for (const item of cards.toSorted((a, b) => a.rank - b.rank)) {
    groups[item.card.status].push(item);
  }
  return groups;
}

/** Whether the card's board uses the status, or the card is already in it. */
export function takes(item: SprintCard, status: Status): boolean {
  return (
    item.scope.board.statuses.includes(status) || item.card.status === status
  );
}

/** What the cards split into rows by, if anything. */
export const LANE_KINDS = ["none", "board", "assignee"] as const;

export type LaneKind = (typeof LANE_KINDS)[number];

/** A row of cards: one board's, or one person's, or nobody's. */
export type Lane =
  | { kind: "board"; key: string; scope: BoardScope; cards: SprintCard[] }
  | {
      kind: "person";
      key: string;
      /** None for the cards nobody is assigned to. */
      pubkey?: string;
      cards: SprintCard[];
    };

function byBoard(cards: SprintCard[]): Lane[] {
  const lanes = new Map<string, Lane>();
  for (const item of cards) {
    const key = item.scope.board.address;
    const lane = lanes.get(key) ?? {
      cards: [],
      key,
      kind: "board",
      scope: item.scope,
    };
    lane.cards.push(item);
    lanes.set(key, lane);
  }
  return [...lanes.values()];
}

/**
 * A row per person, in the order given and then anyone else assigned, and the
 * unassigned last. A card shows once in each of its assignees' rows, so each
 * copy gets an id of its own.
 */
function byAssignee(cards: SprintCard[], people: readonly string[]): Lane[] {
  const assignees = new Set([
    ...people,
    ...cards.flatMap((item) => item.card.assignees),
  ]);
  const lanes = [...assignees].flatMap((pubkey): Lane[] => {
    const theirs = cards.filter((item) => item.card.assignees.includes(pubkey));
    return theirs.length > 0
      ? [
          {
            cards: theirs.map((item) => ({
              ...item,
              id: `${pubkey}/${item.id}`,
            })),
            key: pubkey,
            kind: "person",
            pubkey,
          },
        ]
      : [];
  });
  const unassigned = cards.filter((item) => item.card.assignees.length === 0);
  return unassigned.length > 0
    ? [...lanes, { cards: unassigned, key: "unassigned", kind: "person" }]
    : lanes;
}

/** The cards in rows of the kind given; none when they aren't split. */
export function lanesOf(
  kind: LaneKind,
  cards: SprintCard[],
  people: readonly string[]
): Lane[] {
  switch (kind) {
    case "board": {
      return byBoard(cards);
    }
    case "assignee": {
      return byAssignee(cards, people);
    }
    default: {
      return [];
    }
  }
}
