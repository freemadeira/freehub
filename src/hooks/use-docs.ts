import { map, of } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { DocsContent } from "@/lib/docs";
import { resolveDocs } from "@/lib/docs";
import { DOC_PAGE_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { addressFilters, sync, whileLoading } from "@/lib/relays";

const KINDS = [DOC_PAGE_KIND];

/** The doc pages of every project, keyed by project address. */
export function useDocs(projects: Project[]): {
  docs: Map<string, DocsContent>;
  loaded: boolean;
} {
  const addresses = projects.map((project) => project.address);
  const key = projects.map((project) => project.event.id).join(",");
  const members = [...new Set(projects.flatMap((project) => project.members))];
  const filters = [{ "#a": addresses, kinds: KINDS }];
  const feed = () =>
    addresses.length > 0
      ? sync(addressFilters("#a", addresses, { kinds: KINDS }, members))
      : of(true);
  const loaded = useObservableValue(feed, [key]);
  const docs = useObservableValue(
    () =>
      addresses.length > 0
        ? whileLoading(eventStore.timeline(filters), feed()).pipe(
            map(
              (events) =>
                new Map(
                  projects.map((project) => [
                    project.address,
                    resolveDocs(project, events),
                  ])
                )
            )
          )
        : of(new Map<string, DocsContent>()),
    [key]
  );
  return { docs: docs ?? new Map(), loaded: loaded ?? false };
}
