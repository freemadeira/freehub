import { ListFilterIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface FilterOption {
  value: string;
  label: ReactNode;
  count: number;
}

interface FilterGroupProps {
  label: string;
  options: FilterOption[];
  value: string[];
  onChange: (value: string[]) => void;
}

/** One thing to filter by, its values as chips that each show how many match. */
export function FilterGroup({
  label,
  options,
  value,
  onChange,
}: FilterGroupProps) {
  if (options.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-muted-foreground px-1 text-xs font-medium">
        {label}
      </h3>
      <ToggleGroup
        aria-label={`Filter by ${label.toLowerCase()}`}
        className="flex-wrap gap-1"
        multiple
        onValueChange={onChange}
        value={value}
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

interface FilterPopoverProps {
  /** How many filters are in use. */
  active: number;
  onClear: () => void;
  align?: "start" | "end";
  /** The groups to filter by. */
  children: ReactNode;
}

/** The Filter button, with how many filters are in use, and the groups it opens. */
export function FilterPopover({
  active,
  onClear,
  align = "start",
  children,
}: FilterPopoverProps) {
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
        align={align}
        className="flex max-h-(--available-height) w-[min(24rem,calc(100vw-2rem))] flex-col gap-4 overflow-y-auto"
      >
        {children}
        {active > 0 && (
          <Button
            className="self-start"
            onClick={onClear}
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
