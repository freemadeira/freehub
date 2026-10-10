import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { Activity, Assignment, CrmRecord, CrmTable } from "@/lib/crm";
import {
  isLoggedActivity,
  parseActivity,
  parseAssignment,
  recordActivityAddresses,
} from "@/lib/crm";
import { COMMENT_KIND, CRM_RECORD_KIND, DELETE_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { addressFilters, sync } from "@/lib/relays";

export interface RecordThread {
  /** Notes, calls and visits logged on the record, newest first. */
  activity: Activity[];
  /** People put in its member fields, newest first. */
  assignments: Assignment[];
}

/** What's been logged on a record, and who was put on it. */
export function useRecordActivity(
  project: Project,
  table: CrmTable,
  record: CrmRecord
): RecordThread {
  const addresses = recordActivityAddresses(project, table, record);
  const filters = [{ "#A": addresses, kinds: [COMMENT_KIND] }];
  const key = `${project.event.id}:${table.event.id}:${record.id}`;
  useObservableValue(
    () =>
      sync(
        addressFilters(
          "#A",
          addresses,
          { "#K": [String(CRM_RECORD_KIND)], kinds: [COMMENT_KIND] },
          project.members
        )
      ),
    [key]
  );
  const thread = useObservableValue(
    () =>
      eventStore.timeline(filters).pipe(
        map((events): RecordThread => {
          const own = events.filter((event) =>
            project.members.includes(event.pubkey)
          );
          return {
            activity: own.filter(isLoggedActivity).map(parseActivity),
            assignments: own.flatMap((event) => parseAssignment(event) ?? []),
          };
        })
      ),
    [key]
  );
  const ids =
    thread?.activity.flatMap((item) => (item.event.sig ? [item.id] : [])) ?? [];
  useObservableValue(
    () =>
      ids.length > 0 ? sync([{ "#e": ids, kinds: [DELETE_KIND] }]) : undefined,
    [ids.join(",")]
  );
  return thread ?? { activity: [], assignments: [] };
}
