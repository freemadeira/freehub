import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { Activity, CrmRecord } from "@/lib/crm";
import { parseActivity, recordActivityAddresses } from "@/lib/crm";
import { COMMENT_KIND, DELETE_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { sync } from "@/lib/relays";

/** Notes, calls and visits logged on a record, newest first. */
export function useRecordActivity(
  project: Project,
  record: CrmRecord
): Activity[] {
  const filters = [
    {
      "#A": recordActivityAddresses(project, record),
      kinds: [COMMENT_KIND],
    },
  ];
  const key = `${project.event.id}:${record.id}`;
  useObservableValue(() => sync(filters), [key]);
  const activity = useObservableValue(
    () =>
      eventStore
        .timeline(filters)
        .pipe(
          map((events) =>
            events
              .filter((event) => project.members.includes(event.pubkey))
              .map(parseActivity)
          )
        ),
    [key]
  );
  const ids =
    activity?.flatMap((item) => (item.event.sig ? [item.id] : [])) ?? [];
  useObservableValue(
    () =>
      ids.length > 0 ? sync([{ "#e": ids, kinds: [DELETE_KIND] }]) : undefined,
    [ids.join(",")]
  );
  return activity ?? [];
}
