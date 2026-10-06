import { cn } from "cn";
import { PlusIcon, Settings2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link } from "wouter";

import { IconButton } from "@/components/icon-button";
import { ProjectAvatar } from "@/components/project-avatar";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { boardPath } from "@/features/board/board-context";
import {
  BoardCard,
  CARD_SURFACE,
  MemberAvatars,
} from "@/features/boards/board-card";
import { BoardDialog } from "@/features/boards/board-dialog";
import { tablePath } from "@/features/crm/crm-context";
import { NewTableDialog } from "@/features/crm/new-table-dialog";
import { TableIcon } from "@/features/crm/table-icon";
import { ProjectDialog } from "@/features/projects/project-dialog";
import type { CrmRecord, CrmTable, ProjectContent } from "@/lib/crm";
import { firstValue, stageField } from "@/lib/crm";
import type { Board } from "@/lib/model";
import { SWATCH_COLORS } from "@/lib/palette";
import type { Project } from "@/lib/project";

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

/** Share of records in each stage, as one bar split by stage color. */
function StageBar({
  table,
  records,
}: {
  table: CrmTable;
  records: CrmRecord[];
}) {
  const stage = stageField(table);
  if (!stage || records.length === 0) {
    return null;
  }
  const parts = stage.options
    .map((option) => ({
      count: records.filter(
        (record) => firstValue(record, stage.id) === option.id
      ).length,
      option,
    }))
    .filter((part) => part.count > 0);
  const won = parts
    .filter((part) => part.option.kind === "won")
    .reduce((sum, part) => sum + part.count, 0);
  const wonLabel = stage.options.find((option) => option.kind === "won")?.label;
  return (
    <div className="mt-auto flex flex-col gap-2 pt-2">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        <FluidTooltip.Group>
          {parts.map(({ option, count }) => (
            <FluidTooltip.Root key={option.id}>
              <FluidTooltip.Trigger>
                <span
                  className={cn(
                    "h-full first:rounded-l-full last:rounded-r-full",
                    SWATCH_COLORS[option.color]
                  )}
                  style={{ flexGrow: count }}
                />
              </FluidTooltip.Trigger>
              <FluidTooltip.Content>
                {option.label} <span className="tabular-nums">{count}</span>
              </FluidTooltip.Content>
            </FluidTooltip.Root>
          ))}
        </FluidTooltip.Group>
      </div>
      {wonLabel && (
        <span className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium tabular-nums">
            {won}
          </span>{" "}
          {wonLabel.toLowerCase()}
        </span>
      )}
    </div>
  );
}

function TableCard({
  project,
  table,
  records,
}: {
  project: Project;
  table: CrmTable;
  records: CrmRecord[];
}) {
  return (
    <Link className={CARD_SURFACE} href={tablePath(project, table)}>
      <div className="flex items-center gap-3">
        <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
          <TableIcon className="size-4" icon={table.icon} />
        </span>
        <h3 className="min-w-0 truncate leading-snug font-medium">
          {table.title}
        </h3>
        <span className="text-muted-foreground ml-auto text-sm tabular-nums">
          {records.length}
        </span>
      </div>
      {table.description && (
        <p className="text-muted-foreground line-clamp-2 text-sm">
          {table.description}
        </p>
      )}
      <StageBar records={records} table={table} />
    </Link>
  );
}

interface ProjectPageProps {
  project: Project;
  projects: Project[];
  boards: Board[];
  content?: ProjectContent;
  loaded: boolean;
  pubkey: string;
}

export function ProjectPage({
  project,
  projects,
  boards,
  content,
  loaded,
  pubkey,
}: ProjectPageProps) {
  const [dialog, setDialog] = useState<"settings" | "board" | "table">();
  const projectBoards = boards.filter(
    (board) => board.project === project.address
  );
  const tables = content?.tables ?? [];
  const dialogProps = (name: "settings" | "board" | "table") => ({
    onOpenChange: (open: boolean) => setDialog(open ? name : undefined),
    open: dialog === name,
  });

  let crm: ReactNode = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tables.map((table) => (
        <TableCard
          key={table.id}
          project={project}
          records={content?.byTable.get(table.id) ?? []}
          table={table}
        />
      ))}
    </div>
  );
  if (tables.length === 0) {
    crm = loaded ? (
      <Empty className="bg-muted/60 rounded-2xl py-10">
        <EmptyDescription className="mt-0 max-w-sm">
          Track merchants, deals or contacts in tables with your own fields and
          stages.
        </EmptyDescription>
        <Button onClick={() => setDialog("table")}>
          <PlusIcon />
          New table
        </Button>
      </Empty>
    ) : (
      <div aria-busy className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl max-sm:hidden" />
      </div>
    );
  }

  return (
    <>
      <TopBar
        crumbs={[
          { icon: <ProjectAvatar project={project} />, label: project.title },
        ]}
      />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-4 pb-10 sm:px-6">
        <header className="flex flex-wrap items-start gap-4">
          <ProjectAvatar project={project} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-2xl font-semibold tracking-tight">
              {project.title}
            </h2>
            {project.description && (
              <p className="text-muted-foreground max-w-2xl text-sm">
                {project.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <MemberAvatars members={project.members} />
            {project.creator === pubkey && (
              <IconButton
                label="Project settings"
                onClick={() => setDialog("settings")}
              >
                <Settings2Icon />
              </IconButton>
            )}
          </div>
        </header>
        <Section
          action={
            tables.length > 0 && (
              <Button onClick={() => setDialog("table")} variant="outline">
                <PlusIcon />
                New table
              </Button>
            )
          }
          title="CRM"
        >
          {crm}
        </Section>
        <Section
          action={
            <Button onClick={() => setDialog("board")} variant="outline">
              <PlusIcon />
              New board
            </Button>
          }
          title="Boards"
        >
          {projectBoards.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projectBoards.map((board) => (
                <BoardCard
                  board={board}
                  href={boardPath(board, boards)}
                  key={board.address}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No boards in this project yet.
            </p>
          )}
        </Section>
      </main>
      <ProjectDialog
        {...dialogProps("settings")}
        project={project}
        projects={projects}
        pubkey={pubkey}
      />
      <BoardDialog
        {...dialogProps("board")}
        boards={boards}
        project={project}
        projects={projects}
        pubkey={pubkey}
      />
      <NewTableDialog
        {...dialogProps("table")}
        project={project}
        pubkey={pubkey}
        tables={tables}
      />
    </>
  );
}
