import { Autocomplete } from "@base-ui/react/autocomplete";
import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  BookmarkPlusIcon,
  CheckIcon,
  FilePlusIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  KeyboardIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  NewspaperIcon,
  PanelLeftIcon,
  SearchIcon,
  SquareKanbanIcon,
  SquarePenIcon,
  SunIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useDeferredValue, useState } from "react";
import { useLocation } from "wouter";

import { usePlaces } from "@/components/app-link";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useSidebar } from "@/components/ui/sidebar";
import { postPath } from "@/features/blog/blog-context";
import { pagePath } from "@/features/docs/docs-context";
import { usePageCommandGroups } from "@/features/palette/page-commands";
import type { PaletteStart, Picker } from "@/features/palette/palette-context";
import { distinct, matching, usePlaceItems } from "@/features/search/items";
import { useRecentItems } from "@/features/search/recent-items";
import { ICON } from "@/features/search/search-item";
import type {
  SearchGroup,
  SearchItem,
  SearchPage,
} from "@/features/search/search-item";
import { SearchList } from "@/features/search/search-list";
import { SEARCH_PATH, searchHref } from "@/features/search/search-path";
import type { SearchIndex } from "@/features/search/use-found";
import { useFound, useSearchIndex } from "@/features/search/use-found";
import { useObservableValue } from "@/hooks/use-observable-value";
import { createPost, websiteOf } from "@/lib/blog-actions";
import { EMPTY_DOCS } from "@/lib/docs";
import { createPage } from "@/lib/docs-actions";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";
import { markSearched } from "@/lib/recents";
import { searchTerms } from "@/lib/search";
import { PROJECT_KEYS, SHORTCUTS } from "@/lib/shortcuts";
import type { Theme } from "@/lib/theme";
import { setTheme, theme$ } from "@/lib/theme";

/** What the palette needs from the app around it. */
export interface PaletteCommands {
  pubkey: string;
  canAddCards: boolean;
  newCard: () => void;
  newProject: () => void;
  /** Only when there's a catalog the person can save links to. */
  saveLink?: () => void;
  showShortcuts: () => void;
  logOut: () => void;
  /** The project in view: where Docs, Drive and new pages go. */
  here?: Project;
}

/** How many of each kind show while typing; the search page has the rest. */
const FEW = 3;
const PLACES_SHOWN = 5;
const COMMANDS_SHOWN = 6;
const RECENT_SHOWN = 5;

const THEMES: { value: Theme; label: string; icon: ReactNode }[] = [
  { icon: <SunIcon className={ICON} />, label: "Light", value: "light" },
  { icon: <MoonIcon className={ICON} />, label: "Dark", value: "dark" },
  { icon: <MonitorIcon className={ICON} />, label: "System", value: "system" },
];

/** Kinds of items found in what the team wrote, whose searches are worth keeping. */
const FOUND = /^(?:card|doc|post|record|file|link|comment):/u;

function few(items: SearchItem[]): SearchItem[] {
  return items.slice(0, FEW);
}

interface AppGroups {
  create: SearchItem[];
  /** Places to go, with their shortcuts. */
  go: SearchItem[];
  app: SearchItem[];
  pickers: Record<Picker, SearchPage>;
}

