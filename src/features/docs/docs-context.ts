import type { DocPage } from "@/lib/docs";
import type { Project } from "@/lib/project";
import { slugify } from "@/lib/project";

/** Where a project's docs live, after its tables: `/p/:project/docs`. */
export const DOCS_SEGMENT = "docs";

const PAGE_ID = /(?:^|-)(?<id>[0-9a-f]{16})$/u;

export function docsPath(project: Pick<Project, "slug">): string {
  return `/p/${project.slug}/${DOCS_SEGMENT}`;
}

/** The page's link: its title for people to read, then its id, which is what counts. */
export function pagePath(
  project: Pick<Project, "slug">,
  page: Pick<DocPage, "id" | "title">
): string {
  const slug = slugify(page.title);
  return `${docsPath(project)}/${slug ? `${slug}-` : ""}${page.id}`;
}

/** The page id at the end of a page link, whatever title came before it. */
export function parsePageParam(param: string): string | undefined {
  return PAGE_ID.exec(param.toLowerCase())?.groups?.id;
}
