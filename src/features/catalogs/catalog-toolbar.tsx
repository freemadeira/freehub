import { cn } from "cn";
import {
  CheckIcon,
  LayoutGridIcon,
  ListFilterIcon,
  ListIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  StarIcon,
  TagsIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";

import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { UserAvatar } from "@/components/user-avatar";
import type { ShownLink } from "@/features/catalogs/catalog-context";
import { useCatalog } from "@/features/catalogs/catalog-context";
import type {
  Display,
  LinkFilters,
  Shelf,
} from "@/features/catalogs/link-filters";
import {
  GROUPS,
  SORTS,
  activeFilters,
  onShelf,
} from "@/features/catalogs/link-filters";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import { useProfile } from "@/hooks/use-profile";
import { acceptSuggestion, dismissSuggestion } from "@/lib/catalog-actions";
import type { LinkType } from "@/lib/catalogs";
import { categoryKey, LINK_TYPE_NAMES, platformName } from "@/lib/catalogs";
import { SWATCH_COLORS } from "@/lib/palette";

const PILL =
  "hover:bg-foreground/5 data-pressed:bg-foreground data-pressed:text-background flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium inset-ring inset-ring-border transition-[background-color,color,box-shadow] duration-150 data-pressed:inset-ring-transparent";

function Count({ value }: { value: number }) {
  return <span className="tabular-nums opacity-60">{value}</span>;
}

interface Suggestion {
  name: string;
  /** Links that suggested it. */
  count: number;
}

/** Categories the AI suggested for the links, most suggested first. */
function suggestionsOf(links: ShownLink[]): Suggestion[] {
  const found = new Map<string, Suggestion>();
  for (const link of links) {
    for (const name of link.suggested) {
      const key = categoryKey(name);
      const known = found.get(key);
      if (known) {
        known.count += 1;
      } else {
        found.set(key, { count: 1, name });
      }
    }
  }
  return [...found.values()].toSorted((a, b) => b.count - a.count);
}

/** A category the AI would add: added or waved away from where it's suggested. */
function SuggestedPill({ suggestion }: { suggestion: Suggestion }) {
  const { catalog, project, canEdit } = useCatalog();
  const said = `Suggested for ${suggestion.count === 1 ? "1 link" : `${suggestion.count} links`}`;
  return (
    <FluidTooltip.Root>
      <FluidTooltip.Trigger>
        <span className="text-muted-foreground flex h-8 shrink-0 items-center gap-1 rounded-full border border-dashed pr-1 pl-2.5 text-sm">
          <SparklesIcon aria-hidden className="text-primary size-3.5" />
          <span className="text-foreground/80">{suggestion.name}</span>
          <Count value={suggestion.count} />
          {canEdit && (
            <>
              <button
                aria-label={`Add ${suggestion.name}`}
                className="hover:bg-primary hover:text-primary-foreground focus-visible:ring-ring/50 ml-0.5 flex size-6 items-center justify-center rounded-full transition-colors duration-150 outline-none focus-visible:ring-3"
                onClick={() =>
                  acceptSuggestion(project, catalog, suggestion.name)
                }
                type="button"
              >
                <CheckIcon className="size-3.5" />
              </button>
              <button
                aria-label={`Dismiss ${suggestion.name}`}
                className="hover:bg-foreground/10 hover:text-foreground focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded-full transition-colors duration-150 outline-none focus-visible:ring-3"
                onClick={() =>
                  dismissSuggestion(project, catalog, suggestion.name)
                }
                type="button"
              >
                <XIcon className="size-3.5" />
              </button>
            </>
          )}
        </span>
      </FluidTooltip.Trigger>
      <FluidTooltip.Content>{said}</FluidTooltip.Content>
    </FluidTooltip.Root>
  );
}

/** Where a row that scrolls sideways fades: only at the ends with more past them. */
const FADES: Record<string, string> = {
  "": "",
  end: "mask-[linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]",
  start: "mask-[linear-gradient(to_left,#000_calc(100%-2.5rem),transparent)]",
  startend:
    "mask-[linear-gradient(to_right,transparent,#000_2.5rem,#000_calc(100%-2.5rem),transparent)]",
};

/** Whether a row scrolled sideways has more to its start and to its end. */
function useEdges() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ end: false, start: false });
  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const start = element.scrollLeft > 1;
    const end =
      element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setState((now) =>
      now.start === start && now.end === end ? now : { end, start }
    );
  }, []);
  useLayoutEffect(() => {
    measure();
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  });
  return { edges: { ...state, measure }, ref };
}

