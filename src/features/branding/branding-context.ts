import type { Brand } from "@/lib/brands";
import type { Project } from "@/lib/project";
import { slugify } from "@/lib/project";

/** Where a project's brands live, after its tables: `/p/:project/branding`. */
export const BRANDING_SEGMENT = "branding";

const BRAND_ID = /(?:^|-)(?<id>[0-9a-f]{16})$/u;

export function brandingPath(project: Pick<Project, "slug">): string {
  return `/p/${project.slug}/${BRANDING_SEGMENT}`;
}

/** The brand's link: its name for people to read, then its id, which is what counts. */
export function brandPath(
  project: Pick<Project, "slug">,
  brand: Pick<Brand, "id" | "title">
): string {
  const slug = slugify(brand.title);
  return `${brandingPath(project)}/${slug ? `${slug}-` : ""}${brand.id}`;
}

/** The brand id at the end of a brand link, whatever name came before it. */
export function parseBrandParam(param: string): string | undefined {
  return BRAND_ID.exec(param.toLowerCase())?.groups?.id;
}
