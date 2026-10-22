import type { Catalog } from "@/lib/catalogs";
import type { Project } from "@/lib/project";
import { slugify } from "@/lib/project";

/** Where a project's catalogs live, after its tables: `/p/:project/catalogs`. */
export const CATALOGS_SEGMENT = "catalogs";

/** The search parameter that opens a link over its catalog. */
export const LINK_PARAM = "link";

const CATALOG_ID = /(?:^|-)(?<id>[0-9a-f]{16})$/u;

export function catalogsPath(project: Pick<Project, "slug">): string {
  return `/p/${project.slug}/${CATALOGS_SEGMENT}`;
}

/** The catalog's link: its name for people to read, then its id, which is what counts. */
export function catalogPath(
  project: Pick<Project, "slug">,
  catalog: Pick<Catalog, "id" | "title">
): string {
  const slug = slugify(catalog.title);
  return `${catalogsPath(project)}/${slug ? `${slug}-` : ""}${catalog.id}`;
}

/** A link opened over its catalog. */
export function linkPath(
  project: Pick<Project, "slug">,
  catalog: Pick<Catalog, "id" | "title">,
  linkId: string
): string {
  return `${catalogPath(project, catalog)}?${LINK_PARAM}=${linkId}`;
}

/** The catalog id at the end of a catalog link, whatever name came before it. */
export function parseCatalogParam(param: string): string | undefined {
  return CATALOG_ID.exec(param.toLowerCase())?.groups?.id;
}
