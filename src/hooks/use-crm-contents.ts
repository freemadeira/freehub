import { map, of } from "rxjs";

import { getConfig } from "@/config";
import { useObservableValue } from "@/hooks/use-observable-value";
import type { ProjectContent } from "@/lib/crm";
import { resolveProject } from "@/lib/crm";
import { CRM_RECORD_KIND, CRM_TABLE_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { addressFilters, sync, whileLoading } from "@/lib/relays";

const KINDS = [CRM_TABLE_KIND, CRM_RECORD_KIND];

/** Tables and records of every project, by project address, for views across them. */
export function useCrmContents(projects: Project[]): {
  contents: Map<string, ProjectContent>;
  loaded: boolean;
} {
  const addresses = projects.map((project) => project.address);
  const key = projects.map((project) => project.event.id).join(",");
  const authors = [
    ...new Set([
      ...projects.flatMap((project) => project.members),
      ...getConfig().connectors,
    ]),
  ];
  const feed = () =>
    addresses.length > 0
      ? sync(addressFilters("#a", addresses, { kinds: KINDS }, authors))
      : of(true);
  const loaded = useObservableValue(feed, [key]);
  const contents = useObservableValue(
    () =>
      addresses.length > 0
        ? whileLoading(
            eventStore.timeline([{ "#a": addresses, kinds: KINDS }]),
            feed()
          ).pipe(
            map(
              (events) =>
                new Map(
                  projects.map((project) => [
                    project.address,
                    resolveProject(
                      project,
                      events.filter((event) =>
                        event.tags.some(
                          ([name, value]) =>
                            name === "a" && value === project.address
                        )
                      )
                    ),
                  ])
                )
            )
          )
        : of(new Map<string, ProjectContent>()),
    [key]
  );
  return { contents: contents ?? new Map(), loaded: loaded ?? false };
}
