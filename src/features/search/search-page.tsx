import { Autocomplete } from "@base-ui/react/autocomplete";
import {
  ArrowRightIcon,
  CommandIcon,
  HistoryIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useDeferredValue, useEffect, useEffectEvent, useState } from "react";
import { useSearchParams } from "wouter";

import { usePlaces } from "@/components/app-link";
import { ProjectAvatar } from "@/components/project-avatar";
import { TopBar } from "@/components/top-bar";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useOpenPalette } from "@/features/palette/palette-context";
import { ICON, matching, usePlaceItems } from "@/features/search/items";
import { useRecentItems } from "@/features/search/recent-items";
import type { SearchGroup, SearchItem } from "@/features/search/search-item";
import { SearchList } from "@/features/search/search-list";
import type { SearchChip } from "@/features/search/search-path";
import { searchQuery } from "@/features/search/search-path";
import type { Found, SearchIndex } from "@/features/search/use-found";
import { useFound, useSearchIndex } from "@/features/search/use-found";
import { useSettled } from "@/hooks/use-settled";
import type { Project } from "@/lib/project";
import { forgetSearches, markSearched, useRecents } from "@/lib/recents";
import type { SearchKind } from "@/lib/search";
import { SEARCH_KINDS, searchTerms } from "@/lib/search";

/** How long typing rests before the link follows it. */
const LINK_DELAY = 400;
/** How many of each kind a search of everything shows before "See all". */
const PER_GROUP = 5;

const KINDS: Record<SearchKind, { label: string; plural: string }> = {
  card: { label: "Cards", plural: "cards" },
  comment: { label: "Comments", plural: "comments" },
  doc: { label: "Docs", plural: "docs" },
  file: { label: "Files", plural: "files" },
  record: { label: "Records", plural: "records" },
};

function parseChip(value: string | null): SearchChip {
  return SEARCH_KINDS.find((kind) => kind === value) ?? "all";
}

/** Whether the item is in the project a search is narrowed to, if it is. */
function inScope(project?: Project) {
  return (item: SearchItem) => !project || item.project === project.address;
}

/** What shows before anything's typed: the latest searches, and places opened lately. */
function useRecentGroups(
  pubkey: string,
  index: SearchIndex,
  project: Project | undefined,
  onSearch: (words: string) => void
): SearchGroup[] {
  const { searches } = useRecents(pubkey);
  const places = useRecentItems(pubkey, usePlaceItems(), index);
  return [
    {
      action: (
        <button
          className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          onClick={() => forgetSearches(pubkey)}
          type="button"
        >
          Clear history
        </button>
      ),
      items: searches.map((words) => ({
        icon: <HistoryIcon className={ICON} />,
        key: `search:${words}`,
        run: () => onSearch(words),
        title: words,
      })),
      label: "Recent searches",
      value: "searches",
    },
    {
      items: places.filter(inScope(project)),
      label: "Recently opened",
      value: "opened",
    },
  ];
}

/**
 * What a search found, by kind: places by name first, then what's in cards,
 * docs, records, files and comments. Searching everything shows a few of
 * each, with a way to see the rest of a kind.
 */
function useFoundGroups({
  chip,
  project,
  terms,
  found,
  onChip,
}: {
  chip: SearchChip;
  project?: Project;
  terms: string[];
  found: Found;
  onChip: (chip: SearchChip) => void;
}): SearchGroup[] {
  const places = usePlaceItems().filter(inScope(project));
  const all = chip === "all";
  const group = (kind: SearchKind): SearchGroup => {
    const { label, plural } = KINDS[kind];
    const list = found[kind];
    if (!all || list.length <= PER_GROUP) {
      return { items: list, label, value: kind };
    }
    const more: SearchItem = {
      icon: <ArrowRightIcon className={ICON} />,
      key: `more:${kind}`,
      run: () => onChip(kind),
      title: `See all ${plural}`,
    };
    return { items: [...list.slice(0, PER_GROUP), more], label, value: kind };
  };
  return [
    {
      items: all ? matching(places, terms).slice(0, PER_GROUP) : [],
      label: "Places",
      value: "places",
    },
    ...SEARCH_KINDS.map(group),
  ];
}

