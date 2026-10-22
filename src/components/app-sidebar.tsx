import {
  BookmarkIcon,
  ChevronRightIcon,
  HouseIcon,
  InboxIcon,
  KanbanIcon,
  MapIcon,
  PlusIcon,
  SearchIcon,
  SquareArrowOutUpRightIcon,
  SquareKanbanIcon,
  SquarePenIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

import { IconButton } from "@/components/icon-button";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/nav-link";
import { ProjectAvatar } from "@/components/project-avatar";
import { KeyHint } from "@/components/shortcut-keys";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/components/user-menu";
import { getConfig } from "@/config";
import { boardPath, useOpenBoard } from "@/features/board/board-context";
import { BOARDS_PATH } from "@/features/boards/boards-page";
import { countNew } from "@/features/catalogs/catalog-context";
import { catalogPath } from "@/features/catalogs/catalogs-context";
import { TableIcon } from "@/features/crm/table-icon";
import { SidebarDocs } from "@/features/docs/sidebar-docs";
import { SidebarDrive } from "@/features/drive/sidebar-drive";
import { PinMenuItem } from "@/features/home/pin-controls";
import { INBOX_PATH } from "@/features/inbox/inbox-page";
import { MAP_PATH } from "@/features/map/map-path";
import { SEARCH_PATH } from "@/features/search/search-path";
import { useAppCommands } from "@/features/shortcuts/app-commands";
import { useCatalogMarks } from "@/hooks/use-catalogs";
import type { CatalogsDoc } from "@/lib/catalog-marks";
import type { CatalogsContent } from "@/lib/catalogs";
import { EMPTY_CATALOGS } from "@/lib/catalogs";
import type { CrmTable } from "@/lib/crm";
import type { DocsContent } from "@/lib/docs";
import { EMPTY_DOCS } from "@/lib/docs";
import type { DriveTree } from "@/lib/drive";
import { EMPTY_TREE } from "@/lib/drive";
import type { Pin } from "@/lib/home";
import { pinKey } from "@/lib/home";
import type { Board } from "@/lib/model";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";
import { inProject, outsideProjects } from "@/lib/project";
import { SHORTCUTS } from "@/lib/shortcuts";
import { readStorage, writeStorage } from "@/lib/utils";

/** Projects shown open until the user folds them. */
const OPEN_BY_DEFAULT = 3;
const MAX_BADGE = 99;

/** Projects opened or folded by address, as kept on this device. */
function readOpened(key: string): Record<string, boolean> {
  const raw = readStorage(key);
  if (raw === null) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

/** What each item in the sidebar pins to Home, by the key its `data-pin` holds. */
function sidebarPins(
  projects: Project[],
  boards: Board[],
  tables: Map<string, CrmTable[]>,
  docs: Map<string, DocsContent>,
  catalogs: Map<string, CatalogsContent>
): Map<string, Pin> {
  const pins: Pin[] = [
    ...projects.map((project): Pin => ({
      address: project.address,
      type: "project",
    })),
    ...boards.map((board): Pin => ({ address: board.address, type: "board" })),
    ...[...tables.values()]
      .flat()
      .map((table): Pin => ({ address: table.address, type: "table" })),
    ...[...docs].flatMap(([project, content]) =>
      content.pages.map((page): Pin => ({ id: page.id, project, type: "page" }))
    ),
    ...[...catalogs].flatMap(([project, content]) =>
      content.catalogs.map((catalog): Pin => ({
        id: catalog.id,
        project,
        type: "catalog",
      }))
    ),
  ];
  return new Map(pins.map((pin) => [pinKey(pin), pin]));
}

interface ProjectItemProps {
  project: Project;
  tables: CrmTable[];
  docs: DocsContent;
  /** This project's catalogs and links. */
  catalogs: CatalogsContent;
  /** What the person has seen of catalogs, for how many links are new to them. */
  marks: CatalogsDoc;
  /** This project's Drive folders, or nothing when the team keeps no files. */
  drive?: DriveTree;
  /** This project's boards. */
  boards: Board[];
  /** Every board, to tell apart boards sharing a code. */
  allBoards: Board[];
  openBoard?: Board;
  location: string;
  pubkey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ProjectItem({
  project,
  tables,
  docs,
  catalogs,
  marks,
  drive,
  boards,
  allBoards,
  openBoard,
  location,
  pubkey,
  open,
  onOpenChange,
}: ProjectItemProps) {
  const base = `/p/${project.slug}`;
  return (
    <Collapsible
      onOpenChange={onOpenChange}
      open={open}
      render={<SidebarMenuItem />}
    >
      <SidebarMenuButton
        data-pin={pinKey({ address: project.address, type: "project" })}
        isActive={location === base}
        render={<NavLink href={base} />}
      >
        <ProjectAvatar project={project} />
        <span>{project.title}</span>
      </SidebarMenuButton>
      <CollapsibleTrigger
        render={
          <SidebarMenuAction
            aria-label={`${open ? "Collapse" : "Expand"} ${project.title}`}
            className="[&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:ease-out data-panel-open:[&>svg]:rotate-90"
          />
        }
      >
        <ChevronRightIcon />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub className="pt-0.5">
          {tables.map((table) => {
            const href = `${base}/${table.slug}`;
            return (
              <SidebarMenuSubItem key={table.id}>
                <SidebarMenuSubButton
                  data-pin={pinKey({ address: table.address, type: "table" })}
                  isActive={
                    location === href || location.startsWith(`${href}/`)
                  }
                  render={<NavLink href={href} />}
                >
                  <TableIcon icon={table.icon} />
                  <span>{table.title}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
          {boards.map((board) => (
            <SidebarMenuSubItem key={board.address}>
              <SidebarMenuSubButton
                data-pin={pinKey({ address: board.address, type: "board" })}
                isActive={board === openBoard}
                render={<NavLink href={boardPath(board, allBoards)} />}
              >
                <SquareKanbanIcon />
                <span>{board.title}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
          {catalogs.catalogs.map((catalog) => {
            const href = catalogPath(project, catalog);
            const fresh = countNew(
              catalog,
              catalogs.linksIn.get(catalog.id) ?? [],
              marks,
              pubkey
            );
            return (
              <SidebarMenuSubItem key={catalog.id}>
                <SidebarMenuSubButton
                  data-pin={pinKey({
                    id: catalog.id,
                    project: project.address,
                    type: "catalog",
                  })}
                  isActive={location === href}
                  render={<NavLink href={href} />}
                >
                  <BookmarkIcon />
                  <span>{catalog.title}</span>
                  {fresh > 0 && (
                    <span
                      aria-label={`${fresh} new`}
                      className="text-primary ml-auto text-xs font-medium tabular-nums"
                    >
                      {fresh > MAX_BADGE ? `${MAX_BADGE}+` : fresh}
                    </span>
                  )}
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
          <SidebarDocs
            canEdit={canEdit(project, pubkey)}
            docs={docs}
            project={project}
          />
          {drive && (
            <SidebarDrive
              canEdit={canEdit(project, pubkey)}
              project={project}
              tree={drive}
            />
          )}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface AppSidebarProps {
  boards: Board[];
  projects: Project[];
  tables: Map<string, CrmTable[]>;
  /** Every project's doc pages, by project address. */
  docs: Map<string, DocsContent>;
  /** Every project's catalogs and links, by project address. */
  catalogs: Map<string, CatalogsContent>;
  /** Every project's Drive folders, by project address; none when the team keeps no files. */
  drive?: Map<string, DriveTree>;
  pubkey: string;
  /** Unread notifications in the inbox. */
  unread: number;
  onNewProject: () => void;
}

export function AppSidebar({
  boards,
  projects,
  tables,
  docs,
  catalogs,
  drive,
  pubkey,
  unread,
  onNewProject,
}: AppSidebarProps) {
  const [location] = useLocation();
  const openBoard = useOpenBoard(boards);
  const { isMobile } = useSidebar();
  const { canAddCards, newCard, showShortcuts } = useAppCommands();
  const storageKey = `sidebar-open:${pubkey}`;
  const [opened, setOpened] = useState(() => readOpened(storageKey));

  useEffect(() => {
    writeStorage(storageKey, JSON.stringify(opened));
  }, [storageKey, opened]);

  const looseBoards = outsideProjects(boards, projects);
  const pins = sidebarPins(projects, boards, tables, docs, catalogs);
  const marks = useCatalogMarks(pubkey);
  const [menuFor, setMenuFor] = useState<{ pin: Pin; href: string }>();

  const isOpen = (project: Project): boolean =>
    opened[project.address] ?? projects.length <= OPEN_BY_DEFAULT;

  // Entering a project, or one of its boards, opens it, so the sidebar shows
  // where the page is. Leaving doesn't fold it: only the chevron does.
  const current = projects.find(
    (project) =>
      location === `/p/${project.slug}` ||
      location.startsWith(`/p/${project.slug}/`) ||
      (openBoard !== undefined && inProject(openBoard, project))
  );
  const [entered, setEntered] = useState<string>();
  if (current?.address !== entered) {
    setEntered(current?.address);
    if (current && !isOpen(current)) {
      setOpened({ ...opened, [current.address]: true });
    }
  }

  return (
    <Sidebar>
      <SidebarHeader className="flex-row items-center justify-between gap-2 py-3 pr-2 pl-4">
        <NavLink
          aria-label="Home"
          className="focus-visible:ring-ring/50 -mx-1.5 flex min-w-0 items-center rounded-lg px-1.5 py-1 outline-none focus-visible:ring-3"
          href="/"
        >
          <Logo className="h-7" />
        </NavLink>
        <div className="flex items-center gap-0.5">
          <IconButton
            className="text-muted-foreground"
            label="Search"
            nativeButton={false}
            render={<NavLink href={SEARCH_PATH} />}
            tooltip={<KeyHint keys={SHORTCUTS["search.open"]} label="Search" />}
          >
            <SearchIcon />
          </IconButton>
          {canAddCards && (
            <IconButton
              className="text-muted-foreground"
              label="New card"
              onClick={newCard}
              tooltip={
                <KeyHint keys={SHORTCUTS["card.new"]} label="New card" />
              }
            >
              <SquarePenIcon />
            </IconButton>
          )}
          {!isMobile && <SidebarTrigger />}
        </div>
      </SidebarHeader>
      <ContextMenu>
        <ContextMenuTrigger
          onContextMenuCapture={(event) => {
            const link = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-pin]"
            );
            const pin = link?.dataset.pin
              ? pins.get(link.dataset.pin)
              : undefined;
            const href = link?.getAttribute("href");
            setMenuFor(pin && href ? { href, pin } : undefined);
            // Nothing to pin there: the browser's own menu shows.
            if (!(pin && href)) {
              event.stopPropagation();
            }
          }}
          render={<SidebarContent />}
        >
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/"}
                  render={<NavLink href="/" />}
                >
                  <HouseIcon />
                  <span>Home</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === BOARDS_PATH}
                  render={<NavLink href={BOARDS_PATH} />}
                >
                  <KanbanIcon />
                  <span>Boards</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {getConfig().map && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={location === MAP_PATH}
                    render={<NavLink href={MAP_PATH} />}
                  >
                    <MapIcon />
                    <span>Map</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === INBOX_PATH}
                  render={<NavLink href={INBOX_PATH} />}
                >
                  <InboxIcon />
                  <span>Inbox</span>
                  {unread > 0 && (
                    <span className="sr-only">, {unread} unread</span>
                  )}
                </SidebarMenuButton>
                {unread > 0 && (
                  <SidebarMenuBadge
                    aria-hidden
                    className="text-foreground font-medium"
                  >
                    {unread > MAX_BADGE ? `${MAX_BADGE}+` : unread}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction onClick={onNewProject} title="New project">
              <PlusIcon />
              <span className="sr-only">New project</span>
            </SidebarGroupAction>
            <SidebarMenu>
              {projects.map((project) => {
                const projectBoards = boards.filter((board) =>
                  inProject(board, project)
                );
                return (
                  <ProjectItem
                    allBoards={boards}
                    boards={projectBoards}
                    catalogs={catalogs.get(project.address) ?? EMPTY_CATALOGS}
                    docs={docs.get(project.address) ?? EMPTY_DOCS}
                    drive={
                      drive
                        ? (drive.get(project.address) ?? EMPTY_TREE)
                        : undefined
                    }
                    key={project.address}
                    openBoard={openBoard}
                    location={location}
                    marks={marks}
                    onOpenChange={(open) =>
                      setOpened({ ...opened, [project.address]: open })
                    }
                    open={isOpen(project)}
                    project={project}
                    pubkey={pubkey}
                    tables={tables.get(project.address) ?? []}
                  />
                );
              })}
              {projects.length === 0 && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    className="text-muted-foreground"
                    onClick={onNewProject}
                  >
                    <PlusIcon />
                    <span>New project</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroup>
          {looseBoards.length > 0 && (
            <SidebarGroup>
              <SidebarGroupLabel>Boards</SidebarGroupLabel>
              <SidebarMenu>
                {looseBoards.map((board) => (
                  <SidebarMenuItem key={board.address}>
                    <SidebarMenuButton
                      data-pin={pinKey({
                        address: board.address,
                        type: "board",
                      })}
                      isActive={board === openBoard}
                      render={<NavLink href={boardPath(board, boards)} />}
                    >
                      <SquareKanbanIcon />
                      <span>{board.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          {menuFor && (
            <>
              <PinMenuItem pin={menuFor.pin} />
              {/* What the browser's own menu offered for the link. */}
              <DropdownMenuItem
                onClick={() => window.open(menuFor.href, "_blank", "noopener")}
              >
                <SquareArrowOutUpRightIcon />
                Open in new tab
              </DropdownMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu onShowShortcuts={showShortcuts} pubkey={pubkey} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
