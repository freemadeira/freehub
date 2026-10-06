import type {
  ColumnVisibilityState,
  Header,
  SortDirection,
} from "@tanstack/react-table";
import { FlexRender, functionalUpdate, useTable } from "@tanstack/react-table";
import { cn } from "cn";
import { format } from "date-fns";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  Columns3Icon,
  DownloadIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";

import { IconButton } from "@/components/icon-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCrm } from "@/features/crm/crm-context";
import { ActiveFilters, FilterButton } from "@/features/crm/filters";
import type { RecordRow, RecordsTable } from "@/features/crm/table-features";
import {
  features,
  fieldColumn,
  matchesSearch,
  selectColumn,
  toRows,
} from "@/features/crm/table-features";
import { FieldValue, OptionChip, Person } from "@/features/crm/values";
import type { CrmRecord, CrmTable, Field, ProjectContent } from "@/lib/crm";
import { recordTitle, stageField, TITLE_FIELD } from "@/lib/crm";
import { deleteRecord, setValues } from "@/lib/crm-actions";
import { formatCurrency, plainValue, toNumber } from "@/lib/crm-values";
import { downloadFile, toCsv } from "@/lib/csv";
import { readStorage, writeStorage } from "@/lib/utils";

const PAGE_SIZE = 50;
/** History state that lets the record sheet close with a plain back navigation. */
export const OPENED_FROM_TABLE = { fromTable: true };

const STICKY =
  "sticky z-10 bg-card group-hover/row:bg-[color-mix(in_oklab,var(--card),var(--foreground)_2.5%)] group-data-selected/row:bg-[color-mix(in_oklab,var(--card),var(--primary)_10%)]";

function visibilityKey(table: string): string {
  return `columns:${table}`;
}

function readVisibility(table: string): ColumnVisibilityState {
  try {
    const parsed: unknown = JSON.parse(
      readStorage(visibilityKey(table)) ?? "{}"
    );
    return parsed && typeof parsed === "object"
      ? (parsed as ColumnVisibilityState)
      : {};
  } catch {
    return {};
  }
}

export function countLabel(table: CrmTable, count: number): string {
  return `${count} ${(count === 1 ? table.singular : table.title).toLowerCase()}`;
}

export function exportRecords(
  table: CrmTable,
  content: ProjectContent,
  records: CrmRecord[],
  fields: Field[]
): void {
  const titleOf = (id: string) => {
    const related = content.byId.get(id);
    return related ? recordTitle(related) : undefined;
  };
  const rows = [
    fields.map((field) => field.name),
    ...records.map((record) =>
      fields.map((field) => plainValue(field, record, titleOf))
    ),
  ];
  downloadFile(
    `${table.slug}-${format(new Date(), "yyyy-MM-dd")}.csv`,
    toCsv(rows),
    "text/csv;charset=utf-8"
  );
}

function SortHeader({
  header,
  sorted,
}: {
  header: Header<typeof features, RecordRow, unknown>;
  sorted: false | SortDirection;
}) {
  let Icon = ChevronsUpDownIcon;
  if (sorted === "asc") {
    Icon = ArrowUpIcon;
  } else if (sorted === "desc") {
    Icon = ArrowDownIcon;
  }
  return (
    <button
      className="hover:text-foreground focus-visible:ring-ring/50 group/sort -mx-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors duration-150 outline-none focus-visible:ring-3"
      onClick={header.column.getToggleSortingHandler()}
      type="button"
    >
      <FlexRender header={header} />
      <Icon
        aria-hidden
        className={cn(
          "size-3.5 transition-opacity duration-150",
          !sorted &&
            "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60"
        )}
      />
    </button>
  );
}

