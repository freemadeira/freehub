import {
  BookmarkIcon,
  CheckCheckIcon,
  DownloadIcon,
  Settings2Icon,
} from "lucide-react";
import type { DragEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "wouter";

import { IconButton } from "@/components/icon-button";
import { ProjectAvatar } from "@/components/project-avatar";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import type {
  CatalogScope,
  ShownLink,
} from "@/features/catalogs/catalog-context";
import {
  CatalogContext,
  shownLinks,
} from "@/features/catalogs/catalog-context";
import { CatalogDialog } from "@/features/catalogs/catalog-dialog";
import {
  ActiveFilters,
  CategoryBar,
  DisplayButton,
  FilterButton,
  LayoutSwitch,
  SearchField,
} from "@/features/catalogs/catalog-toolbar";
import { catalogsPath, LINK_PARAM } from "@/features/catalogs/catalogs-context";
import { CategoriesDialog } from "@/features/catalogs/categories-dialog";
import type {
  Display,
  LinkFilters,
  LinkGroupOf,
  Shelf,
} from "@/features/catalogs/link-filters";
import {
  activeFilters,
  filterLinks,
  groupLinks,
  NO_FILTERS,
  sortLinks,
  useDisplay,
} from "@/features/catalogs/link-filters";
import { LinkLook } from "@/features/catalogs/link-look";
import { CategoryChip } from "@/features/catalogs/link-parts";
import {
  LinkGallery,
  LinkGroup,
  LinkList,
} from "@/features/catalogs/link-views";
import { PasteBox } from "@/features/catalogs/paste-box";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import { SelectionBar } from "@/features/catalogs/selection-bar";
import { PinButton } from "@/features/home/pin-controls";
import { useCatalogMarks, useLinkComments } from "@/hooks/use-catalogs";
import { useProfile } from "@/hooks/use-profile";
import type { Saved } from "@/lib/catalog-actions";
import { hasReader, markAllSeen, saveLinks } from "@/lib/catalog-actions";
import type { Catalog, CatalogsContent } from "@/lib/catalogs";
import { splitPasted } from "@/lib/catalogs";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";
import { isTyping } from "@/lib/utils";

/** Platforms an empty catalog shows, to say what it takes. */
const SHOWCASE = ["youtube", "tiktok", "x", "instagram", "spotify", "web"];

/** Where links would be: what a catalog takes, and how to start one off. */
function NoLinks({ editable }: { editable: boolean }) {
  return (
    <Empty className="py-16">
      <div aria-hidden className="mb-2 flex items-center -space-x-1.5">
        {SHOWCASE.map((platform, index) => (
          <span
            className="bg-card shadow-surface flex size-10 items-center justify-center rounded-full"
            key={platform}
            style={{ rotate: `${(index - 2.5) * 4}deg` }}
          >
            <PlatformIcon className="size-5" platform={platform} />
          </span>
        ))}
      </div>
      <EmptyTitle>
        {editable ? "Paste your first link" : "No links yet"}
      </EmptyTitle>
      <EmptyDescription className="max-w-sm text-balance">
        {editable
          ? `Videos, posts, articles, anything with an address.${hasReader() ? " Each one is read, then titled, summed up and filed for you." : ""}`
          : "Links saved here show up here."}
      </EmptyDescription>
    </Empty>
  );
}

function PersonName({ pubkey }: { pubkey: string }) {
  return useProfile(pubkey).name;
}

/** What heads a group of links, by what they're grouped by. */
function GroupTitle({ group }: { group: LinkGroupOf }) {
  if (group.category) {
    return <CategoryChip category={group.category} className="h-6 text-xs" />;
  }
  if (group.pubkey) {
    return (
      <span className="flex items-center gap-1.5">
        <UserAvatar aria-hidden pubkey={group.pubkey} size="xs" />
        <PersonName pubkey={group.pubkey} />
      </span>
    );
  }
  if (group.platform) {
    return (
      <span className="flex items-center gap-1.5">
        <PlatformIcon className="size-3.5" platform={group.platform} />
        {group.label}
      </span>
    );
  }
  return group.label;
}

/** Saves links dropped anywhere on the page, showing where they'll land meanwhile. */
function useDrop(project: Project, catalog: Catalog, editable: boolean) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const carries = (event: DragEvent) =>
    editable &&
    (event.dataTransfer.types.includes("text/uri-list") ||
      (event.dataTransfer.types.includes("text/plain") &&
        !event.dataTransfer.types.includes("Files")));
  return {
    over,
    props: {
      onDragEnter: (event: DragEvent) => {
        if (carries(event)) {
          depth.current += 1;
          setOver(true);
        }
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) {
          setOver(false);
        }
      },
      onDragOver: (event: DragEvent) => {
        if (carries(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      },
      onDrop: (event: DragEvent) => {
        depth.current = 0;
        setOver(false);
        if (!carries(event)) {
          return;
        }
        event.preventDefault();
        const text =
          event.dataTransfer.getData("text/uri-list") ||
          event.dataTransfer.getData("text/plain");
        if (splitPasted(text).links.length > 0) {
          saveLinks(project, catalog, text);
        }
      },
    },
  };
}

/** Saves links pasted anywhere on the page outside a field, straight away. */
function usePasteAnywhere(
  project: Project,
  catalog: Catalog,
  editable: boolean
) {
  useEffect(() => {
    if (!editable) {
      return;
    }
    const onPaste = (event: ClipboardEvent) => {
      // Fields and open dialogs take their own pastes.
      if (
        isTyping(event.target) ||
        document.querySelector("[role=dialog], [role=alertdialog]")
      ) {
        return;
      }
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (splitPasted(text).links.length > 0) {
        event.preventDefault();
        saveLinks(project, catalog, text);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [project, catalog, editable]);
}

/** The links picked, and picking them by Shift-clicking a range. */
function useSelection(shown: ShownLink[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const toggle = (link: ShownLink, range: boolean) => {
    const next = new Set(selected);
    const from = anchor.current
      ? shown.findIndex((item) => item.id === anchor.current)
      : -1;
    const to = shown.findIndex((item) => item.id === link.id);
    if (range && from !== -1 && to !== -1) {
      const [start, end] = from < to ? [from, to] : [to, from];
      for (const item of shown.slice(start, end + 1)) {
        next.add(item.id);
      }
    } else if (next.has(link.id)) {
      next.delete(link.id);
    } else {
      next.add(link.id);
    }
    anchor.current = link.id;
    setSelected(next);
  };
  const clear = () => {
    anchor.current = null;
    setSelected(new Set());
  };
  const all = () => setSelected(new Set(shown.map((link) => link.id)));
  return { all, clear, selected, toggle };
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Downloads the links shown as a CSV. */
function downloadCsv(catalog: Catalog, links: ShownLink[]) {
  const names = new Map(catalog.categories.map((c) => [c.id, c.name]));
  const rows = [
    [
      "Title",
      "URL",
      "Summary",
      "Categories",
      "Type",
      "Creator",
      "Published",
      "Note",
      "Saved",
    ],
    ...links.map((link) => [
      link.title,
      link.url,
      link.summary,
      link.categories
        .map((id) => names.get(id) ?? "")
        .filter(Boolean)
        .join(", "),
      link.type,
      link.byline?.name ?? "",
      link.publishedAt ?? "",
      link.note,
      new Date(link.savedAt * 1000).toISOString().slice(0, 10),
    ]),
  ];
  const csv = rows.map((row) => row.map(quote).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${catalog.title}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** The catalog's links as the page shows them: loading, empty, or in their layout. */
function CatalogBody({
  links,
  loaded,
  shown,
  groups,
  display,
  editable,
  onReset,
}: {
  links: ShownLink[];
  loaded: boolean;
  shown: ShownLink[];
  groups: LinkGroupOf[];
  display: Display;
  editable: boolean;
  /** Shows everything again, from whatever narrows it. */
  onReset: () => void;
}) {
  if (links.length === 0 && !loaded) {
    return (
      <div
        aria-busy
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
      >
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl max-md:hidden" />
        <Skeleton className="h-52 rounded-2xl max-xl:hidden" />
      </div>
    );
  }
  if (links.length === 0) {
    return <NoLinks editable={editable} />;
  }
  if (shown.length === 0) {
    return (
      <Empty className="py-12">
        <EmptyTitle>Nothing here matches</EmptyTitle>
        <Button onClick={onReset} variant="outline">
          Show everything
        </Button>
      </Empty>
    );
  }
  const View = display.layout === "list" ? LinkList : LinkGallery;
  if (display.group === "none") {
    return <View links={shown} />;
  }
  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <LinkGroup
          count={group.links.length}
          key={group.key}
          title={<GroupTitle group={group} />}
        >
          <View links={group.links} />
        </LinkGroup>
      ))}
    </div>
  );
}

/** The way back to the project, with what can be done to the catalog as a whole. */
function CatalogBar({
  project,
  catalog,
  alone,
  editable,
  fresh,
  links,
  onSettings,
}: {
  project: Project;
  catalog: Catalog;
  alone: boolean;
  editable: boolean;
  /** Whether any link is new to whoever's looking. */
  fresh: boolean;
  /** The links shown, as they're downloaded. */
  links: ShownLink[];
  onSettings: () => void;
}) {
  return (
    <TopBar
      crumbs={[
        {
          href: `/p/${project.slug}`,
          icon: <ProjectAvatar project={project} />,
          label: project.title,
        },
        ...(alone
          ? []
          : [
              {
                href: catalogsPath(project),
                icon: (
                  <BookmarkIcon className="text-muted-foreground size-4 shrink-0" />
                ),
                label: "Catalogs",
              },
            ]),
        { label: catalog.title },
      ]}
    >
      <FluidTooltip.Group>
        <PinButton
          pin={{ id: catalog.id, project: project.address, type: "catalog" }}
        />
        {fresh && (
          <IconButton
            label="Mark all as seen"
            onClick={() => markAllSeen(catalog)}
          >
            <CheckCheckIcon />
          </IconButton>
        )}
        <IconButton
          disabled={links.length === 0}
          label="Download as CSV"
          onClick={() => downloadCsv(catalog, links)}
        >
          <DownloadIcon />
        </IconButton>
        {editable && (
          <IconButton label="Catalog settings" onClick={onSettings}>
            <Settings2Icon />
          </IconButton>
        )}
      </FluidTooltip.Group>
    </TopBar>
  );
}

type Dialog = "details" | "categories";

/**
 * A catalog: where its links are pasted in, browsed by category, found by
 * search and filters, and opened one at a time over the rest.
 */
export function CatalogPage({
  project,
  catalog,
  content,
  loaded,
  pubkey,
  alone = false,
}: {
  project: Project;
  catalog: Catalog;
  /** The project's catalogs and links. */
  content: CatalogsContent;
  loaded: boolean;
  pubkey: string;
  /** The project's only catalog, with no list of them to go back to. */
  alone?: boolean;
}) {
  const editable = canEdit(project, pubkey);
  const manageable =
    editable && (catalog.creator === pubkey || project.creator === pubkey);
  const marks = useCatalogMarks(pubkey);
  const comments = useLinkComments(project, new Set(content.linkById.keys()));
  const links = shownLinks(
    catalog,
    content.linksIn.get(catalog.id) ?? [],
    marks,
    comments,
    pubkey
  );
  const [params, setParams] = useSearchParams();
  const [shelf, setShelf] = useState<Shelf>("all");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<LinkFilters>(NO_FILTERS);
  const [display, setDisplay] = useDisplay(catalog.id);
  const [dialog, setDialog] = useState<Dialog>();
  usePasteAnywhere(project, catalog, editable);
  const drop = useDrop(project, catalog, editable);

  const shown = sortLinks(
    filterLinks(links, { filters, search, shelf }),
    display.sort
  );
  const groups = groupLinks(shown, display.group, catalog);
  // The order links step in, as they're shown, each once.
  const order = [
    ...new Map(
      groups.flatMap((group) => group.links).map((link) => [link.id, link])
    ).values(),
  ];
  const selection = useSelection(order);
  const openId = params.get(LINK_PARAM) ?? undefined;

  const open = (link?: ShownLink) => {
    setParams(link ? { [LINK_PARAM]: link.id } : {}, {
      replace: Boolean(openId && link),
    });
  };

  // Escape lets go of what's picked; ⌘A picks everything shown.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || openId) {
        return;
      }
      if (event.key === "Escape" && selection.selected.size > 0) {
        selection.clear();
      } else if (
        editable &&
        event.key === "a" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        selection.all();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  // Once a just-saved link the catalog had already is found, it opens.
  const onSaved = (saved: Saved) => {
    const [existing] = saved.existing;
    if (saved.added.length === 0 && existing && saved.existing.length === 1) {
      setParams({ [LINK_PARAM]: existing });
    }
  };

  const scope: CatalogScope = {
    canEdit: editable,
    catalog,
    categories: new Map(catalog.categories.map((c) => [c.id, c])),
    links,
    me: pubkey,
    open: (link) => open(link),
    project,
    selected: selection.selected,
    toggle: selection.toggle,
  };

  const narrowed =
    shelf !== "all" || search.trim() !== "" || activeFilters(filters) > 0;
  const reset = () => {
    setShelf("all");
    setSearch("");
    setFilters(NO_FILTERS);
  };

  return (
    <CatalogContext value={scope}>
      <CatalogBar
        alone={alone}
        catalog={catalog}
        editable={editable}
        fresh={links.some((link) => link.isNew)}
        links={order}
        onSettings={() => setDialog("details")}
        project={project}
      />
      <main
        className="relative mx-auto flex w-full max-w-[100rem] grow flex-col gap-4 px-4 pt-2 pb-28 sm:px-6"
        {...drop.props}
      >
        {catalog.description && (
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            {catalog.description}
          </p>
        )}
        {(editable || links.length > 0) && (
          // The box to paste into, with how to look through what's saved beside it.
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            {editable && (
              <PasteBox
                autoFocus={loaded && links.length === 0}
                catalog={catalog}
                className="min-w-0 flex-1 basis-96"
                onSaved={onSaved}
                project={project}
              />
            )}
            {links.length > 0 && (
              <div className="flex h-12 items-center gap-1.5 max-sm:w-full sm:ml-auto">
                <SearchField onChange={setSearch} value={search} />
                <FluidTooltip.Group>
                  <FilterButton
                    filters={filters}
                    links={links}
                    onChange={setFilters}
                  />
                  <LayoutSwitch
                    onChange={(layout) => setDisplay({ layout })}
                    value={display.layout}
                  />
                  <DisplayButton display={display} onChange={setDisplay} />
                </FluidTooltip.Group>
              </div>
            )}
          </div>
        )}
        {links.length > 0 && (
          <CategoryBar
            className="-mx-4 px-4 sm:-mx-6 sm:px-6"
            links={links}
            onManage={editable ? () => setDialog("categories") : undefined}
            onShelfChange={setShelf}
            shelf={shelf}
          />
        )}
        <ActiveFilters filters={filters} onChange={setFilters} />
        {narrowed && shown.length > 0 && (
          <p className="text-muted-foreground -mt-1 text-xs tabular-nums">
            {shown.length} of {links.length}
          </p>
        )}
        <CatalogBody
          display={display}
          editable={editable}
          groups={groups}
          links={links}
          loaded={loaded}
          onReset={reset}
          shown={shown}
        />
        {drop.over && (
          <div
            aria-hidden
            className="border-primary bg-primary/5 pointer-events-none absolute inset-2 z-20 flex items-start justify-center rounded-3xl border-2 border-dashed pt-24"
          >
            <span className="bg-primary text-primary-foreground shadow-raised rounded-full px-4 py-2 text-sm font-medium">
              Drop to save
            </span>
          </div>
        )}
      </main>
      <SelectionBar onClear={() => selection.clear()} />
      <LinkLook
        comments={comments}
        linkId={openId}
        links={order}
        onNavigate={(link) => open(link)}
      />
      {editable && (
        <>
          <CatalogDialog
            catalog={catalog}
            manageable={manageable}
            onOpenChange={(next) => setDialog(next ? "details" : undefined)}
            open={dialog === "details"}
            project={project}
          />
          <CategoriesDialog
            catalog={catalog}
            onOpenChange={(next) => setDialog(next ? "categories" : undefined)}
            open={dialog === "categories"}
            project={project}
          />
        </>
      )}
    </CatalogContext>
  );
}
