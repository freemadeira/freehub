import { SquareKanbanIcon } from "lucide-react";
import { MotionConfig } from "motion/react";
import { lazy, Suspense, useState } from "react";
import type { DefaultParams } from "wouter";
import { Redirect, Route, Switch, useRoute } from "wouter";

import { AppSidebar } from "@/components/app-sidebar";
import { ProjectAvatar } from "@/components/project-avatar";
import { AccessDenied, SignerRevoked } from "@/components/status-screens";
import type { Crumb } from "@/components/top-bar";
import { TopBar } from "@/components/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardRoute, parseSlug } from "@/features/board/board-route";
import { HomePage } from "@/features/home/home-page";
import { INBOX_PATH, InboxPage } from "@/features/inbox/inbox-page";
import { LoginPage } from "@/features/login/login-page";
import { ProjectDialog } from "@/features/projects/project-dialog";
import { useBoards } from "@/hooks/use-boards";
import { useInbox } from "@/hooks/use-inbox";
import { useObservableValue } from "@/hooks/use-observable-value";
import { useProjectTables } from "@/hooks/use-project-content";
import { useProjects } from "@/hooks/use-projects";
import type { Board } from "@/lib/model";
import { accounts } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { access$ } from "@/lib/relays";
import { signerState$ } from "@/lib/signer";

// regexparam's types misread several optional segments in a row.
interface ProjectParams extends DefaultParams {
  readonly project: string;
  readonly table?: string;
  readonly record?: string;
}

function boardCrumbs(code: string, board?: Board, project?: Project): Crumb[] {
  const crumb: Crumb = {
    icon: (
      <SquareKanbanIcon className="text-muted-foreground size-4 shrink-0" />
    ),
    label: board?.title ?? code,
  };
  return project
    ? [
        {
          href: `/p/${project.slug}`,
          icon: <ProjectAvatar project={project} />,
          label: project.title,
        },
        crumb,
      ]
    : [crumb];
}

// Projects carry the CRM and its table library, which board-only visits never need.
const ProjectRoute = lazy(async () => {
  const module = await import("@/features/projects/project-route");
  return { default: module.ProjectRoute };
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

function Workspace({ pubkey }: { pubkey: string }) {
  const { boards, loaded: boardsLoaded } = useBoards(pubkey);
  const { projects, loaded: projectsLoaded } = useProjects(pubkey);
  const tables = useProjectTables(projects);
  const inbox = useInbox(pubkey, boards);
  const [creatingProject, setCreatingProject] = useState(false);
  const [, params] = useRoute<{ slug: string }>("/:slug");
  const slug = params ? parseSlug(params.slug) : undefined;
  const board = slug
    ? boards.find((item) => item.code === slug.code)
    : undefined;
  const boardProject = projects.find(
    (project) => project.address === board?.project
  );
  const newProject = () => setCreatingProject(true);

  return (
    <SidebarProvider>
      <AppSidebar
        boards={boards}
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
          <Route path={INBOX_PATH}>
            <InboxPage inbox={inbox} />
          </Route>
          {slug && (
            <Route path="/:slug">
              <TopBar crumbs={boardCrumbs(slug.code, board, boardProject)} />
              <BoardRoute
                board={board}
                boards={boards}
                cardNumber={slug.number}
                loaded={boardsLoaded}
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
    </SidebarProvider>
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