function ColumnsMenu({ table }: { table: RecordsTable }) {
  const { table: crmTable } = useCrm();
  const columns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide());
  if (columns.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        <Columns3Icon />
        <span className="max-sm:sr-only">Columns</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show columns</DropdownMenuLabel>
          {columns.map((column) => (
            <DropdownMenuCheckboxItem
              checked={column.getIsVisible()}
              key={column.id}
              onCheckedChange={(checked) => column.toggleVisibility(checked)}
            >
              {crmTable.fields.find((field) => field.id === column.id)?.name ??
                column.id}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BulkBar({
  selected,
  onClear,
}: {
  selected: CrmRecord[];
  onClear: () => void;
}) {
  const { project, table } = useCrm();
  const [confirming, setConfirming] = useState(false);
  const stage = stageField(table);
  const owner = table.fields.find((field) => field.type === "member");
  const label = countLabel(table, selected.length);

  const setAll = (field: Field, values: string[], message: string) => {
    for (const record of selected) {
      setValues(table, record, field.id, values);
    }
    toast.success(message);
    onClear();
  };

  return (
    <div className="bg-popover shadow-raised fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full py-1.5 pr-1.5 pl-4 text-sm">
      <span className="shrink-0 font-medium tabular-nums">
        {selected.length} selected
      </span>
      <span aria-hidden className="bg-border mx-2 h-5 w-px shrink-0" />
      {stage && stage.options.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
            Move to
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top">
            {stage.options.map((option) => (
              <DropdownMenuItem
                key={option.id}
                onClick={() =>
                  setAll(
                    stage,
                    [option.id],
                    `Moved ${label} to ${option.label}`
                  )
                }
              >
                <OptionChip dot option={option} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {owner && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
            {owner.name}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top">
            {project.members.map((member) => (
              <DropdownMenuItem
                key={member}
                onClick={() =>
                  setAll(
                    owner,
                    [member],
                    `Updated ${owner.name.toLowerCase()} of ${label}`
                  )
                }
              >
                <Person pubkey={member} />
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              onClick={() =>
                setAll(
                  owner,
                  [],
                  `Cleared ${owner.name.toLowerCase()} of ${label}`
                )
              }
            >
              <span className="text-muted-foreground">Nobody</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setConfirming(true)}
        size="sm"
        variant="ghost"
      >
        <Trash2Icon />
        Delete
      </Button>
      <IconButton label="Clear selection" onClick={onClear}>
        <XIcon />
      </IconButton>
      <AlertDialog onOpenChange={setConfirming} open={confirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              They disappear for everyone in the project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                for (const record of selected) {
                  deleteRecord(table, record);
                }
                onClear();
              }}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Totals({ records }: { records: CrmRecord[] }) {
  const { table } = useCrm();
  const sums = table.fields
    .filter((field) => field.type === "currency")
    .map((field) => ({
      field,
      total: records.reduce(
        (sum, record) => sum + (toNumber(record.values[field.id]?.[0]) ?? 0),
        0
      ),
    }))
    .filter(({ total }) => total !== 0);
  return (
    <>
      {sums.map(({ field, total }) => (
        <span key={field.id}>
          <span className="text-muted-foreground">{field.name}</span>{" "}
          <span className="font-medium">
            {formatCurrency(total, field.config || "EUR")}
          </span>
        </span>
      ))}
    </>
  );
}

interface RecordsViewProps {
  onCreate: () => void;
  onImport: () => void;
}

export function RecordsView({ onCreate, onImport }: RecordsViewProps) {
  // TanStack Table hands out stable row and cell objects whose methods read
  // changing state, which the React Compiler would cache. This view opts out.
  "use no memo";
  const { content, recordHref, records, table: crmTable } = useCrm();
  const [, navigate] = useLocation();
  const [visibility, setVisibility] = useState(() =>
    readVisibility(crmTable.id)
  );

  const rows = useMemo(
    () => toRows(records, crmTable, content),
    [records, crmTable, content]
  );
  const columns = useMemo(
    () => [
      selectColumn(
        ({ table }) => (
          <Checkbox
            aria-label="Select all on this page"
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={
              table.getIsSomePageRowsSelected() &&
              !table.getIsAllPageRowsSelected()
            }
            onCheckedChange={(checked) =>
              table.toggleAllPageRowsSelected(checked)
            }
          />
        ),
        ({ row }) => (
          <Checkbox
            aria-label={`Select ${recordTitle(row.original.record)}`}
            checked={row.getIsSelected()}
            onCheckedChange={(checked, details) =>
              row.getToggleSelectedHandler()({
                nativeEvent: details.event,
                target: { checked },
              })
            }
          />
        )
      ),
      ...crmTable.fields.map((field) =>
        fieldColumn(field, content, ({ row }) =>
          field.id === TITLE_FIELD ? (
            <Link
              className={cn(
                "focus-visible:ring-ring/50 -mx-1.5 block truncate rounded-md px-1.5 py-0.5 font-medium outline-none focus-visible:ring-3",
                !row.original.record.title && "text-muted-foreground"
              )}
              href={recordHref(row.original.record)}
              state={OPENED_FROM_TABLE}
            >
              {recordTitle(row.original.record)}
            </Link>
          ) : (
            <FieldValue field={field} record={row.original.record} />
          )
        )
      ),
    ],
    [crmTable, content, recordHref]
  );

  const table = useTable({
    autoResetPageIndex: false,
    columns,
    data: rows,
    features,
    getColumnCanGlobalFilter: (column) => column.id === TITLE_FIELD,
    getRowId: (row) => row.record.id,
    globalFilterFn: matchesSearch,
    initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
    onColumnVisibilityChange: (updater) => {
      const next = functionalUpdate(updater, visibility);
      setVisibility(next);
      writeStorage(visibilityKey(crmTable.id), JSON.stringify(next));
    },
    state: { columnVisibility: visibility },
  });

  const { pageIndex, pageSize } = table.state.pagination;
  const pageCount = table.getPageCount();
  const filtered = table
    .getSortedRowModel()
    .rows.map((row) => row.original.record);
  const selected = table
    .getSelectedRowModel()
    .rows.map((row) => row.original.record);
  const visibleRows = table.getRowModel().rows;
  const columnCount = table.getVisibleLeafColumns().length;

  // Rows can disappear under a later page, through filters or teammates' edits.
  useEffect(() => {
    if (pageIndex > 0 && pageIndex >= pageCount) {
      table.setPageIndex(Math.max(0, pageCount - 1));
    }
  }, [pageIndex, pageCount, table]);

  const open = (event: MouseEvent<HTMLTableRowElement>, record: CrmRecord) => {
    if (
      (event.target as Element).closest(
        "a, button, input, label, [role=checkbox]"
      )
    ) {
      return;
    }
    navigate(recordHref(record), { state: OPENED_FROM_TABLE });
  };

  if (records.length === 0) {
    return (
      <Empty className="py-20">
        <EmptyTitle>No {crmTable.title.toLowerCase()} yet</EmptyTitle>
        <EmptyDescription>
          Add the first one, or bring them over from a spreadsheet.
        </EmptyDescription>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={onCreate}>
            New {crmTable.singular.toLowerCase()}
          </Button>
          <Button onClick={onImport} variant="outline">
            <UploadIcon />
            Import CSV
          </Button>
        </div>
      </Empty>
    );
  }

  const exportFields = table
    .getVisibleLeafColumns()
    .flatMap((column) =>
      crmTable.fields.filter((field) => field.id === column.id)
    );
  const first = pageIndex * pageSize + 1;
  const last = Math.min(filtered.length, (pageIndex + 1) * pageSize);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="border-input bg-card focus-within:border-ring focus-within:ring-ring/30 dark:bg-input/30 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border px-3 transition-[border-color,box-shadow] focus-within:ring-3 sm:max-w-72">
          <SearchIcon
            aria-hidden
            className="text-muted-foreground size-4 shrink-0"
          />
          <input
            aria-label={`Search ${crmTable.title.toLowerCase()}`}
            autoComplete="off"
            className="placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
            onChange={(event) => {
              table.setGlobalFilter(event.target.value);
              table.setPageIndex(0);
            }}
            placeholder="Search…"
            type="search"
            value={(table.state.globalFilter as string | undefined) ?? ""}
          />
        </label>
        <FilterButton table={table} />
        <div className="ml-auto flex items-center gap-2">
          <ColumnsMenu table={table} />
          <IconButton
            label="Export CSV"
            onClick={() =>
              exportRecords(crmTable, content, filtered, exportFields)
            }
            size="icon"
            variant="outline"
          >
            <DownloadIcon />
          </IconButton>
        </div>
      </div>
      <ActiveFilters table={table} />
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                let ariaSort: "ascending" | "descending" | undefined;
                if (sorted === "asc") {
                  ariaSort = "ascending";
                } else if (sorted === "desc") {
                  ariaSort = "descending";
                }
                return (
                  <TableHead
                    aria-sort={ariaSort}
                    className={cn(
                      header.column.id === "select" &&
                        cn(STICKY, "left-0 w-11 pr-0"),
                      header.column.id === TITLE_FIELD &&
                        cn(STICKY, "left-11 min-w-48"),
                      "bg-card"
                    )}
                    key={header.id}
                  >
                    {!header.isPlaceholder &&
                      (header.column.getCanSort() ? (
                        <SortHeader header={header} sorted={sorted} />
                      ) : (
                        <FlexRender header={header} />
                      ))}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {visibleRows.map((row) => (
            <TableRow
              className="group/row hover:bg-foreground/[0.025] cursor-pointer"
              data-selected={row.getIsSelected() || undefined}
              key={row.id}
              onClick={(event) => open(event, row.original.record)}
            >
              {row.getVisibleCells().map((cell) => {
                const field = crmTable.fields.find(
                  (item) => item.id === cell.column.id
                );
                return (
                  <TableCell
                    className={cn(
                      "max-w-72",
                      cell.column.id === "select" &&
                        cn(STICKY, "left-0 w-11 pr-0"),
                      cell.column.id === TITLE_FIELD &&
                        cn(STICKY, "left-11 max-w-80 min-w-48"),
                      (field?.type === "number" ||
                        field?.type === "currency") &&
                        "text-right"
                    )}
                    key={cell.id}
                  >
                    <FlexRender cell={cell} />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
          {visibleRows.length === 0 && (
            <TableRow>
              <TableCell
                className="text-muted-foreground h-32 text-center"
                colSpan={columnCount}
              >
                No {crmTable.title.toLowerCase()} match.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 text-sm">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-muted-foreground tabular-nums">
            {countLabel(crmTable, filtered.length)}
            {filtered.length === records.length ? "" : ` of ${records.length}`}
          </span>
          <Totals records={filtered} />
        </p>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground mr-2 tabular-nums">
              {first}–{last} of {filtered.length}
            </span>
            <FluidTooltip.Group>
              <IconButton
                disabled={!table.getCanPreviousPage()}
                label="Previous page"
                onClick={() => table.previousPage()}
                variant="outline"
              >
                <ChevronLeftIcon />
              </IconButton>
              <IconButton
                disabled={!table.getCanNextPage()}
                label="Next page"
                onClick={() => table.nextPage()}
                variant="outline"
              >
                <ChevronRightIcon />
              </IconButton>
            </FluidTooltip.Group>
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <BulkBar
          onClear={() => table.resetRowSelection()}
          selected={selected}
        />
      )}
    </div>
  );
}
