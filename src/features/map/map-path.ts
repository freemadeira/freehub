import type { CrmRecord, CrmTable, Field } from "@/lib/crm";
import type { Project } from "@/lib/project";

/** Shares the top-level path with board codes, so MAP is a reserved code. */
export const MAP_PATH = "/map";

/** A record as the map's URL names it: project, table and record. */
export function recordReference(
  project: Project,
  table: CrmTable,
  record: Pick<CrmRecord, "id">
): string {
  return `${project.slug}/${table.slug}/${record.id}`;
}

/** The map, flown to a record with its sheet open. */
export function mapRecordHref(
  project: Project,
  table: CrmTable,
  record: Pick<CrmRecord, "id">
): string {
  return `${MAP_PATH}?${new URLSearchParams({ record: recordReference(project, table, record) })}`;
}

/** The map, waiting for a click to set a record's location field. */
export function mapPickHref(
  project: Project,
  table: CrmTable,
  record: Pick<CrmRecord, "id">,
  field: Pick<Field, "id">
): string {
  return `${MAP_PATH}?${new URLSearchParams({ pick: `${recordReference(project, table, record)}/${field.id}` })}`;
}

export interface RecordReference {
  project: string;
  table: string;
  record: string;
  field?: string;
}

export function parseReference(
  value: string | null
): RecordReference | undefined {
  const [project, table, record, field] = (value ?? "").split("/");
  return project && table && record
    ? { field, project, record, table }
    : undefined;
}
