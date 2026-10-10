import { cn } from "cn";
import {
  ArrowUpDownIcon,
  CornerUpRightIcon,
  DownloadIcon,
  HardDriveIcon,
  LayoutGridIcon,
  ListIcon,
  RotateCcwIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { RefObject } from "react";

import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DriveView } from "@/features/drive/drive-context";
import { parseView } from "@/features/drive/drive-context";
import type { Layout } from "@/features/drive/drive-items";
import type { Entry } from "@/features/drive/drive-state";
import { entryId, useDrive } from "@/features/drive/drive-state";
import type { Sort } from "@/lib/drive";
import { SORTS } from "@/lib/drive";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const LAYOUTS = [
  { icon: LayoutGridIcon, label: "Grid", value: "grid" },
  { icon: ListIcon, label: "List", value: "list" },
] as const;

/** Grid or list, side by side, so the current one shows at a glance. */
function LayoutSwitch({
  value,
  onChange,
}: {
  value: Layout;
  onChange: (value: Layout) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Layout"
      className="bg-foreground/5 relative isolate gap-0 rounded-full p-0.5"
      onValueChange={(next) => {
        // Pressing the current layout again would unpress it; it stays.
        if (next[0]) {
          onChange(next[0] as Layout);
        }
      }}
      value={[value]}
    >
      {LAYOUTS.map(({ icon: Icon, label, value: item }) => (
        <FluidTooltip.Root key={item}>
          <FluidTooltip.Trigger>
            <ToggleGroupItem
              aria-label={label}
              className="text-muted-foreground hover:text-foreground data-pressed:text-foreground flex size-7 items-center justify-center rounded-full transition-colors duration-150"
              value={item}
            >
              <Icon aria-hidden className="size-4" />
            </ToggleGroupItem>
          </FluidTooltip.Trigger>
          <FluidTooltip.Content>{label}</FluidTooltip.Content>
        </FluidTooltip.Root>
      ))}
      <span
        aria-hidden
        className={cn(
          "bg-card shadow-surface absolute top-0.5 left-0.5 -z-10 size-7 rounded-full transition-[translate] duration-200 ease-out",
          value === "list" && "translate-x-7"
        )}
      />
    </ToggleGroup>
  );
}

/** Names sort A to Z; times and sizes newest or biggest first, unless turned. */
function byLetter(sort: Sort): boolean {
  return sort.key === "name" || sort.key === "kind";
}

function SortMenu({
  sort,
  onChange,
}: {
  sort: Sort;
  onChange: (sort: Sort) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton label="Sort">
            <ArrowUpDownIcon />
          </IconButton>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(key) =>
            onChange({
              ascending: key === "name" || key === "kind",
              key: key as Sort["key"],
            })
          }
          value={sort.key}
        >
          {SORTS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          onValueChange={(value) =>
            onChange({ ...sort, ascending: value === "up" })
          }
          value={sort.ascending ? "up" : "down"}
        >
          <DropdownMenuRadioItem value="up">
            {byLetter(sort) ? "A to Z" : "Oldest or smallest first"}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="down">
            {byLetter(sort) ? "Z to A" : "Newest or biggest first"}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchField({
  value,
  onChange,
  field,
}: {
  value: string;
  onChange: (value: string) => void;
  field: RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="bg-foreground/5 focus-within:bg-card focus-within:ring-ring/40 relative flex h-8 w-full items-center gap-2 rounded-full px-3 transition-[background-color,box-shadow] duration-150 focus-within:ring-2 sm:w-60">
      <SearchIcon
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
      <input
        aria-label="Search the Drive"
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            event.stopPropagation();
            onChange("");
          }
        }}
        placeholder="Search the Drive"
        ref={field}
        value={value}
      />
      {value ? (
        <button
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground -mr-1 flex size-5 items-center justify-center rounded-full"
          onClick={() => onChange("")}
          type="button"
        >
          <XIcon className="size-3.5" />
        </button>
      ) : (
        <kbd className="text-muted-foreground bg-card shadow-surface rounded px-1.5 font-sans text-[0.6875rem] max-sm:hidden">
          /
        </kbd>
      )}
    </label>
  );
}

/** What trashed entries picked together offer. */
function TrashActions({ entries }: { entries: Entry[] }) {
  const { actions, canEdit } = useDrive();
  if (!canEdit) {
    return null;
  }
  return (
    <>
      <Button
        onClick={() => actions.restore(entries)}
        size="sm"
        variant="ghost"
      >
        <RotateCcwIcon />
        Restore
      </Button>
      <Button onClick={() => actions.purge(entries)} size="sm" variant="ghost">
        <Trash2Icon />
        <span className="max-sm:sr-only">Delete forever</span>
      </Button>
    </>
  );
}

