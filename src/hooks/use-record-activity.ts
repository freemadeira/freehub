import { map } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { Activity, CrmRecord, CrmTable } from "@/lib/crm";
import { parseActivity, recordActivityAddresses } from "@/lib/crm";
import { COMMENT_KIND, CRM_RECORD_KIND, DELETE_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { addressFilters, sync } from "@/lib/relays";

/** Notes, calls and visits logged on a record, newest first. */
export function useRecordActivity(
  project: Project,
  table: CrmTable,
  record: CrmRecord
): Activity[] {
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
