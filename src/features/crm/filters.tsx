import { cn } from "cn";
import { ListFilterIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCrm } from "@/features/crm/crm-context";
import type { RecordsTable } from "@/features/crm/table-features";
import { EMPTY, FILTERABLE } from "@/features/crm/table-features";
import { OptionChip, Person } from "@/features/crm/values";
import { useProfile } from "@/hooks/use-profile";
import type { CrmRecord, Field } from "@/lib/crm";
import { findOption } from "@/lib/crm";
import { SWATCH_COLORS } from "@/lib/palette";

interface FilterOption {
  value: string;
  label: ReactNode;
  count: number;
}

function countBy(records: CrmRecord[], field: Field): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const values = record.values[field.id] ?? [];
    for (const value of values.length > 0 ? values : [EMPTY]) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

function filterOptions(
  field: Field,
  records: CrmRecord[],
  members: string[]
): FilterOption[] {
  const counts = countBy(records, field);
  const none = {
    count: counts.get(EMPTY) ?? 0,
    label: (
      <span className="text-muted-foreground">
        No {field.name.toLowerCase()}
      </span>
    ),
    value: EMPTY,
  };
  let options: FilterOption[] = [];
  if (field.type === "checkbox") {
    return [
      { count: counts.get("true") ?? 0, label: "Yes", value: "true" },
      { count: counts.get(EMPTY) ?? 0, label: "No", value: EMPTY },
    ];
  }
  if (field.type === "member") {
    const people = new Set([...members, ...counts.keys()]);
    people.delete(EMPTY);
    options = [...people].map((pubkey) => ({
      count: counts.get(pubkey) ?? 0,
      label: <Person pubkey={pubkey} />,
      value: pubkey,
    }));
  } else {
    options = field.options.map((option) => ({
      count: counts.get(option.id) ?? 0,
      label: (
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              SWATCH_COLORS[option.color]
            )}
          />
          <span className="truncate">{option.label}</span>
        </span>
      ),
      value: option.id,
    }));
  }
  return none.count > 0 ? [...options, none] : options;
}

function FieldFilter({ table, field }: { table: RecordsTable; field: Field }) {
  const { project, records } = useCrm();
  const column = table.getColumn(field.id);
  const picked = (column?.getFilterValue() as string[] | undefined) ?? [];
  const options = filterOptions(field, records, project.members);
  if (!column || options.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-muted-foreground px-1 text-xs font-medium">
        {field.name}
      </h3>
      <ToggleGroup
        aria-label={`Filter by ${field.name}`}
        className="flex-wrap gap-1"
        multiple
        onValueChange={(next) => {
          column.setFilterValue(next.length > 0 ? next : undefined);
          table.setPageIndex(0);
        }}
        value={picked}
      >
        {options.map((option) => (
          <ToggleGroupItem
            className="hover:bg-foreground/5 data-pressed:bg-primary/15 data-pressed:inset-ring-primary/60 inset-ring-border flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs inset-ring transition-[background-color,box-shadow] duration-150"
            key={option.value}
            value={option.value}
          >
            {option.label}
            <span className="text-muted-foreground tabular-nums">
              {option.count}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function filterableFields(fields: Field[]): Field[] {
  return fields.filter((field) => FILTERABLE.has(field.type));
}

export function FilterButton({ table }: { table: RecordsTable }) {
  const { table: crmTable } = useCrm();
  const fields = filterableFields(crmTable.fields);
  const active = table.state.columnFilters.length;
  if (fields.length === 0) {
    return null;
  }
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>
        <ListFilterIcon />
        Filter
        {active > 0 && (
          <span className="bg-primary text-primary-foreground -mr-1 flex size-5 items-center justify-center rounded-full text-xs tabular-nums">
            {active}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-(--available-height) w-[min(24rem,calc(100vw-2rem))] flex-col gap-4 overflow-y-auto"
      >
        {fields.map((field) => (
          <FieldFilter field={field} key={field.id} table={table} />
        ))}
        {active > 0 && (
          <Button
            className="self-start"
            onClick={() => table.resetColumnFilters()}
            size="sm"
            variant="ghost"
          >
            Clear filters
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MemberName({ pubkey }: { pubkey: string }) {
  const { name } = useProfile(pubkey);
  return name;
}

function valueLabel(field: Field, value: string): ReactNode {
  if (value === EMPTY) {
    return field.type === "checkbox" ? "No" : "Empty";
  }
  if (field.type === "checkbox") {
    return "Yes";
  }
  if (field.type === "member") {
    return <MemberName pubkey={value} />;
  }
  const option = findOption(field, value);
  return option ? <OptionChip className="h-5" option={option} /> : value;
}

/** The filters in use, each removable on its own. */
export function ActiveFilters({ table }: { table: RecordsTable }) {
  const { table: crmTable } = useCrm();
  const filters = table.state.columnFilters.flatMap((filter) => {
    const field = crmTable.fields.find((item) => item.id === filter.id);
    return field && Array.isArray(filter.value)
      ? [{ field, values: filter.value as string[] }]
      : [];
  });
  if (filters.length === 0) {
    return null;
  }
  return (
    <ul aria-label="Filters" className="flex flex-wrap items-center gap-1.5">
      {filters.map(({ field, values }) => (
        <li
          className="bg-card shadow-surface flex h-8 max-w-full items-center gap-1.5 rounded-full pr-1 pl-3 text-sm"
          key={field.id}
        >
          <span className="text-muted-foreground shrink-0">{field.name}</span>
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            {values.map((value, index) => (
              <span className="flex shrink-0 items-center gap-1" key={value}>
                {index > 0 && <span className="text-muted-foreground">or</span>}
                {valueLabel(field, value)}
              </span>
            ))}
          </span>
          <Button
            aria-label={`Remove ${field.name} filter`}
            className="size-6"
            onClick={() => table.getColumn(field.id)?.setFilterValue(undefined)}
            size="icon-xs"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </li>
      ))}
    </ul>
  );
}
