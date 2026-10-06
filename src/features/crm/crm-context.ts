import { createContext, use } from "react";

import type { CrmRecord, CrmTable, ProjectContent } from "@/lib/crm";
import type { Project } from "@/lib/project";

export interface CrmScope {
  project: Project;
  content: ProjectContent;
  table: CrmTable;
  /** Records of `table`, in rank order. */
  records: CrmRecord[];
  pubkey: string;
  /** Whether the user is a member, not just a viewer, of the project. */
  canEdit: boolean;
  /** Opens a record of this table without leaving the current view. */
  recordHref: (record: Pick<CrmRecord, "id">) => string;
}

export const CrmContext = createContext<CrmScope | null>(null);

export function useCrm(): CrmScope {
  const scope = use(CrmContext);
  if (!scope) {
    throw new Error("useCrm needs a CrmContext provider.");
  }
  return scope;
}

export function tablePath(project: Project, table: CrmTable): string {
  return `/p/${project.slug}/${table.slug}`;
}

export function recordPath(
  project: Project,
  table: CrmTable,
  record: Pick<CrmRecord, "id">,
  query?: URLSearchParams
): string {
  const search = query?.toString();
  return `${tablePath(project, table)}/${record.id}${search ? `?${search}` : ""}`;
}

/** Where a linked record lives, which may be another table of the project. */
export function relatedPath(
  project: Project,
  content: ProjectContent,
  id: string
): string | undefined {
  const record = content.byId.get(id);
  const table = content.tables.find((item) => item.id === record?.table);
  return record && table ? recordPath(project, table, record) : undefined;
}
