import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link } from "wouter";

import { ProjectAvatar } from "@/components/project-avatar";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { boardPath } from "@/features/board/board-context";
import {
  BoardCard,
  CARD_SURFACE,
  MemberAvatars,
} from "@/features/boards/board-card";
import { BoardDialog } from "@/features/boards/board-dialog";
import type { CrmTable } from "@/lib/crm";
import type { Board } from "@/lib/model";
import type { Project } from "@/lib/project";
import { plural } from "@/lib/utils";

function ProjectCard({
  project,
  tables,
  boards,
}: {
  project: Project;
  tables: number;
  boards: number;
}) {
  return (
    <Link className={CARD_SURFACE} href={`/p/${project.slug}`}>
      <div className="flex items-center gap-3">
        <ProjectAvatar project={project} size="md" />
        <h3 className="min-w-0 truncate leading-snug font-medium">
          {project.title}
        </h3>
      </div>
      {project.description && (
        <p className="text-muted-foreground line-clamp-2 text-sm">
          {project.description}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 pt-2">
        <MemberAvatars members={project.members} />
        <span className="text-muted-foreground text-xs tabular-nums">
          {plural(tables, "table")} · {plural(boards, "board")}
        </span>
      </div>
    </Link>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex h-9 items-center justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function CardsSkeleton() {
  return (
    <div aria-busy className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-36 rounded-2xl max-lg:hidden" />
    </div>
  );
}

interface HomePageProps {
  boards: Board[];
  projects: Project[];
  tables: Map<string, CrmTable[]>;
  loaded: boolean;
  pubkey: string;
  onNewProject: () => void;
}

export function HomePage({
  boards,
  projects,
  tables,
  loaded,
  pubkey,
  onNewProject,
}: HomePageProps) {
  const [creatingBoard, setCreatingBoard] = useState(false);
  const known = new Set(projects.map((project) => project.address));
  const looseBoards = boards.filter(
    (board) => !(board.project && known.has(board.project))
  );
  const newProject = (
    <Button onClick={onNewProject}>
      <PlusIcon />
      New project
    </Button>
  );
  const newBoard = (
    <Button onClick={() => setCreatingBoard(true)} variant="outline">
      <PlusIcon />
      New board
    </Button>
  );

  let content: ReactNode;
  if (projects.length === 0 && boards.length === 0) {
    content = loaded ? (
      <Empty className="py-24">
        <EmptyTitle>Start your first project</EmptyTitle>
        <EmptyDescription>
          Projects hold boards and CRM tables, shared with the people you add.
        </EmptyDescription>
        <div className="flex flex-wrap justify-center gap-2">
          {newProject}
          {newBoard}
        </div>
      </Empty>
    ) : (
      <CardsSkeleton />
    );
  } else {
    content = (
      <>
        <Section action={projects.length > 0 && newProject} title="Projects">
          {projects.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard
                  boards={
                    boards.filter((board) => board.project === project.address)
                      .length
                  }
                  key={project.address}
                  project={project}
                  tables={tables.get(project.address)?.length ?? 0}
                />
              ))}
            </div>
          ) : (
            <Empty className="bg-muted/60 rounded-2xl py-10">
              <EmptyDescription className="mt-0">
                Group boards and CRM tables into a project.
              </EmptyDescription>
              {newProject}
            </Empty>
          )}
        </Section>
        {looseBoards.length > 0 && (
          <Section action={newBoard} title="Boards">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {looseBoards.map((board) => (
                <BoardCard
                  board={board}
                  href={boardPath(board, boards)}
                  key={board.address}
                />
              ))}
            </div>
          </Section>
        )}
      </>
    );
  }

  return (
    <>
      <TopBar crumbs={[{ label: "Home" }]} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-4 pb-10 sm:px-6">
        {content}
      </main>
      <BoardDialog
        boards={boards}
        onOpenChange={setCreatingBoard}
        open={creatingBoard}
        projects={projects}
        pubkey={pubkey}
      />
    </>
  );
}
