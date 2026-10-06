/**
 * Notifications are read from relay events, not sent as events of their own.
 * Each rule names the events that may notify someone, as relay filters, and
 * what one of them means for that person. Every way of delivering them shares
 * these rules: the in-app inbox today, an email bridge or a bot subscribed to
 * the relay later. No browser APIs here, so they run anywhere.
 *
 * A rule only reads the event. Whoever delivers a notification still checks
 * that its author belongs to the board, as the inbox does.
 */
import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";

import { mentions } from "@/lib/mentions";
import { CARD_KIND, COMMENT_KIND } from "@/lib/model";

/** Newest events each rule asks the relays for. */
const LIMIT = 200;

/** Someone mentioned the recipient in a comment on a card. */
export interface MentionNotification {
  type: "mention";
  /** The comment's id, which also keys whether it was read. */
  id: string;
  actor: string;
  createdAt: number;
  /** The card's `d` tag; its board comes from the card itself. */
  cardId: string;
  /** The comment, with mentions as `nostr:` references. */
  content: string;
}

/** Everything that can reach someone. A new rule adds its own member. */
export type Notification = MentionNotification;

export interface NotificationRule {
  /** Relay filters for the events that may notify the recipient. */
  filters: (recipient: string) => Filter[];
  /** What the event means for the recipient, if anything. */
  derive: (event: NostrEvent, recipient: string) => Notification | undefined;
}

const cardMention: NotificationRule = {
  derive(event, recipient) {
    if (
      event.kind !== COMMENT_KIND ||
      event.pubkey === recipient ||
      getTagValue(event, "K") !== String(CARD_KIND) ||
      !mentions(event.content, recipient)
    ) {
      return;
    }
    const card = parseReplaceableAddress(getTagValue(event, "A") ?? "");
    if (card?.kind !== CARD_KIND) {
      return;
    }
    return {
      actor: event.pubkey,
      cardId: card.identifier,
      content: event.content,
      createdAt: event.created_at,
      id: event.id,
      type: "mention",
    };
  },
  // Mentions carry a `p` tag per person, so the relay can do the routing.
  filters: (recipient) => [
    {
      "#K": [String(CARD_KIND)],
      "#p": [recipient],
      kinds: [COMMENT_KIND],
      limit: LIMIT,
    },
  ],
};

export const NOTIFICATION_RULES: readonly NotificationRule[] = [cardMention];

export function notificationFilters(recipient: string): Filter[] {
  return NOTIFICATION_RULES.flatMap((rule) => rule.filters(recipient));
}

/** The recipient's notifications among the events, newest first. */
export function deriveNotifications(
  events: NostrEvent[],
  recipient: string
): Notification[] {
  const found = new Map<string, Notification>();
  for (const event of events) {
    for (const rule of NOTIFICATION_RULES) {
      const notification = rule.derive(event, recipient);
      if (notification && !found.has(notification.id)) {
        found.set(notification.id, notification);
      }
    }
  }
  return [...found.values()].toSorted((a, b) => b.createdAt - a.createdAt);
}
