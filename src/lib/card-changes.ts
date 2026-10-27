import type { CardChange, RelationChange } from "@/lib/card-activity";
import {
  cardChangeTemplate,
  cardChanges,
  foldChanges,
} from "@/lib/card-activity";
import { onLeave } from "@/lib/leaving";
import type { Board, Card, CardFields, CardRef } from "@/lib/model";
import { samePlace } from "@/lib/model";
import { accounts } from "@/lib/nostr";
import { publish } from "@/lib/publish";
import { subscriptionsOf } from "@/lib/subscribe";
import { cardSubscribers } from "@/lib/subscriptions";

/**
 * Changes to a card are told once they settle, as one: a card dragged through
 * three columns, or assignees picked one by one, makes a single entry, and a
 * card moved and moved back makes none.
 */
const SETTLE = 5000;

interface Pending {
  board: Board;
  /** The card before the first of the changes. */
  before: Card;
  /** The card after the last of them. */
  after: Card;
  /** How it was marked against other cards, or unmarked, in order. */
  relations: RelationChange[];
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();

/** Tells the card's subscribers what changed, and anyone assigned or unassigned. */
export function tellChanges(
  board: Board,
  card: CardRef,
  changes: CardChange[]
): Promise<boolean> {
  const actor = accounts.active?.pubkey;
  if (changes.length === 0 || !actor) {
    return Promise.resolve(true);
  }
  return publish(
    cardChangeTemplate(
      card,
      changes,
      cardSubscribers(board, card, subscriptionsOf, actor)
    )
  );
}

function settle(key: string): void {
  const entry = pending.get(key);
  if (!entry) {
    return;
  }
  clearTimeout(entry.timer);
  pending.delete(key);
  // Subscribers as the card is now, which takes in new assignees.
  tellChanges(entry.board, entry.after, [
    ...cardChanges(entry.before, entry.after),
    ...foldChanges(entry.relations),
  ]);
}

/** Notes changes to the card, to tell once its run of changes settles. */
function note(
  board: Board,
  card: Card,
  changes: Partial<CardFields>,
  relations: (earlier: RelationChange[]) => RelationChange[] = (earlier) =>
    earlier
): void {
  const key = `${board.address}:${card.id}`;
  const entry = pending.get(key);
  clearTimeout(entry?.timer);
  pending.set(key, {
    after: { ...(entry?.after ?? card), ...changes },
    before: entry?.before ?? card,
    board,
    relations: relations(entry?.relations ?? []),
    timer: setTimeout(() => settle(key), SETTLE),
  });
}

/** Notes a change to the card, to tell once its run of changes settles. */
export function noteCardChange(
  board: Board,
  card: Card,
  changes: Partial<CardFields>
): void {
  note(board, card, changes);
}

/**
 * Notes the card marked against others, or unmarked, to tell with the rest of
 * its run. A change only worth telling as part of the run, `foldOnly`, just
 * undoes what the run marked, and is otherwise left out.
 */
export function noteRelationChange(
  board: Board,
  card: Card,
  change: RelationChange,
  { foldOnly = false } = {}
): void {
  note(board, card, {}, (earlier) =>
    foldOnly
      ? earlier.map((item) =>
          item.field === change.field
            ? {
                ...item,
                added: item.added.filter(
                  (added) =>
                    !change.removed.some((removed) => samePlace(removed, added))
                ),
              }
            : item
        )
      : [...earlier, change]
  );
}

function settleAll(): void {
  for (const key of pending.keys()) {
    settle(key);
  }
}

// A page closing, or reloading into a new build, doesn't wait for changes to settle.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    settleAll();
  }
});
onLeave(settleAll);
