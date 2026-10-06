import {
  ChevronRightIcon,
  HouseIcon,
  InboxIcon,
  PlusIcon,
  SquareKanbanIcon,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useSearchParams } from "wouter";

import { Logo } from "@/components/logo";
import { NavLink } from "@/components/nav-link";
import { ProjectAvatar } from "@/components/project-avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { boardPath } from "@/features/board/board-context";
import { findBoard, parseSlug } from "@/features/board/board-route";
import { TableIcon } from "@/features/crm/table-icon";
import { SidebarDocs } from "@/features/docs/sidebar-docs";
import { INBOX_PATH } from "@/features/inbox/inbox-page";
import type { CrmTable } from "@/lib/crm";
import type { DocsContent } from "@/lib/docs";
import { EMPTY_DOCS } from "@/lib/docs";
import type { Board } from "@/lib/model";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";

/** Projects shown open until the user folds them. */
const OPEN_BY_DEFAULT = 3;
const MAX_BADGE = 99;

/** The board the current page shows, if any. */
function useOpenBoard(boards: Board[]): Board | undefined {
  const [location] = useLocation();
  const [search] = useSearchParams();
  // Board pages sit one level deep: `/FREE` or `/FREE-12`.
  const [, segment = "", ...rest] = location.split("/");
  const slug = rest.length === 0 ? parseSlug(segment) : undefined;
  return slug ? findBoard(boards, slug.code, search.get("board")) : undefined;
}

interface ProjectItemProps {
  project: Project;
  tables: CrmTable[];
  docs: DocsContent;
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
                isActive={board === openBoard}
                render={<NavLink href={boardPath(board, allBoards)} />}
              >
                <SquareKanbanIcon />
                <span>{board.title}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
          <SidebarDocs
            canEdit={canEdit(project, pubkey)}
            docs={docs}
            project={project}
          />
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
  pubkey,
  unread,
  onNewProject,
}: AppSidebarProps) {
  const [location] = useLocation();
  const openBoard = useOpenBoard(boards);
  const { isMobile } = useSidebar();
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  const known = new Set(projects.map((project) => project.address));
  const looseBoards = boards.filter(
    (board) => !(board.project && known.has(board.project))
  );

  const isOpen = (project: Project, projectBoards: Board[]): boolean => {
    const choice = folded[project.address];
    if (choice !== undefined) {
      return choice;
    }
    return (
      projects.length <= OPEN_BY_DEFAULT ||
      location.startsWith(`/p/${project.slug}`) ||
      projectBoards.some((board) => board === openBoard)
    );
  };

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
        {!isMobile && <SidebarTrigger />}
      </SidebarHeader>
      <SidebarContent>
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
              const projectBoards = boards.filter(
                (board) => board.project === project.address
              );
              return (
                <ProjectItem
                  allBoards={boards}
                  boards={projectBoards}
                  docs={docs.get(project.address) ?? EMPTY_DOCS}
                  key={project.address}
                  openBoard={openBoard}
                  location={location}
                  onOpenChange={(open) =>
                    setFolded({ ...folded, [project.address]: open })
                  }
                  open={isOpen(project, projectBoards)}
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
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu pubkey={pubkey} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