function ProjectFilter({
  value,
  onChange,
}: {
  value?: string;
  onChange: (slug?: string) => void;
}) {
  const { projects } = usePlaces();
  const chosen = projects.find((project) => project.slug === value);
  return (
    <Select
      onValueChange={(slug: string | null) => onChange(slug || undefined)}
      value={chosen?.slug ?? ""}
    >
      <SelectTrigger
        aria-label="Project"
        className="bg-foreground/5 hover:bg-foreground/10 data-popup-open:bg-foreground/10 h-7 max-w-48 gap-1.5 rounded-full border-0 px-3 text-xs font-medium"
      >
        <SelectValue>
          {chosen ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <ProjectAvatar className="size-4" project={chosen} />
              <span className="truncate">{chosen.title}</span>
            </span>
          ) : (
            "Every project"
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="max-h-80 min-w-52">
        <SelectItem value="">Every project</SelectItem>
        {projects.map((project) => (
          <SelectItem key={project.address} value={project.slug}>
            <ProjectAvatar className="size-4" project={project} />
            <span className="truncate">{project.title}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SearchField({
  text,
  busy,
  onChange,
}: {
  text: string;
  /** Whether what's searched is still coming in from the relays. */
  busy: boolean;
  onChange: (text: string) => void;
}) {
  const openPalette = useOpenPalette();
  return (
    <InputGroup className="shadow-surface dark:bg-card h-12 rounded-xl border-0">
      <InputGroupAddon className="pr-1.5 pl-4">
        <SearchIcon aria-hidden className="size-5" />
      </InputGroupAddon>
      <Autocomplete.Input
        aria-label="Search"
        autoCapitalize="off"
        autoCorrect="off"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the page is for searching
        autoFocus
        data-page-search
        enterKeyHint="search"
        onKeyDown={(event) => {
          if (event.key !== "Escape") {
            return;
          }
          if (text) {
            onChange("");
          } else {
            event.currentTarget.blur();
          }
        }}
        placeholder="Search cards, docs, records and more…"
        render={<InputGroupInput className="h-full text-base md:text-base" />}
        spellCheck={false}
      />
      <InputGroupAddon align="inline-end" className="gap-1 pr-3">
        {busy && <Spinner className="size-4" />}
        {text && (
          <InputGroupButton
            aria-label="Clear search"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onChange("")}
            size="icon-xs"
          >
            <XIcon className="size-4" />
          </InputGroupButton>
        )}
        {/* Phones have no keyboard to open the palette with. */}
        <InputGroupButton
          aria-label="Command palette"
          className="text-muted-foreground hover:text-foreground pointer-fine:hidden"
          onClick={() => openPalette()}
          size="icon-sm"
        >
          <CommandIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

function KindChips({
  value,
  onChange,
}: {
  value: SearchChip;
  onChange: (chip: SearchChip) => void;
}) {
  return (
    <ToggleGroup
      aria-label="What to search"
      // One row, sliding sideways where the screen is too narrow for it.
      className="-my-1 min-w-0 flex-1 scrollbar-none gap-1 overflow-x-auto py-1"
      onValueChange={(next) => {
        // Pressing the chip that's on again leaves it on.
        if (next[0]) {
          onChange(next[0] as SearchChip);
        }
      }}
      value={[value]}
    >
      {(["all", ...SEARCH_KINDS] as const).map((chip) => (
        <ToggleGroupItem
          className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground data-pressed:bg-foreground/10 data-pressed:text-foreground h-7 shrink-0 rounded-full px-3 text-xs font-medium transition-colors duration-150"
          key={chip}
          // Typing goes on in the field after a click.
          onMouseDown={(event) => event.preventDefault()}
          value={chip}
        >
          {chip === "all" ? "All" : KINDS[chip].label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Everything the team wrote, searched from one field: places by name, and what's in cards, docs, records, files and comments. */
export function SearchPage({ pubkey }: { pubkey: string }) {
  const [params, setParams] = useSearchParams();
  const { projects } = usePlaces();
  const linked = params.get("q") ?? "";
  const [text, setText] = useState(linked);
  const chip = parseChip(params.get("in"));
  const project = projects.find((each) => each.slug === params.get("project"));
  const settled = useSettled(text, LINK_DELAY);
  const { index, loading } = useSearchIndex();
  // The field keeps up with every key; what's found follows.
  const typed = useDeferredValue(text);
  const terms = searchTerms(text);
  const found = useFound(index, searchTerms(typed), typed, {
    kind: chip === "all" ? undefined : chip,
    project: project?.address,
  });

  // A link to another search, like one from the command palette, brings its words.
  const [seen, setSeen] = useState(linked);
  if (linked !== seen) {
    setSeen(linked);
    if (linked !== settled) {
      setText(linked);
    }
  }

  const narrow = (next: { chip?: SearchChip; project?: string }) =>
    setParams(
      searchQuery(
        text.trim(),
        next.chip ?? chip,
        "project" in next ? next.project : project?.slug
      ),
      { replace: true }
    );

  // The link keeps up with the words as they settle, so a search can be
  // shared or reloaded.
  const keepLink = useEffectEvent((words: string) => {
    if (linked !== words) {
      setParams(searchQuery(words, chip, project?.slug), { replace: true });
    }
  });
  useEffect(() => keepLink(settled), [settled]);

  const recent = useRecentGroups(pubkey, index, project, setText);
  const results = useFoundGroups({
    chip,
    found,
    onChip: (next) => narrow({ chip: next }),
    project,
    terms,
  });
  const groups = (terms.length > 0 ? results : recent).filter(
    (group) => group.items.length > 0
  );

  // Places open as links; this keeps the words that found them.
  const open = (item: SearchItem, event: Event) => {
    if (item.run) {
      item.run(event);
    } else if (terms.length > 0) {
      markSearched(pubkey, text);
    }
  };

  let empty: string | undefined;
  if (groups.length === 0 && !(loading && terms.length > 0)) {
    empty =
      terms.length > 0
        ? `Nothing found for “${text.trim()}”${project ? ` in ${project.title}` : ""}.`
        : "Find cards, docs, records, files and comments in every project, and any place by its name.";
  }

  return (
    <>
      <TopBar
        crumbs={[
          {
            icon: <SearchIcon className={ICON} />,
            label: "Search",
          },
        ]}
      />
      <main className="mx-auto flex w-full max-w-3xl grow flex-col gap-3 px-4 pt-4 pb-10 sm:px-6 sm:pt-8">
        <Autocomplete.Root
          autoHighlight
          filter={null}
          inline
          itemToStringValue={(item: SearchItem) => item.title}
          items={groups}
          onValueChange={(value, details) => {
            // Opening an item would put its title in the field; the words stay.
            if (details.reason !== "item-press") {
              setText(value);
            }
          }}
          open
          value={text}
        >
          <SearchField
            busy={loading && terms.length > 0}
            onChange={setText}
            text={text}
          />
          <div className="flex items-center gap-2">
            <KindChips
              onChange={(next) => narrow({ chip: next })}
              value={chip}
            />
            <div className="shrink-0">
              <ProjectFilter
                onChange={(slug) => narrow({ project: slug })}
                value={project?.slug}
              />
            </div>
          </div>
          <SearchList className="-mx-3" onOpen={open} terms={terms} />
        </Autocomplete.Root>
        {empty && (
          <p className="text-muted-foreground px-1 py-12 text-center text-sm text-balance">
            {empty}
          </p>
        )}
      </main>
    </>
  );
}
