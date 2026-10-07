import { cn } from "cn";
import { ListIcon, PanelLeftCloseIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableIcon } from "@/features/crm/table-icon";
import type { Mapped, Pin } from "@/features/map/pins";
import { ALL_TABLES, pinColors, pinReference } from "@/features/map/pins";
import { useIsMobile } from "@/hooks/use-mobile";
import { recordTitle } from "@/lib/crm";
import { readStorage, writeStorage } from "@/lib/utils";

const HIDDEN_KEY = "map-list";

function tableLabel(mapped: Mapped, withProjects: boolean): string {
  return withProjects
    ? `${mapped.project.title}: ${mapped.table.title}`
    : mapped.table.title;
}

interface HeaderProps {
  tables: Mapped[];
  filter: string;
  onFilter: (filter: string) => void;
  withProjects: boolean;
}

function ListHeader({ tables, filter, onFilter, withProjects }: HeaderProps) {
  const [only] = tables;
  if (only && tables.length === 1) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2 px-2 text-sm font-medium">
        <TableIcon
          className="text-muted-foreground size-4 shrink-0"
          icon={only.table.icon}
        />
        <span className="truncate">{tableLabel(only, withProjects)}</span>
      </span>
    );
  }
  return (
    <Select
      items={[
        { label: "All tables", value: ALL_TABLES },
        ...tables.map((table) => ({
          label: tableLabel(table, withProjects),
          value: table.key,
        })),
      ]}
      onValueChange={(value: string | null) => onFilter(value ?? ALL_TABLES)}
      value={filter}
    >
      <SelectTrigger
        aria-label="Show records from"
        className="hover:bg-accent h-8 min-w-0 flex-1 border-transparent bg-transparent px-2 font-medium"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={ALL_TABLES}>All tables</SelectItem>
        {tables.map((table) => (
          <SelectItem key={table.key} value={table.key}>
            <TableIcon className="size-4" icon={table.table.icon} />
            {tableLabel(table, withProjects)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface MapListProps extends HeaderProps {
  pins: Pin[];
  /** Reference of the record whose sheet is open. */
  selected?: string;
  onSelect: (pin: Pin) => void;
  /** The record under the pointer or focus, to light up its pin. */
  onHover: (reference?: string) => void;
}

/** The records on the map, in a corner of it, to find one and fly there. */
export function MapList({
  pins,
  selected,
  onSelect,
  onHover,
  ...header
}: MapListProps) {
  const mobile = useIsMobile();
  const [hidden, setHidden] = useState(() => {
    const stored = readStorage(HIDDEN_KEY);
    return stored === null ? mobile : stored === "hidden";
  });
  const list = useRef<HTMLUListElement>(null);

  // A record picked on the map scrolls into sight here too.
  useEffect(() => {
    if (hidden || selected === undefined) {
      return;
    }
    list.current
      ?.querySelector("[aria-current=true]")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, hidden]);

  const hide = (value: boolean) => {
    setHidden(value);
    writeStorage(HIDDEN_KEY, value ? "hidden" : "shown");
    onHover();
  };

  if (hidden) {
    return (
      <Button
        aria-label="Show list"
        className="bg-background/90 shadow-surface absolute top-3 left-3 rounded-full backdrop-blur"
        onClick={() => hide(false)}
        size="icon"
        variant="ghost"
      >
        <ListIcon />
      </Button>
    );
  }

  const sorted = pins.toSorted((a, b) =>
    recordTitle(a.record).localeCompare(recordTitle(b.record))
  );
  return (
    <section
      aria-label="Records"
      className="bg-background/95 shadow-surface absolute top-3 left-3 flex max-h-[min(30rem,calc(100%-1.5rem))] w-72 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl backdrop-blur"
    >
      <div className="flex items-center gap-1 p-1.5">
        <ListHeader {...header} />
        <Button
          aria-label="Hide list"
          className="text-muted-foreground shrink-0"
          onClick={() => hide(true)}
          size="icon-sm"
          variant="ghost"
        >
          <PanelLeftCloseIcon />
        </Button>
      </div>
      <ul className="min-h-0 overflow-y-auto px-1.5 pb-1.5" ref={list}>
        {sorted.map((pin) => {
          const reference = pinReference(pin);
          const current = reference === selected;
          return (
            <li key={reference}>
              <button
                aria-current={current}
                className={cn(
                  "hover:bg-accent focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-3",
                  current && "bg-accent"
                )}
                onBlur={() => onHover()}
                onClick={() => onSelect(pin)}
                onFocus={() => onHover(reference)}
                onMouseEnter={() => onHover(reference)}
                onMouseLeave={() => onHover()}
                type="button"
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full",
                    pinColors(pin)
                  )}
                >
                  <TableIcon
                    className="size-3"
                    icon={pin.table.icon}
                    strokeWidth={2.4}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {recordTitle(pin.record)}
                </span>
                {pin.stage && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {pin.stage.label}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
