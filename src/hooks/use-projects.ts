import type { Filter } from "applesauce-core/helpers/filter";
import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import { DELETE_KIND, PROJECT_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { parseProject, sortProjects } from "@/lib/project";
import { sync } from "@/lib/relays";

function projectFilters(pubkey: string): Filter[] {
  return [
    { authors: [pubkey], kinds: [PROJECT_KIND] },
    { "#p": [pubkey], kinds: [PROJECT_KIND] },
  ];
}

/** Projects the user created or was added to. */
export function useProjects(pubkey: string): {
  projects: Project[];
  loaded: boolean;
} {
  const loaded = useObservableValue(
    () =>
      sync([
        ...projectFilters(pubkey),
        { "#k": [String(PROJECT_KIND)], kinds: [DELETE_KIND] },
      ]),
    [pubkey]
  );
  const projects = useObservableValue(
    () =>
      eventStore
        .timeline(projectFilters(pubkey))
        .pipe(
          map((events) =>
            sortProjects(
              events
                .map(parseProject)
                .filter((project) => project !== undefined)
            )
          )
        ),
    [pubkey]
  );
  return { loaded: loaded ?? false, projects: projects ?? [] };
}
