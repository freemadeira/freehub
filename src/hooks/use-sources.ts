import { map, of } from "rxjs";

import { getConfig } from "@/config";
import { useObservableValue } from "@/hooks/use-observable-value";
import type { ProjectContent } from "@/lib/crm";
import { SOURCE_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { sync } from "@/lib/relays";
import type { Source } from "@/lib/sources";
import { parseSource } from "@/lib/sources";

/**
 * Sources of the organization's connectors and of those the project's tables
 * use. Brings in the connectors' profiles too, which only the team relays
 * have, so records they wrote show their names.
 */
export function useSources(content: ProjectContent | undefined): Source[] {
  const connectors = [
    ...new Set([
      ...getConfig().connectors,
      ...(content?.tables.flatMap((table) => table.connectors) ?? []),
    ]),
  ].toSorted();
  const key = connectors.join(",");
  useObservableValue(
    () =>
      connectors.length > 0
        ? sync([{ authors: connectors, kinds: [0, SOURCE_KIND] }])
        : undefined,
    [key]
  );
  const sources = useObservableValue(
    () =>
      connectors.length > 0
        ? eventStore
            .timeline([{ authors: connectors, kinds: [SOURCE_KIND] }])
            .pipe(
              map((events) =>
                events
                  .flatMap((event) => parseSource(event) ?? [])
                  .toSorted((a, b) => a.name.localeCompare(b.name))
              )
            )
        : of([]),
    [key]
  );
  return sources ?? [];
}
