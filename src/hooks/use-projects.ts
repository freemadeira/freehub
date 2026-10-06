import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import { DELETE_KIND, PROJECT_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { distinctSlugs, parseProject, sortProjects } from "@/lib/project";
import { sync } from "@/lib/relays";

const EVERY_PROJECT: Filter[] = [{ kinds: [PROJECT_KIND] }];

function projectFilters(pubkey: string): Filter[] {
  return [
    { authors: [pubkey], kinds: [PROJECT_KIND] },
    { "#p": [pubkey], kinds: [PROJECT_KIND] },
  ];
}

function parseProjects(events: NostrEvent[]): Project[] {
  return events.map(parseProject).filter((project) => project !== undefined);
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
          map((events) => sortProjects(distinctSlugs(parseProjects(events))))
        ),
    [pubkey]
  );
  return { loaded: loaded ?? false, projects: projects ?? [] };
}

/**
 * Every project on the team relays, also the ones the user isn't in, so a new
 * link can't clash with a project someone else sees.
 */
export function useEveryProject(): Project[] {
  useObservableValue(() => sync(EVERY_PROJECT), []);
  const projects = useObservableValue(
    () => eventStore.timeline(EVERY_PROJECT).pipe(map(parseProjects)),
    []
  );
  return projects ?? [];
}
