import type { Filter } from "applesauce-core/helpers/filter";

import type { CardRef } from "@/lib/model";
import { APP_DATA_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { publish } from "@/lib/publish";
import type { Subscriptions } from "@/lib/subscriptions";
import {
  isSubscribed,
  parseSubscriptions,
  SUBSCRIPTIONS_D,
  subscriptionsTemplate,
  withSubscription,
} from "@/lib/subscriptions";

/** Relay filters for the subscription lists of these people. */
export function subscriptionFilters(people: string[]): Filter[] {
  return people.length > 0
    ? [{ "#d": [SUBSCRIPTIONS_D], authors: people, kinds: [APP_DATA_KIND] }]
    : [];
}

/** The person's list as the store has it. */
export function subscriptionsOf(pubkey: string): Subscriptions {
  return parseSubscriptions(
    eventStore.getReplaceable(APP_DATA_KIND, pubkey, SUBSCRIPTIONS_D)
  );
}

/** Subscribes the person to the card, or stops them hearing about it. */
export function setSubscribed(
  card: CardRef,
  pubkey: string,
  subscribed: boolean
): Promise<boolean> {
  const previous = eventStore.getReplaceable(
    APP_DATA_KIND,
    pubkey,
    SUBSCRIPTIONS_D
  );
  const current = parseSubscriptions(previous);
  if (isSubscribed(card, pubkey, current) === subscribed) {
    return Promise.resolve(true);
  }
  return publish(
    subscriptionsTemplate(withSubscription(current, card, pubkey, subscribed)),
    previous
  );
}
