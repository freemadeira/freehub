/**
 * Each person keeps one list of what they chose to subscribe to, or to stop
 * hearing about, as a NIP-78 app data event. Teammates read it, so whoever
 * changes or comments on a card knows whom to tell. No browser APIs here:
 * the notifier reads it too.
 */
import type { NostrEvent } from "applesauce-core/helpers/event";

import type { Board, CardRef, Template } from "@/lib/model";
import { APP_DATA_KIND, CARD_KIND } from "@/lib/model";

export const SUBSCRIPTIONS_D = "freehub/subscriptions";
/** Entries kept of each kind, oldest dropped first. */
const MAX_ENTRIES = 1000;

/** Things as `kind:id`, in the order they were picked, newest last. */
export interface Subscriptions {
  /** Subscribed to by choice. */
  on: ReadonlySet<string>;
  /** Unsubscribed from, though the person would hear about it by default. */
  off: ReadonlySet<string>;
}

export const NO_SUBSCRIPTIONS: Subscriptions = {
  off: new Set(),
  on: new Set(),
};

function newest(subjects: ReadonlySet<string>): string[] {
  return [...subjects].slice(-MAX_ENTRIES);
}

export function cardSubject(card: Pick<CardRef, "id">): string {
  return `${CARD_KIND}:${card.id}`;
}

export function parseSubscriptions(event?: NostrEvent): Subscriptions {
  if (!event) {
    return NO_SUBSCRIPTIONS;
  }
  const on = new Set<string>();
  const off = new Set<string>();
  for (const [name, subject] of event.tags) {
    if (subject && name === "subscribed") {
      on.add(subject);
    } else if (subject && name === "unsubscribed") {
      off.add(subject);
    }
  }
  return { off, on };
}

export function subscriptionsTemplate({ on, off }: Subscriptions): Template {
  return {
    content: "",
    kind: APP_DATA_KIND,
    tags: [
      ["d", SUBSCRIPTIONS_D],
      ...newest(on).map((subject) => ["subscribed", subject]),
      ...newest(off).map((subject) => ["unsubscribed", subject]),
    ],
  };
}

/** Whether the person hears about the card without choosing to: they made it or are on it. */
export function subscribedByDefault(card: CardRef, pubkey: string): boolean {
  return card.creator === pubkey || card.assignees.includes(pubkey);
}

export function isSubscribed(
  card: CardRef,
  pubkey: string,
  subscriptions: Subscriptions
): boolean {
  const subject = cardSubject(card);
  if (subscriptions.off.has(subject)) {
    return false;
  }
  return subscriptions.on.has(subject) || subscribedByDefault(card, pubkey);
}

/** The list with the card subscribed to, or not, as the newest pick. */
export function withSubscription(
  subscriptions: Subscriptions,
  card: CardRef,
  pubkey: string,
  subscribed: boolean
): Subscriptions {
  const subject = cardSubject(card);
  const on = new Set(subscriptions.on);
  const off = new Set(subscriptions.off);
  on.delete(subject);
  off.delete(subject);
  if (subscribed && !subscribedByDefault(card, pubkey)) {
    on.add(subject);
  } else if (!subscribed && subscribedByDefault(card, pubkey)) {
    off.add(subject);
  }
  return { off, on };
}

/**
 * Everyone who can read the board and subscribes to the card, but the person
 * telling them. Assignees are subscribers by default, so a card's own people
 * hear about it even before their lists load.
 */
export function cardSubscribers(
  board: Board,
  card: CardRef,
  lists: (pubkey: string) => Subscriptions,
  actor: string
): string[] {
  return [...board.members, ...board.viewers].filter(
    (pubkey) => pubkey !== actor && isSubscribed(card, pubkey, lists(pubkey))
  );
}
