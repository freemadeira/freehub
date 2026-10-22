import { useEffect } from "react";
import { Link, Redirect, useLocation } from "wouter";

import { usePlaces } from "@/components/app-link";
import { TopBar } from "@/components/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CATALOGS_SEGMENT,
  parseCatalogParam,
} from "@/features/catalogs/catalogs-context";
import { CatalogsView } from "@/features/catalogs/catalogs-view";
import { TablePage } from "@/features/crm/table-page";
import {
  DOCS_SEGMENT,
  docsPath,
  pagePath,
  parsePageParam,
} from "@/features/docs/docs-context";
import { DocsPage } from "@/features/docs/docs-page";
import { PageView } from "@/features/docs/page-view";
import {
  DRIVE_SEGMENT,
  parseFolderParam,
} from "@/features/drive/drive-context";
import { DriveRoute } from "@/features/drive/drive-page";
import { ProjectPage } from "@/features/projects/project-page";
import { useProjectContent } from "@/hooks/use-project-content";
import { useSources } from "@/hooks/use-sources";
import { useVisit } from "@/hooks/use-visit";
import { hasBlossom } from "@/lib/blossom";
import type { CatalogsContent } from "@/lib/catalogs";
import { EMPTY_CATALOGS } from "@/lib/catalogs";
import type { DocsContent } from "@/lib/docs";
import { EMPTY_DOCS } from "@/lib/docs";
import type { Board } from "@/lib/model";
import type { Project } from "@/lib/project";
import type { PlaceKind } from "@/lib/search";

/** The place a link in the project opens, for the places the user opened lately. */
function usePlaceAt(
  project: Project | undefined,
  segment: string | undefined,
  param: string | undefined
): { kind: PlaceKind; id: string } | undefined {
  const { tables } = usePlaces();
  if (!project) {
    return undefined;
  }
  // Pages, folders and records sit in the project; their ids follow its address.
  const inside = (kind: PlaceKind, id?: string) =>
    id ? { id: `${project.address}/${id}`, kind } : undefined;
  switch (segment) {
    case undefined: {
      return { id: project.address, kind: "project" };
    }
    case DOCS_SEGMENT: {
      return inside("doc", param && parsePageParam(param));
    }
    case DRIVE_SEGMENT: {
      return inside("folder", param && parseFolderParam(param));
    }
    case CATALOGS_SEGMENT: {
      return inside("catalog", param && parseCatalogParam(param));
    }
    default: {
      if (param) {
        return inside("record", param);
      }
      const table = tables
        .get(project.address)
        ?.find((item) => item.slug === segment);
      return table && { id: table.address, kind: "table" };
    }
  }
}

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
  /** The project's catalogs and links. */
  catalogs: CatalogsContent;
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
  // Connectors' profiles, for the names on records they wrote.
  useSources(content);
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

interface ProjectRouteProps extends Omit<
  ProjectViewProps,
  "project" | "docs" | "catalogs"
> {
  slug: string;
  loaded: boolean;
  /** Every project's doc pages, by project address. */
  docs: Map<string, DocsContent>;
  docsLoaded: boolean;
  /** Every project's catalogs and links, by project address. */
  catalogs: Map<string, CatalogsContent>;
  catalogsLoaded: boolean;
}

export function ProjectRoute({
  slug,
  loaded,
  projects,
  docs,
  docsLoaded,
  catalogs,
  catalogsLoaded,
  ...props
}: ProjectRouteProps) {
  const project = projects.find((item) => item.slug === slug.toLowerCase());
  const segment = props.tableSlug?.toLowerCase();
  useVisit(props.pubkey, usePlaceAt(project, segment, props.recordId));
  if (project && segment === DRIVE_SEGMENT) {
    // Only teams with somewhere to keep files have a Drive.
    return hasBlossom() ? (
      <DriveRoute
        folderParam={props.recordId}
        key={project.address}
        project={project}
        pubkey={props.pubkey}
      />
    ) : (
      <Redirect replace to={`/p/${project.slug}`} />
    );
  }
  if (project && segment === CATALOGS_SEGMENT) {
    return (
      <CatalogsView
        catalogParam={props.recordId}
        content={catalogs.get(project.address) ?? EMPTY_CATALOGS}
        key={project.address}
        loaded={catalogsLoaded}
        project={project}
        pubkey={props.pubkey}
      />
    );
  }
  if (project && segment === DOCS_SEGMENT) {
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
        catalogs={catalogs.get(project.address) ?? EMPTY_CATALOGS}
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
