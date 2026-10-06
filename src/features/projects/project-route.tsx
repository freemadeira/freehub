import { Link } from "wouter";

import { TopBar } from "@/components/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePage } from "@/features/crm/table-page";
import { ProjectPage } from "@/features/projects/project-page";
import { useProjectContent } from "@/hooks/use-project-content";
import type { Board } from "@/lib/model";
import type { Project } from "@/lib/project";

function NotFound({
  title,
  href,
  label,
}: {
  title: string;
  href: string;
  label: string;
}) {
  return (
    <Empty>
      <EmptyTitle>{title}</EmptyTitle>
      <Link className={buttonVariants({ variant: "outline" })} href={href}>
        {label}
      </Link>
    </Empty>
  );
}

function Loading() {
  return (
    <main aria-busy className="flex grow flex-col gap-4 px-4 pt-4 pb-8 sm:px-6">
      <Skeleton className="h-9 w-64 rounded-full" />
      <Skeleton className="min-h-64 grow rounded-2xl" />
    </main>
  );
}

interface ProjectViewProps {
  project: Project;
  projects: Project[];
  boards: Board[];
  tableSlug?: string;
  recordId?: string;
  pubkey: string;
}

function ProjectView({
  project,
  tableSlug,
  recordId,
  ...props
}: ProjectViewProps) {
  const { content, loaded } = useProjectContent(project);
  if (!tableSlug) {
    return (
      <ProjectPage
        content={content}
        loaded={loaded}
        project={project}
        {...props}
      />
    );
  }
  const table = content?.tables.find(
    (item) => item.slug === tableSlug.toLowerCase()
  );
  if (content && table) {
    return (
      <TablePage
        content={content}
        key={table.id}
        loaded={loaded}
        project={project}
        pubkey={props.pubkey}
        recordId={recordId}
        table={table}
      />
    );
  }
  return (
    <>
      <TopBar crumbs={[{ href: `/p/${project.slug}`, label: project.title }]} />
      {loaded ? (
        <NotFound
          href={`/p/${project.slug}`}
          label={project.title}
          title="Table not found"
        />
      ) : (
        <Loading />
      )}
    </>
  );
}

interface ProjectRouteProps extends Omit<ProjectViewProps, "project"> {
  slug: string;
  loaded: boolean;
}

export function ProjectRoute({
  slug,
  loaded,
  projects,
  ...props
}: ProjectRouteProps) {
  const project = projects.find((item) => item.slug === slug.toLowerCase());
  if (project) {
    return (
      <ProjectView
        key={project.address}
        project={project}
        projects={projects}
        {...props}
      />
    );
  }
  return (
    <>
      <TopBar crumbs={[{ href: "/", label: "Home" }]} />
      {loaded ? (
        <NotFound href="/" label="Home" title="Project not found" />
      ) : (
        <Loading />
      )}
    </>
  );
}
