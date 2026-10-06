import { getDisplayName } from "applesauce-core/helpers/profile";
import { combineLatest, map, of, startWith } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import { eventStore } from "@/lib/nostr";
import { shortNpub } from "@/lib/utils";

/** Display names for several people at once, e.g. to search them. */
export function useProfileNames(pubkeys: string[]): Map<string, string> {
  const key = pubkeys.join(",");
  const names = useObservableValue(
    () =>
      pubkeys.length === 0
        ? of([])
        : combineLatest(
            pubkeys.map((pubkey) =>
              eventStore.profile(pubkey).pipe(
                map((profile) => getDisplayName(profile) ?? shortNpub(pubkey)),
                startWith(shortNpub(pubkey))
              )
            )
          ),
    [key]
  );
  return new Map(
    pubkeys.map((pubkey, index) => [
      pubkey,
      names?.[index] ?? shortNpub(pubkey),
    ])
  );
}