/** The palette's own commands, in groups, given what it can reach. */
function useAppGroups(
  commands: PaletteCommands,
  places: SearchItem[]
): AppGroups {
  const [, navigate] = useLocation();
  const { toggleSidebar } = useSidebar();
  const { docs } = usePlaces();
  const theme = useObservableValue(theme$);
  const { here, pubkey } = commands;

  const pickers: Record<Picker, SearchPage> = {
    boards: {
      items: () => places.filter((place) => place.key.startsWith("board:")),
      placeholder: "Find a board…",
      title: "Boards",
    },
    projects: {
      // ⌘1 to ⌘9 go to the first nine, in this same order.
      items: () =>
        places
          .filter((place) => place.key.startsWith("project:"))
          .map((project, index) => ({ ...project, keys: PROJECT_KEYS[index] })),
      placeholder: "Find a project…",
      title: "Projects",
    },
  };

  const create: SearchItem[] = [];
  if (commands.canAddCards) {
    create.push({
      icon: <SquarePenIcon className={ICON} />,
      key: "new-card",
      keys: SHORTCUTS["card.new"],
      keywords: "add create task issue",
      run: commands.newCard,
      title: "New card",
    });
  }
  if (here && canEdit(here, pubkey)) {
    create.push({
      context: here.title,
      icon: <FilePlusIcon className={ICON} />,
      key: "new-page",
      keywords: "add create doc document note",
      run: () => {
        const { id } = createPage(here, docs.get(here.address) ?? EMPTY_DOCS);
        navigate(pagePath(here, { id, title: "" }));
      },
      title: "New page",
    });
  }
  const website = here && websiteOf(here);
  if (here && website && canEdit(here, pubkey)) {
    create.push({
      context: website.name,
      icon: <NewspaperIcon className={ICON} />,
      key: "new-post",
      keywords: "add create blog article write website",
      run: () => {
        const { id } = createPost(here, website);
        navigate(postPath(here, { id }));
      },
      title: "New post",
    });
  }
  if (commands.saveLink) {
    create.push({
      icon: <BookmarkPlusIcon className={ICON} />,
      key: "save-link",
      keywords:
        "add bookmark catalog url youtube tiktok video post article paste",
      run: commands.saveLink,
      title: "Save link…",
    });
  }
  create.push({
    icon: <FolderPlusIcon className={ICON} />,
    key: "new-project",
    keywords: "add create",
    run: commands.newProject,
    title: "New project…",
  });

  // The app's own pages, then the Docs and Drive of the project in view.
  const appPages = places.filter((place) => !place.project);
  const hereKeys = here
    ? {
        [`docs:${here.address}`]: SHORTCUTS["go.docs"],
        [`drive:${here.address}`]: SHORTCUTS["go.drive"],
      }
    : {};
  const herePages = places.flatMap((place) => {
    const keys = hereKeys[place.key];
    return keys ? [{ ...place, keys }] : [];
  });
  const go: SearchItem[] = [
    {
      icon: <FolderOpenIcon className={ICON} />,
      key: "go-project",
      keys: SHORTCUTS["go.project"],
      keywords: "go to open switch",
      page: pickers.projects,
      title: "Go to project…",
    },
    {
      icon: <SquareKanbanIcon className={ICON} />,
      key: "go-board",
      keys: SHORTCUTS["go.board"],
      keywords: "go to open switch",
      page: pickers.boards,
      title: "Go to board…",
    },
    ...appPages,
    ...herePages,
  ];

  const app: SearchItem[] = [
    {
      href: SEARCH_PATH,
      icon: <SearchIcon className={ICON} />,
      key: "search",
      keys: SHORTCUTS["search.open"],
      keywords: "find",
      title: "Search everything",
    },
    {
      icon: <PanelLeftIcon className={ICON} />,
      key: "sidebar",
      keys: SHORTCUTS["sidebar.toggle"],
      keywords: "toggle hide show collapse expand",
      run: toggleSidebar,
      title: "Show or hide the sidebar",
    },
    {
      icon: <MoonIcon className={ICON} />,
      key: "theme",
      keywords: "appearance dark light mode color",
      page: {
        items: () =>
          THEMES.map(({ value, label, icon }) => ({
            context: value === theme ? "Now" : undefined,
            icon: value === theme ? <CheckIcon className={ICON} /> : icon,
            key: `theme:${value}`,
            run: (event: Event) => setTheme(value, event),
            title: label,
          })),
        placeholder: "Pick a theme…",
        title: "Theme",
      },
      title: "Change theme…",
    },
    {
      icon: <KeyboardIcon className={ICON} />,
      key: "shortcuts",
      keys: SHORTCUTS["shortcuts.show"],
      keywords: "help keys hotkeys",
      run: commands.showShortcuts,
      title: "Keyboard shortcuts",
    },
    {
      icon: <LogOutIcon className={ICON} />,
      key: "log-out",
      keywords: "sign out leave",
      run: commands.logOut,
      title: "Log out",
    },
  ];
  return { app, create, go, pickers };
}

/**
 * What the palette lists while something's typed: places, commands, then
 * what the team wrote, a few of each, and the way to the rest.
 */
function useFoundGroups(
  text: string,
  index: SearchIndex,
  { create, go, app }: AppGroups,
  { places, pageItems }: { places: SearchItem[]; pageItems: SearchItem[] }
): SearchGroup[] {
  // Places and commands keep up with every key; what's inside follows.
  const typed = useDeferredValue(text);
  const terms = searchTerms(text);
  const found = useFound(index, searchTerms(typed), typed);
  const commands = matching(
    distinct([
      ...pageItems,
      ...create,
      ...go.filter((item) => item.page),
      ...app,
    ]),
    terms
  ).slice(0, COMMANDS_SHOWN);
  const words = text.trim();
  return [
    {
      items: matching(places, terms).slice(0, PLACES_SHOWN),
      label: "Go to",
      value: "go",
    },
    { items: commands, label: "Commands", value: "commands" },
    { items: few(found.card), label: "Cards", value: "cards" },
    { items: few(found.doc), label: "Docs", value: "docs" },
    { items: few(found.post), label: "Posts", value: "posts" },
    { items: few(found.record), label: "Records", value: "records" },
    { items: few(found.file), label: "Files", value: "files" },
    { items: few(found.link), label: "Links", value: "links" },
    { items: few(found.comment), label: "Comments", value: "comments" },
    {
      items: [
        {
          href: searchHref(words),
          icon: <SearchIcon className={ICON} />,
          key: "search-all",
          title: `Search everything for “${words}”`,
        },
      ],
      label: "Search",
      value: "search",
    },
  ];
}

