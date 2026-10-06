import { unixNow } from "applesauce-core/helpers/time";

import type {
  Activity,
  ActivityType,
  CrmRecord,
  CrmRecordFields,
  CrmTable,
  CrmTableFields,
} from "@/lib/crm";
import {
  activityTemplate,
  recordTemplate,
  recordTombstoneTemplate,
  stageField,
  tableTemplate,
  tableTombstoneTemplate,
} from "@/lib/crm";
import { deleteCommentTemplate } from "@/lib/model";
import { accounts } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { publish } from "@/lib/publish";

const IMPORT_CONCURRENCY = 4;

export type NewRecord = Pick<CrmRecordFields, "title"> &
  Partial<Pick<CrmRecordFields, "values" | "rank">>;

export function createTables(
  project: Project,
  tables: CrmTableFields[]
): Promise<boolean[]> {
  return Promise.all(
    tables.map((table) => publish(tableTemplate(project, table)))
  );
}

export function updateTable(
  project: Project,
  table: CrmTable,
  changes: Partial<CrmTableFields>
): Promise<boolean> {
  return publish(tableTemplate(project, { ...table, ...changes }), table.event);
}

export function deleteTable(
  project: Project,
  table: CrmTable
): Promise<boolean> {
  return publish(tableTombstoneTemplate(project, table), table.event);
}

// Entering a new stage is remembered on the record, so its journey can be told later.
function withMove(
  table: CrmTable,
  before: CrmRecordFields | undefined,
  next: CrmRecordFields
): CrmRecordFields {
  const field = stageField(table);
  const stage = field ? next.values[field.id]?.[0] : undefined;
  if (!(field && stage) || stage === before?.values[field.id]?.[0]) {
    return next;
  }
  return {
    ...next,
    moves: [
      ...next.moves,
      { at: unixNow(), by: accounts.active?.pubkey, stage },
    ],
  };
}

export function createRecord(
  table: CrmTable,
  record: NewRecord
): Promise<boolean> {
  return publish(
    recordTemplate(
      table,
      withMove(table, undefined, {
        createdAt: unixNow(),
        creator: accounts.active?.pubkey,
        id: crypto.randomUUID(),
        moves: [],
        rank: record.rank ?? 0,
        title: record.title,
        values: record.values ?? {},
      })
    )
  );
}

export function updateRecord(
  table: CrmTable,
  record: CrmRecord,
  changes: Partial<CrmRecordFields>
): Promise<boolean> {
  return publish(
    recordTemplate(table, withMove(table, record, { ...record, ...changes })),
    record.event
  );
}

export function setValues(
  table: CrmTable,
  record: CrmRecord,
  field: string,
  values: string[]
): Promise<boolean> {
  return updateRecord(table, record, {
    values: { ...record.values, [field]: values },
  });
}

export function deleteRecord(
  table: CrmTable,
  record: CrmRecord
): Promise<boolean> {
  return publish(recordTombstoneTemplate(table, record), record.event);
}

export function addActivity(
  record: CrmRecord,
  type: ActivityType,
  content: string
): Promise<boolean> {
  return publish(activityTemplate(record, type, content));
}

export function deleteActivity(activity: Activity): Promise<boolean> {
  return publish(deleteCommentTemplate(activity));
}

/** Publishes records a few at a time, so a signer app isn't flooded at once. */
export async function importRecords(
  table: CrmTable,
  records: NewRecord[],
  onProgress: (done: number) => void
): Promise<number> {
  const queue = [...records];
  let done = 0;
  let saved = 0;
  // Each worker takes the next record once its previous one is settled.
  const worker = async (): Promise<void> => {
    const next = queue.shift();
    if (!next) {
      return;
    }
    if (await createRecord(table, next)) {
      saved += 1;
    }
    done += 1;
    onProgress(done);
    await worker();
  };
  await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, worker));
  return saved;
}