/**
 * How the catalog's links are browsed: all of them, what's new or starred,
 * one category at a time, or those in none, each with how many it holds.
 * Categories the AI suggests wait at the end, to add or wave away.
 */
export function CategoryBar({
  links,
  shelf,
  onShelfChange,
  onManage,
  className,
}: {
  /** Every link, before anything else narrows them. */
  links: ShownLink[];
  shelf: Shelf;
  onShelfChange: (shelf: Shelf) => void;
  onManage?: () => void;
  className?: string;
}) {
  const { catalog } = useCatalog();
  const count = (value: Shelf) =>
    links.filter((link) => onShelf(link, value)).length;
  const fresh = count("new");
  const starred = count("starred");
  const loose = count("none");
  const suggestions = suggestionsOf(links);
  const { ref, edges } = useEdges();
  const pills: { value: Shelf; label: ReactNode; count: number }[] = [
    { count: links.length, label: "All", value: "all" },
    ...(fresh > 0
      ? [
          {
            count: fresh,
            label: (
              <>
                <span aria-hidden className="bg-primary size-2 rounded-full" />
                New
              </>
            ),
            value: "new" as const,
          },
        ]
      : []),
    ...(starred > 0 || shelf === "starred"
      ? [
          {
            count: starred,
            label: (
              <>
                <StarIcon aria-hidden className="size-3.5" />
                Starred
              </>
            ),
            value: "starred" as const,
          },
        ]
      : []),
    ...catalog.categories.map((category) => ({
      count: count(`category:${category.id}`),
      label: (
        <>
          <span
            aria-hidden
            className={cn("size-2 rounded-full", SWATCH_COLORS[category.color])}
          />
          {category.name}
        </>
      ),
      value: `category:${category.id}` as const,
    })),
    ...(loose > 0 && catalog.categories.length > 0
      ? [{ count: loose, label: "No category", value: "none" as const }]
      : []),
  ];
  return (
    <div
      className={cn(
        "flex min-w-0 scrollbar-none items-center gap-1.5 overflow-x-auto py-0.5",
        FADES[`${edges.start ? "start" : ""}${edges.end ? "end" : ""}`],
        className
      )}
      onScroll={() => edges.measure()}
      ref={ref}
    >
      <ToggleGroup
        aria-label="Show"
        className="flex shrink-0 gap-1.5"
        onValueChange={(next) => {
          // Pressing the shelf shown again goes back to all of them.
          onShelfChange((next[0] as Shelf | undefined) ?? "all");
        }}
        value={[shelf]}
      >
        {pills.map((pill) => (
          <ToggleGroupItem className={PILL} key={pill.value} value={pill.value}>
            {pill.label}
            <Count value={pill.count} />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {suggestions.length > 0 && (
        <FluidTooltip.Group>
          {suggestions.map((suggestion) => (
            <SuggestedPill key={suggestion.name} suggestion={suggestion} />
          ))}
        </FluidTooltip.Group>
      )}
      {onManage && (
        <IconButton className="shrink-0" label="Categories" onClick={onManage}>
          <TagsIcon />
        </IconButton>
      )}
    </div>
  );
}

/** Finds links by any word in their title, summary, note, creator or site. */
export function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="bg-foreground/5 focus-within:bg-card focus-within:shadow-surface focus-within:ring-ring/30 flex h-8 w-44 items-center gap-1.5 rounded-full px-3 transition-[width,background-color,box-shadow] duration-200 ease-out focus-within:w-60 focus-within:ring-2 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1 max-sm:focus-within:w-auto">
      <SearchIcon
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
      <input
        aria-label="Search links"
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            onChange("");
          }
        }}
        placeholder="Search"
        type="search"
        value={value}
      />
    </label>
  );
}

