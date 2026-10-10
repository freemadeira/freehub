import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import { APP_DATA_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { sync } from "@/lib/relays";
import type { Subscriptions } from "@/lib/subscriptions";
import {
  NO_SUBSCRIPTIONS,
  parseSubscriptions,
  SUBSCRIPTIONS_D,
} from "@/lib/subscriptions";

/** What the person chose to subscribe to, or not. */
export function useSubscriptions(pubkey: string): Subscriptions {
  useObservableValue(
    () =>
      sync([
        { "#d": [SUBSCRIPTIONS_D], authors: [pubkey], kinds: [APP_DATA_KIND] },
      ]),
    [pubkey]
  );
  const subscriptions = useObservableValue(
    () =>
      eventStore
        .replaceable(APP_DATA_KIND, pubkey, SUBSCRIPTIONS_D)
        .pipe(map(parseSubscriptions)),
    [pubkey]
  );
  return subscriptions ?? NO_SUBSCRIPTIONS;
}
