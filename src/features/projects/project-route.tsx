import { useEffect } from "react";
import { Link, useLocation } from "wouter";

import { TopBar } from "@/components/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePage } from "@/features/crm/table-page";
import {
  DOCS_SEGMENT,
  docsPath,
  pagePath,
  parsePageParam,
} from "@/features/docs/docs-context";
import { DocsPage } from "@/features/docs/docs-page";
import { PageView } from "@/features/docs/page-view";
import { ProjectPage } from "@/features/projects/project-page";
import { useProjectContent } from "@/hooks/use-project-content";
import type { DocsContent } from "@/lib/docs";
import { EMPTY_DOCS } from "@/lib/docs";
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
  /** The project's doc pages. */
  docs: DocsContent;
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

interface DocsViewProps {
  project: Project;
  docs: DocsContent;
  loaded: boolean;
  /** The page part of the link: its title, then its id. */
  pageParam?: string;
  pubkey: string;
}

function DocsView({ project, docs, loaded, pageParam, pubkey }: DocsViewProps) {
  const [, navigate] = useLocation();
  const id = pageParam ? parsePageParam(pageParam) : undefined;
  const page = id ? docs.byId.get(id) : undefined;
  const path = page ? pagePath(project, page) : undefined;
  // The link follows the title as it changes; any title before the id still opens the page.
  useEffect(() => {
    if (path && pageParam && !path.endsWith(`/${pageParam}`)) {
      navigate(path, { replace: true });
    }
  }, [navigate, pageParam, path]);

  if (!pageParam) {
    return (
      <DocsPage docs={docs} loaded={loaded} project={project} pubkey={pubkey} />
    );
  }
  if (page) {
    return (
      <PageView docs={docs} page={page} project={project} pubkey={pubkey} />
    );
  }
  return (
    <>
      <TopBar
        crumbs={[
          { href: `/p/${project.slug}`, label: project.title },
          { href: docsPath(project), label: "Docs" },
        ]}
      />
      {loaded ? (
        <NotFound
          href={docsPath(project)}
          label="Docs"
          title="Page not found"
        />
      ) : (
        <Loading />
      )}
    </>
  );
}

interface ProjectRouteProps extends Omit<ProjectViewProps, "project" | "docs"> {
  slug: string;
  loaded: boolean;
  /** Every project's doc pages, by project address. */
  docs: Map<string, DocsContent>;
  docsLoaded: boolean;
}

export function ProjectRoute({
  slug,
  loaded,
  projects,
  docs,
  docsLoaded,
  ...props
}: ProjectRouteProps) {
  const project = projects.find((item) => item.slug === slug.toLowerCase());
  if (project && props.tableSlug?.toLowerCase() === DOCS_SEGMENT) {
    return (
      <DocsView
        docs={docs.get(project.address) ?? EMPTY_DOCS}
        key={project.address}
        loaded={docsLoaded}
        pageParam={props.recordId}
        project={project}
        pubkey={props.pubkey}
      />
    );
  }
  if (project) {
    return (
      <ProjectView
        docs={docs.get(project.address) ?? EMPTY_DOCS}
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
