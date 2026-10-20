import { MotionConfig } from "motion/react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { DefaultParams } from "wouter";
import { Redirect, Route, Switch, useRoute, useSearchParams } from "wouter";

import type { Places } from "@/components/app-link";
import { PlacesContext } from "@/components/app-link";
import { AppSidebar } from "@/components/app-sidebar";
import { AccessDenied, SignerRevoked } from "@/components/status-screens";
import { TopBar } from "@/components/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getConfig } from "@/config";
import { findBoard, parseSlug } from "@/features/board/board-context";
import { BoardRoute } from "@/features/board/board-route";
import { BOARDS_PATH, BoardsPage } from "@/features/boards/boards-page";
import { UploadTray } from "@/features/drive/upload-tray";
import { HomeContext, useHomeSettings } from "@/features/home/home-context";
import { HomePage } from "@/features/home/home-page";
import { InboxContext } from "@/features/inbox/inbox-context";
import { INBOX_PATH, InboxPage } from "@/features/inbox/inbox-page";
import {
  useAppBadge,
  useSystemNotifications,
} from "@/features/inbox/use-system-notifications";
import { LoginPage } from "@/features/login/login-page";
import { MAP_PATH } from "@/features/map/map-path";
import { ProjectDialog } from "@/features/projects/project-dialog";
import { useBoards } from "@/hooks/use-boards";
import { useDocs } from "@/hooks/use-docs";
import { useDriveTrees } from "@/hooks/use-drive";
import { useInbox } from "@/hooks/use-inbox";
import { useObservableValue } from "@/hooks/use-observable-value";
import { useProjectTables } from "@/hooks/use-project-content";
import { useProjects } from "@/hooks/use-projects";
import { hasBlossom } from "@/lib/blossom";
import type { Board } from "@/lib/model";
import { accounts } from "@/lib/nostr";
import { startNotifications } from "@/lib/notify";
import type { Project } from "@/lib/project";
import { inProject } from "@/lib/project";
import { access$, sync } from "@/lib/relays";
import { signerState$ } from "@/lib/signer";
import { subscriptionFilters } from "@/lib/subscribe";

// regexparam's types misread several optional segments in a row.
interface ProjectParams extends DefaultParams {
  readonly project: string;
  readonly table?: string;
  readonly record?: string;
}

// Projects carry the CRM and its table library, which board-only visits never need.
const ProjectRoute = lazy(async () => {
  const module = await import("@/features/projects/project-route");
  return { default: module.ProjectRoute };
});

// The map brings three.js and its workers; only organizations with a map load them.
const MapRoute = lazy(async () => {
  const module = await import("@/features/map/map-route");
  return { default: module.MapRoute };
});

function RouteFallback() {
  return (
    <>
      <TopBar crumbs={[]} />
      <main
        aria-busy
        className="flex grow flex-col gap-4 px-4 pt-4 pb-8 sm:px-6"
      >
        <Skeleton className="h-9 w-64 rounded-full" />
        <Skeleton className="min-h-64 grow rounded-2xl" />
      </main>
    </>
  );
}

/**
 * Everyone on the user's boards and projects keeps a list of what they
 * subscribe to; changing a card tells whoever's list names it.
 */
function useTeamSubscriptions(boards: Board[], projects: Project[]): void {
  const people = [
    ...new Set(
      [...boards, ...projects].flatMap(({ members, viewers }) => [
        ...members,
        ...viewers,
      ])
    ),
  ].toSorted();
  useObservableValue(
    () => sync(subscriptionFilters(people)),
    [people.join(",")]
  );
}