function PaletteBody({
  start,
  commands,
  onClose,
}: {
  start?: PaletteStart;
  commands: PaletteCommands;
  onClose: () => void;
}) {
  const places = usePlaceItems();
  const groups = useAppGroups(commands, places);
  const pageGroups = usePageCommandGroups();
  const { index } = useSearchIndex();
  const recent = useRecentItems(commands.pubkey, places, index);
  const [text, setText] = useState("");
  const [page, setPage] = useState<SearchPage | undefined>(() =>
    typeof start === "string" ? groups.pickers[start] : start
  );
  const terms = searchTerms(text);
  const typing = terms.length > 0;
  const found = useFoundGroups(page ? "" : text, index, groups, {
    pageItems: pageGroups.flatMap((group) => group.items),
    places,
  });

  let shown: SearchGroup[];
  if (page) {
    const items = page.items();
    shown = [
      {
        items: typing ? matching(items, terms) : items,
        label: page.title,
        quiet: true,
        value: "page",
      },
    ];
  } else if (typing) {
    shown = found;
  } else {
    shown = [
      ...pageGroups.map(({ id, title, items }) => ({
        items,
        label: title,
        value: `page:${id}`,
      })),
      {
        items: recent.slice(0, RECENT_SHOWN),
        label: "Recent",
        value: "recent",
      },
      { items: groups.create, label: "Create", value: "create" },
      { items: groups.go, label: "Go to", value: "go" },
      { items: groups.app, label: "App", value: "app" },
    ];
  }
  shown = shown.filter((group) => group.items.length > 0);

  const open = (item: SearchItem, event: Event) => {
    if (item.page) {
      setPage(item.page);
      setText("");
      return;
    }
    // While its row is still on screen: a theme spreads out from it.
    if (item.run) {
      item.run(event);
    } else if (!page && typing && FOUND.test(item.key)) {
      // Places open as links; this keeps the words that found them.
      markSearched(commands.pubkey, text);
    }
    onClose();
  };

  return (
    <Autocomplete.Root
      autoHighlight="always"
      filter={null}
      inline
      itemToStringValue={(item: SearchItem) => item.title}
      items={shown}
      onValueChange={(value, details) => {
        // Opening an item would put its title in the field.
        if (details.reason !== "item-press") {
          setText(value);
        }
      }}
      open
      value={text}
    >
      <div className="flex items-center gap-2 border-b px-4">
        <SearchIcon
          aria-hidden
          className="text-muted-foreground size-4 shrink-0"
        />
        {page && (
          <span className="bg-foreground/5 text-muted-foreground flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium">
            {page.title}
          </span>
        )}
        <Autocomplete.Input
          aria-label={page ? page.placeholder : "Command or search"}
          autoCapitalize="off"
          autoCorrect="off"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the palette is for typing
          autoFocus
          className="placeholder:text-muted-foreground h-13 min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
          onKeyDown={(event) => {
            // Backspace in an empty field goes back out of the list.
            if (event.key === "Backspace" && !text && page) {
              event.preventDefault();
              setPage(undefined);
            }
          }}
          placeholder={page ? page.placeholder : "Type a command or search…"}
          spellCheck={false}
        />
      </div>
      <div className="max-h-[min(26rem,60dvh)] overflow-y-auto overscroll-contain p-1.5">
        <SearchList onOpen={open} terms={terms} />
        <Autocomplete.Empty className="text-muted-foreground px-4 py-10 text-center text-sm empty:hidden">
          Nothing matches.
        </Autocomplete.Empty>
      </div>
      <div className="text-muted-foreground flex items-center gap-4 border-t px-4 py-2 text-xs pointer-coarse:hidden">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          Move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          Open
        </span>
        {page && (
          <span className="flex items-center gap-1.5">
            <Kbd>⌫</Kbd>
            Back
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          Close
        </span>
      </div>
    </Autocomplete.Root>
  );
}

/**
 * Commands, places and what the team wrote, found by typing: the quickest
 * way anywhere. Opens on Ctrl or ⌘ K, or straight into a list, like projects.
 */
export function CommandPalette({
  open,
  session,
  start,
  commands,
  onOpenChange,
  finalFocus,
}: {
  open: boolean;
  /** Which time it's opened; each starts afresh, even while the last is still closing. */
  session: number;
  start?: PaletteStart;
  commands: PaletteCommands;
  onOpenChange: (open: boolean) => void;
  finalFocus?: DialogPrimitive.Popup.Props["finalFocus"];
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="top-[12vh] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0"
        finalFocus={finalFocus}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <PaletteBody
          commands={commands}
          key={session}
          onClose={() => onOpenChange(false)}
          start={start}
        />
      </DialogContent>
    </Dialog>
  );
}
