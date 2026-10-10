import { map, of } from "rxjs";

import { getConfig } from "@/config";
import { useObservableValue } from "@/hooks/use-observable-value";
import type { CrmTable, ProjectContent } from "@/lib/crm";
import { resolveProject, resolveTables } from "@/lib/crm";
import { CRM_RECORD_KIND, CRM_TABLE_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { addressFilters, sync, whileLoading } from "@/lib/relays";

/** CRM tables and records of a project, resolved across every member's versions. */
export function useProjectContent(project: Project): {
  content: ProjectContent | undefined;
  loaded: boolean;
} {
  const kinds = [CRM_TABLE_KIND, CRM_RECORD_KIND];
  const filters = [{ "#a": [project.address], kinds }];
  // Records connectors wrote are asked for by author too, for long addresses.
  const authors = [...project.members, ...getConfig().connectors];
  const feed = () =>
    sync(addressFilters("#a", [project.address], { kinds }, authors));
  const loaded = useObservableValue(feed, [
    project.address,
    project.members.join(","),
  ]);
  const content = useObservableValue(
    () =>
      whileLoading(eventStore.timeline(filters), feed()).pipe(
        map((events) => resolveProject(project, events))
      ),
    [project.address, project.event.id]
  );
  return { content, loaded: loaded ?? false };
}

/** Just the tables of several projects, for navigation. */
export function useProjectTables(projects: Project[]): Map<string, CrmTable[]> {
  const addresses = projects.map((project) => project.address);
  const key = projects.map((project) => project.event.id).join(",");
  const filters = [{ "#a": addresses, kinds: [CRM_TABLE_KIND] }];
  const members = [...new Set(projects.flatMap((project) => project.members))];
  useObservableValue(
    () =>
      addresses.length > 0
        ? sync(
            addressFilters(
              "#a",
              addresses,
              { kinds: [CRM_TABLE_KIND] },
              members
            )
          )
        : undefined,
    [key]
  );
  const tables = useObservableValue(
    () =>
      addresses.length > 0
        ? eventStore.timeline(filters).pipe(
            map(
              (events) =>
                new Map(
                  projects.map((project) => [
                    project.address,
                    resolveTables(
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
        : of(new Map<string, CrmTable[]>()),
    [key]
  );
  return tables ?? new Map();
}
