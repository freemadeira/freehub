import type {
  ColumnDef,
  FilterFn,
  ReactTable,
  SortFn,
} from "@tanstack/react-table";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";

import type { CrmRecord, CrmTable, Field, ProjectContent } from "@/lib/crm";
import { recordTitle, TITLE_FIELD } from "@/lib/crm";
import { isChecked, plainValue, toNumber } from "@/lib/crm-values";

// Each row model comes right after the feature it belongs to.
// oxlint-disable-next-line sort-keys
export const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  columnVisibilityFeature,
  rowSelectionFeature,
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

export interface RecordRow {
  record: CrmRecord;
  /** Every value as lowercase text, for the search box. */
  search: string;
}

export type RecordsTable = ReactTable<typeof features, RecordRow>;
export type RecordColumn = ColumnDef<typeof features, RecordRow, unknown>;

/** Filter value standing for "no value", next to the real options. */
export const EMPTY = "__none__";

export const FILTERABLE = new Set<Field["type"]>([
  "stage",
  "select",
  "multiselect",
  "member",
  "checkbox",
]);

type SortValue = string | number | undefined;

function sortValue(
  field: Field,
  record: CrmRecord,
  content: ProjectContent
): SortValue {
  const values = record.values[field.id] ?? [];
  const [value] = values;
  switch (field.type) {
    case "title": {
      return record.title.trim().toLowerCase() || undefined;
    }
    case "number":
    case "currency": {
      return toNumber(value);
    }
    case "select":
    case "stage":
    case "multiselect": {
      const index = field.options.findIndex((option) => option.id === value);
      return index === -1 ? undefined : index;
    }
    case "checkbox": {
      return isChecked(values) ? 1 : 0;
    }
    case "relation": {
      const related = value ? content.byId.get(value) : undefined;
      return related ? recordTitle(related).toLowerCase() : undefined;
    }
    default: {
      return value?.toLowerCase();
    }
  }
}

const compare: SortFn<typeof features, RecordRow> = (a, b, id) => {
  const left = a.getValue<SortValue>(id);
  const right = b.getValue<SortValue>(id);
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left ?? "").localeCompare(String(right ?? ""));
};

/** Keeps rows holding any of the picked values; `EMPTY` matches rows with none. */
export const matchesAny: FilterFn<typeof features, RecordRow> = (
  row,
  columnId,
  picked: string[]
) => {
  const values = row.original.record.values[columnId] ?? [];
  return values.length === 0
    ? picked.includes(EMPTY)
    : values.some((value) => picked.includes(value));
};
matchesAny.autoRemove = (value) => !Array.isArray(value) || value.length === 0;

export const matchesSearch: FilterFn<typeof features, RecordRow> = (
  row,
  _columnId,
  query: string
) => row.original.search.includes(query.trim().toLowerCase());

export function toRows(
  records: CrmRecord[],
  table: CrmTable,
  content: ProjectContent
): RecordRow[] {
  const titleOf = (id: string) => {
    const related = content.byId.get(id);
    return related ? recordTitle(related) : undefined;
  };
  return records.map((record) => ({
    record,
    search: table.fields
      .map((field) => plainValue(field, record, titleOf))
      .join("\n")
      .toLowerCase(),
  }));
}

const helper = createColumnHelper<typeof features, RecordRow>();

export function fieldColumn(
  field: Field,
  content: ProjectContent,
  cell: RecordColumn["cell"]
): RecordColumn {
  return helper.accessor((row) => sortValue(field, row.record, content), {
    cell,
    enableColumnFilter: FILTERABLE.has(field.type),
    enableGlobalFilter: field.id === TITLE_FIELD,
    enableHiding: field.type !== "title",
    filterFn: matchesAny,
    header: field.name,
    id: field.id,
    // Amounts read best biggest first; stages and names in their natural order.
    sortDescFirst: field.type === "number" || field.type === "currency",
    sortFn: compare,
    sortUndefined: "last",
  }) as RecordColumn;
}

export function selectColumn(
  header: RecordColumn["header"],
  cell: RecordColumn["cell"]
): RecordColumn {
  return helper.display({
    cell,
    enableHiding: false,
    enableSorting: false,
    header,
    id: "select",
  }) as RecordColumn;
}
