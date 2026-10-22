import { useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";

import { TopBar } from "@/components/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { CatalogPage } from "@/features/catalogs/catalog-page";
import {
  catalogPath,
  catalogsPath,
  LINK_PARAM,
  parseCatalogParam,
} from "@/features/catalogs/catalogs-context";
import { CatalogsPage } from "@/features/catalogs/catalogs-page";
import type { CatalogsContent } from "@/lib/catalogs";
import type { Project } from "@/lib/project";

/**
 * A project's catalogs, or one of them when the link names it. A project
 * with one catalog opens it straight away; a link moved to another catalog
 * opens there.
 */
export function CatalogsView({
  project,
  content,
  loaded,
  catalogParam,
  pubkey,
}: {
  project: Project;
  content: CatalogsContent;
  loaded: boolean;
  /** The catalog part of the link: its name, then its id. */
  catalogParam?: string;
  pubkey: string;
}) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const id = catalogParam ? parseCatalogParam(catalogParam) : undefined;
  // A list of one would only repeat it, so its own page stands in.
  const alone = content.catalogs.length === 1;
  const lone = !catalogParam && alone ? content.catalogs[0] : undefined;
  const named = id ? content.byId.get(id) : lone;
  const linkId = new URLSearchParams(search).get(LINK_PARAM);
  const link = linkId ? content.linkById.get(linkId) : undefined;
  const catalog =
    link && link.catalog !== named?.id
      ? (content.byId.get(link.catalog) ?? named)
      : named;
  const path = catalog ? catalogPath(project, catalog) : undefined;
  // The link follows the name as it changes; any name before the id still opens it.
  useEffect(() => {
    if (path && !(catalogParam && path.endsWith(`/${catalogParam}`))) {
      navigate(search ? `${path}?${search}` : path, { replace: true });
    }
  }, [catalogParam, navigate, path, search]);

  if (catalog) {
    return (
      <CatalogPage
        alone={alone}
        catalog={catalog}
        content={content}
        key={catalog.id}
        loaded={loaded}
        project={project}
        pubkey={pubkey}
      />
    );
  }
  if (!catalogParam) {
    return (
      <CatalogsPage
        content={content}
        loaded={loaded}
        project={project}
        pubkey={pubkey}
      />
    );
  }
  return (
    <>
      <TopBar
        crumbs={[
          { href: `/p/${project.slug}`, label: project.title },
          { href: catalogsPath(project), label: "Catalogs" },
        ]}
      />
      {loaded ? (
        <Empty>
          <EmptyTitle>Catalog not found</EmptyTitle>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={catalogsPath(project)}
          >
            Catalogs
          </Link>
        </Empty>
      ) : (
        <main
          aria-busy
          className="flex grow flex-col gap-4 px-4 pt-4 pb-8 sm:px-6"
        >
          <Skeleton className="h-9 w-64 rounded-full" />
          <Skeleton className="min-h-64 grow rounded-2xl" />
        </main>
      )}
    </>
  );
}
