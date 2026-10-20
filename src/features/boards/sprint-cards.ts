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