function Workspace({ pubkey }: { pubkey: string }) {
  const { boards, loaded: boardsLoaded } = useBoards(pubkey);
  const { projects, loaded: projectsLoaded } = useProjects(pubkey);
  const tables = useProjectTables(projects);
  const { docs, loaded: docsLoaded } = useDocs(projects);
  // Only teams with somewhere to keep files have a Drive.
  const drive = hasBlossom();
  const trees = useDriveTrees(drive ? projects : []);
  const home = useHomeSettings(pubkey);
  const inbox = useInbox(pubkey, {
    boards,
    docs,
    loaded: boardsLoaded && projectsLoaded && docsLoaded,
    projects,
    tables,
  });
  useTeamSubscriptions(boards, projects);
  useSystemNotifications(inbox, pubkey);
  useAppBadge(inbox.unread);
  useEffect(() => startNotifications(pubkey), [pubkey]);
  const [creatingProject, setCreatingProject] = useState(false);
  const [, params] = useRoute<{ slug: string }>("/:slug");
  const [search] = useSearchParams();
  const slug = params ? parseSlug(params.slug) : undefined;
  const board = slug
    ? findBoard(boards, slug.code, search.get("board"))
    : undefined;
  const boardProject = board
    ? projects.find((project) => inProject(board, project))
    : undefined;
  const newProject = () => setCreatingProject(true);
  const places: Places = { boards, docs, projects, tables };

  return (
    <InboxContext value={inbox}>
      <PlacesContext value={places}>
        <HomeContext value={home}>
          <SidebarProvider>
            <AppSidebar
              boards={boards}
              docs={docs}
              drive={drive ? trees : undefined}
              onNewProject={newProject}
              projects={projects}
              pubkey={pubkey}
              tables={tables}
              unread={inbox.unread}
            />
            <SidebarInset>
              <Switch>
                <Route path="/">
                  <HomePage
                    boards={boards}
                    docs={docs}
                    loaded={boardsLoaded && projectsLoaded}
                    onNewProject={newProject}
                    projects={projects}
                    pubkey={pubkey}
                    tables={tables}
                  />
                </Route>
                <Route<ProjectParams> path="/p/:project/:table?/:record?">
                  {(route) => (
                    <Suspense fallback={<RouteFallback />}>
                      <ProjectRoute
                        boards={boards}
                        docs={docs}
                        docsLoaded={projectsLoaded && docsLoaded}
                        loaded={projectsLoaded}
                        projects={projects}
                        pubkey={pubkey}
                        recordId={route.record}
                        slug={route.project}
                        tableSlug={route.table}
                      />
                    </Suspense>
                  )}
                </Route>
                <Route path={BOARDS_PATH}>
                  <BoardsPage
                    boards={boards}
                    loaded={boardsLoaded && projectsLoaded}
                    projects={projects}
                    pubkey={pubkey}
                  />
                </Route>
                <Route path={INBOX_PATH}>
                  <InboxPage inbox={inbox} pubkey={pubkey} />
                </Route>
                {getConfig().map && (
                  <Route path={MAP_PATH}>
                    <Suspense fallback={<RouteFallback />}>
                      <MapRoute projects={projects} pubkey={pubkey} />
                    </Suspense>
                  </Route>
                )}
                {slug && (
                  <Route path="/:slug">
                    <BoardRoute
                      board={board}
                      boards={boards}
                      cardNumber={slug.number}
                      code={slug.code}
                      loaded={boardsLoaded}
                      project={boardProject}
                      projects={projects}
                      pubkey={pubkey}
                    />
                  </Route>
                )}
                <Route>
                  <Redirect replace to="/" />
                </Route>
              </Switch>
            </SidebarInset>
            <ProjectDialog
              onOpenChange={setCreatingProject}
              open={creatingProject}
              projects={projects}
              pubkey={pubkey}
            />
            {drive && <UploadTray trees={trees} />}
          </SidebarProvider>
        </HomeContext>
      </PlacesContext>
    </InboxContext>
  );
}

function Gate() {
  const account = useObservableValue(accounts.active$);
  const signer = useObservableValue(signerState$);
  const access = useObservableValue(access$);

  if (!account) {
    return <LoginPage />;
  }
  if (signer === "revoked") {
    return <SignerRevoked />;
  }
  if (access === "denied") {
    return <AccessDenied pubkey={account.pubkey} />;
  }
  return <Workspace pubkey={account.pubkey} />;
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <Gate />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </MotionConfig>
  );
}