interface Choice {
  value: string;
  label: ReactNode;
  count: number;
}

function ChoiceGroup({
  title,
  choices,
  picked,
  onChange,
}: {
  title: string;
  choices: Choice[];
  picked: string[];
  onChange: (picked: string[]) => void;
}) {
  if (choices.length < 2 && picked.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-muted-foreground px-1 text-xs font-medium">
        {title}
      </h3>
      <ToggleGroup
        aria-label={`Filter by ${title.toLowerCase()}`}
        className="flex-wrap gap-1"
        multiple
        onValueChange={onChange}
        value={picked}
      >
        {choices.map((choice) => (
          <ToggleGroupItem
            className="hover:bg-foreground/5 data-pressed:bg-primary/15 data-pressed:inset-ring-primary/60 inset-ring-border flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs inset-ring transition-[background-color,box-shadow] duration-150"
            key={choice.value}
            value={choice.value}
          >
            {choice.label}
            <span className="text-muted-foreground tabular-nums">
              {choice.count}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function counted<T extends string>(
  links: ShownLink[],
  key: (link: ShownLink) => T
): Map<T, number> {
  const counts = new Map<T, number>();
  for (const link of links) {
    counts.set(key(link), (counts.get(key(link)) ?? 0) + 1);
  }
  return counts;
}

function PersonName({ pubkey }: { pubkey: string }) {
  return useProfile(pubkey).name;
}

/** Narrows the links by where they're from, what they are and who saved them. */
export function FilterButton({
  links,
  filters,
  onChange,
}: {
  links: ShownLink[];
  filters: LinkFilters;
  onChange: (filters: LinkFilters) => void;
}) {
  const active = activeFilters(filters);
  const platforms = [...counted(links, (link) => link.platform)].map(
    ([platform, count]) => ({
      count,
      label: (
        <>
          <PlatformIcon className="size-3.5" platform={platform} />
          {platformName(platform)}
        </>
      ),
      value: platform,
    })
  );
  const types = [...counted(links, (link) => link.type)].map(
    ([type, count]) => ({ count, label: LINK_TYPE_NAMES[type], value: type })
  );
  const savers = [...counted(links, (link) => link.savedBy)].map(
    ([pubkey, count]) => ({
      count,
      label: (
        <>
          <UserAvatar aria-hidden pubkey={pubkey} size="xs" />
          <PersonName pubkey={pubkey} />
        </>
      ),
      value: pubkey,
    })
  );
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            className={cn("rounded-full", active > 0 && "pr-1.5")}
            size="sm"
            variant="ghost"
          />
        }
      >
        <ListFilterIcon />
        <span className="max-sm:sr-only">Filter</span>
        {active > 0 && (
          <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs tabular-nums">
            {active}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-(--available-height) w-[min(24rem,calc(100vw-2rem))] flex-col gap-4 overflow-y-auto"
      >
        <ChoiceGroup
          choices={platforms}
          onChange={(picked) => onChange({ ...filters, platforms: picked })}
          picked={filters.platforms}
          title="Platform"
        />
        <ChoiceGroup
          choices={types}
          onChange={(picked) =>
            onChange({ ...filters, types: picked as LinkType[] })
          }
          picked={filters.types}
          title="Type"
        />
        <ChoiceGroup
          choices={savers}
          onChange={(picked) => onChange({ ...filters, savers: picked })}
          picked={filters.savers}
          title="Saved by"
        />
        {platforms.length < 2 && types.length < 2 && savers.length < 2 && (
          <p className="text-muted-foreground text-sm">
            Filters show up once there’s more than one platform, type or person
            to tell apart.
          </p>
        )}
        {active > 0 && (
          <Button
            className="self-start"
            onClick={() => onChange({ platforms: [], savers: [], types: [] })}
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

/** The filters in use, each removable on its own. */
export function ActiveFilters({
  filters,
  onChange,
}: {
  filters: LinkFilters;
  onChange: (filters: LinkFilters) => void;
}) {
  const chips: { key: string; label: ReactNode; remove: () => void }[] = [
    ...filters.platforms.map((platform) => ({
      key: `platform:${platform}`,
      label: (
        <>
          <PlatformIcon className="size-3.5" platform={platform} />
          {platformName(platform)}
        </>
      ),
      remove: () =>
        onChange({
          ...filters,
          platforms: filters.platforms.filter((item) => item !== platform),
        }),
    })),
    ...filters.types.map((type) => ({
      key: `type:${type}`,
      label: LINK_TYPE_NAMES[type],
      remove: () =>
        onChange({
          ...filters,
          types: filters.types.filter((item) => item !== type),
        }),
    })),
    ...filters.savers.map((pubkey) => ({
      key: `saver:${pubkey}`,
      label: (
        <>
          <UserAvatar aria-hidden pubkey={pubkey} size="xs" />
          <PersonName pubkey={pubkey} />
        </>
      ),
      remove: () =>
        onChange({
          ...filters,
          savers: filters.savers.filter((item) => item !== pubkey),
        }),
    })),
  ];
  if (chips.length === 0) {
    return null;
  }
  return (
    <ul aria-label="Filters" className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <li
          className="bg-card shadow-surface flex h-8 max-w-full items-center gap-1.5 rounded-full pr-1 pl-3 text-sm"
          key={chip.key}
        >
          {chip.label}
          <Button
            aria-label="Remove filter"
            className="size-6"
            onClick={() => chip.remove()}
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

const LAYOUTS = [
  { icon: LayoutGridIcon, label: "Gallery", value: "gallery" },
  { icon: ListIcon, label: "List", value: "list" },
] as const;

/** Gallery or list, side by side, so the current one shows at a glance. */
export function LayoutSwitch({
  value,
  onChange,
}: {
  value: Display["layout"];
  onChange: (value: Display["layout"]) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Layout"
      className="bg-foreground/5 relative isolate gap-0 rounded-full p-0.5"
      onValueChange={(next) => {
        // Pressing the current layout again would unpress it; it stays.
        if (next[0]) {
          onChange(next[0] as Display["layout"]);
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
      {/* Slides between the two, like the tabs' indicator. */}
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

/** How the links are sorted and grouped. */
export function DisplayButton({
  display,
  onChange,
}: {
  display: Display;
  onChange: (changes: Partial<Display>) => void;
}) {
  const id = useId();
  return (
    <Popover>
      <PopoverTrigger render={<IconButton label="Display options" />}>
        <SlidersHorizontalIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-3">
        <h3 className="font-medium">Display options</h3>
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-muted-foreground text-xs"
            htmlFor={`${id}-sort`}
          >
            Sort
          </Label>
          <Select
            items={SORTS}
            onValueChange={(next: Display["sort"] | null) => {
              if (next) {
                onChange({ sort: next });
              }
            }}
            value={display.sort}
          >
            <SelectTrigger className="w-full" id={`${id}-sort`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-muted-foreground text-xs"
            htmlFor={`${id}-group`}
          >
            Group by
          </Label>
          <Select
            items={GROUPS}
            onValueChange={(next: Display["group"] | null) => {
              if (next) {
                onChange({ group: next });
              }
            }}
            value={display.group}
          >
            <SelectTrigger className="w-full" id={`${id}-group`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUPS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}