/** What entries picked together offer. */
function LiveActions({ entries }: { entries: Entry[] }) {
  const drive = useDrive();
  const { actions } = drive;
  const files = entries.flatMap((entry) =>
    entry.kind === "file" ? [entry.file] : []
  );
  const allStarred = entries.every((entry) => drive.starred(entryId(entry)));
  return (
    <>
      {files.length === entries.length && (
        <IconButton label="Download" onClick={() => actions.download(files)}>
          <DownloadIcon />
        </IconButton>
      )}
      <IconButton
        label={allStarred ? "Remove stars" : "Star"}
        onClick={() => actions.star(entries, !allStarred)}
      >
        <StarIcon
          className={cn(allStarred && "fill-amber-400 text-amber-400")}
        />
      </IconButton>
      {drive.canEdit && (
        <IconButton label="Move to…" onClick={() => actions.move(entries)}>
          <CornerUpRightIcon />
        </IconButton>
      )}
      {drive.canEdit && (
        <IconButton
          label="Move to trash"
          onClick={() => actions.trash(entries)}
        >
          <Trash2Icon />
        </IconButton>
      )}
    </>
  );
}

/** What can be done to everything picked at once, in place of the toolbar. */
function SelectionBar({
  entries,
  onClear,
}: {
  entries: Entry[];
  onClear: () => void;
}) {
  return (
    // Laid over the toolbar, which keeps its place, so nothing below moves.
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="absolute inset-0 flex min-w-0 items-center gap-1 px-2"
      exit={{ opacity: 0, y: -4 }}
      initial={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15, ease: EASE_OUT }}
    >
      <FluidTooltip.Group>
        <IconButton label="Clear selection" onClick={onClear}>
          <XIcon />
        </IconButton>
        <span className="mr-2 text-sm font-medium tabular-nums">
          {entries.length} selected
        </span>
        {entries.some((entry) => entry.trashed) ? (
          <TrashActions entries={entries} />
        ) : (
          <LiveActions entries={entries} />
        )}
      </FluidTooltip.Group>
    </motion.div>
  );
}

export interface ToolbarProps {
  /** What's picked; while there's any, the toolbar turns into what can be done to it. */
  picked: Entry[];
  onClearPicked: () => void;
  view?: DriveView;
  onViewChange: (view: DriveView | undefined) => void;
  searching: boolean;
  text: string;
  onTextChange: (text: string) => void;
  searchField: RefObject<HTMLInputElement | null>;
  sort: Sort;
  onSortChange: (sort: Sort) => void;
  layout: Layout;
  onLayoutChange: (layout: Layout) => void;
}

/** The views of the Drive, its search, order and layout, held under the top bar as the page scrolls. */
export function Toolbar(props: ToolbarProps) {
  const { picked, view, searching } = props;
  const selecting = picked.length > 0;
  return (
    <div className="bg-background/85 sticky top-14 z-20 -mx-2 min-h-11 rounded-2xl backdrop-blur-md">
      {/* Always laid out, hidden while picking, so the bar keeps one height. */}
      <motion.div
        animate={{ opacity: selecting ? 0 : 1, y: selecting ? 4 : 0 }}
        className="flex min-w-0 flex-wrap items-center gap-2 px-2 py-1.5"
        inert={selecting}
        initial={false}
        transition={{ duration: 0.15, ease: EASE_OUT }}
      >
        <Tabs
          className="max-w-full overflow-x-auto"
          onValueChange={(next) => props.onViewChange(parseView(String(next)))}
          value={searching ? "" : (view ?? "files")}
        >
          <TabsList>
            <TabsTrigger value="files">
              <HardDriveIcon className="size-3.5" />
              Files
            </TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="starred">Starred</TabsTrigger>
            <TabsTrigger value="trash">Trash</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-1 max-sm:w-full">
          <SearchField
            field={props.searchField}
            onChange={props.onTextChange}
            value={props.text}
          />
          <FluidTooltip.Group>
            {view !== "recent" && (
              <SortMenu onChange={props.onSortChange} sort={props.sort} />
            )}
            <LayoutSwitch
              onChange={props.onLayoutChange}
              value={props.layout}
            />
          </FluidTooltip.Group>
        </div>
      </motion.div>
      <AnimatePresence initial={false}>
        {selecting && (
          <SelectionBar
            entries={picked}
            key="selection"
            onClear={props.onClearPicked}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
