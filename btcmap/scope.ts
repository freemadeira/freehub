/**
 * What the sync writes to OpenStreetMap: bitcoin acceptance only. The rules
 * (plan.ts) also plan an address, a website or a relocated business's move;
 * those stay in the report for a mapper, since only acceptance is what a visit
 * checks in person.
 */
import type { Action, Merchant, TagChange } from "./plan";

/** The tags the sync writes: whether bitcoin is taken, and when that was last checked. */
export const ACCEPTANCE_KEYS: ReadonlySet<string> = new Set([
  "currency:XBT",
  "payment:bitcoin",
  "payment:lightning",
  "payment:onchain",
  "payment:lightning_contactless",
  "check_date:currency:XBT",
]);

/** The action cut down to acceptance, and the part left for a mapper. */
export function acceptanceOnly(
  merchant: Merchant,
  action: Action
): { action: Action; byHand: TagChange[]; move: boolean } {
  const none = { byHand: [], move: false };
  switch (action.kind) {
    case "edit": {
      const changes = action.changes.filter(({ key }) =>
        ACCEPTANCE_KEYS.has(key)
      );
      const byHand = action.changes.filter(
        ({ key }) => !ACCEPTANCE_KEYS.has(key)
      );
      return {
        action:
          changes.length > 0 ? { changes, kind: "edit" } : { kind: "keep" },
        byHand,
        move: false,
      };
    }
    case "move": {
      return { action: { kind: "keep" }, byHand: action.changes, move: true };
    }
    case "delete": {
      // Only a Closed business leaves the map; the rules delete nothing else.
      return merchant.listing === "closed"
        ? { action, ...none }
        : { action: { kind: "keep" }, ...none };
    }
    default: {
      return { action, ...none };
    }
  }
}
