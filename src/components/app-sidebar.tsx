import {
  ChevronRightIcon,
  HouseIcon,
  InboxIcon,
  PlusIcon,
  SquareKanbanIcon,
} from "lucide-react";
import { useState } from "react";
import type { LinkProps } from "wouter";
import { Link, useLocation } from "wouter";

import { Logo } from "@/components/logo";
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
import { TableIcon } from "@/features/crm/table-icon";
import { INBOX_PATH } from "@/features/inbox/inbox-page";
import type { CrmTable } from "@/lib/crm";
import type { Board } from "@/lib/model";
import type { Project } from "@/lib/project";

/** Projects shown open until the user folds them. */
const OPEN_BY_DEFAULT = 3;
const MAX_BADGE = 99;

// The mobile sheet covers the page, so it closes once a link is followed.
function NavLink(props: LinkProps) {
  const { setOpenMobile } = useSidebar();
  return (
    <Link
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        setOpenMobile(false);
      }}
    />
  );
}

function boardPath(board: Board): string {
  return `/${board.code}`;
}

function isBoardPath(location: string, board: Board): boolean {
  const segment = location.split("/")[1]?.toUpperCase() ?? "";
  return segment === board.code || segment.startsWith(`${board.code}-`);
}

interface ProjectItemProps {
  project: Project;
  tables: CrmTable[];
  boards: Board[];
  location: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ProjectItem({
  project,
  tables,
  boards,
  location,
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
                isActive={isBoardPath(location, board)}
                render={<NavLink href={boardPath(board)} />}
              >
                <SquareKanbanIcon />
                <span>{board.title}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
          {tables.length === 0 && boards.length === 0 && (
            <SidebarMenuSubItem>
              <span className="text-muted-foreground flex h-8 items-center px-2 text-sm">
                Nothing here yet
              </span>
            </SidebarMenuSubItem>
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
  pubkey: string;
  /** Unread notifications in the inbox. */
  unread: number;
  onNewProject: () => void;
}

export function AppSidebar({
  boards,
  projects,
  tables,
  pubkey,
  unread,
  onNewProject,
}: AppSidebarProps) {
  const [location] = useLocation();
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
      projectBoards.some((board) => isBoardPath(location, board))
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
                  boards={projectBoards}
                  key={project.address}
                  location={location}
                  onOpenChange={(open) =>
                    setFolded({ ...folded, [project.address]: open })
                  }
                  open={isOpen(project, projectBoards)}
                  project={project}
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
                    isActive={isBoardPath(location, board)}
                    render={<NavLink href={boardPath(board)} />}
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
