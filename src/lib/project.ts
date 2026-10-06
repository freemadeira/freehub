import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import type { Template } from "@/lib/model";
import { DELETE_KIND, isPubkey, PROJECT_KIND } from "@/lib/model";
import type { Color } from "@/lib/palette";
import { parseColor } from "@/lib/palette";

const DIACRITICS = /\p{Diacritic}/gu;
const MAX_SLUG = 32;

export interface Project {
  id: string;
  address: string;
  creator: string;
  slug: string;
  title: string;
  description: string;
  color: Color;
  members: string[];
  event: NostrEvent;
}

export type ProjectFields = Pick<
  Project,
  "id" | "creator" | "slug" | "title" | "description" | "color" | "members"
>;

/** Lowercase words joined by hyphens, safe for a URL path segment. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/u, "");
}

/** Like `slugify`, but keeps a trailing hyphen so it can be typed. */
export function cleanSlugInput(value: string): string {
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .slice(0, MAX_SLUG);
}

/** Appends -2, -3, … until the slug is free. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = base || "untitled";
  let slug = root;
  for (let suffix = 2; used.has(slug); suffix += 1) {
    slug = `${root.slice(0, MAX_SLUG - String(suffix).length - 1)}-${suffix}`;
  }
  return slug;
}

export function projectAddress(creator: string, id: string): string {
  return `${PROJECT_KIND}:${creator}:${id}`;
}

export function parseProject(event: NostrEvent): Project | undefined {
  const id = getTagValue(event, "d");
  if (!id) {
    return undefined;
  }
  const title = getTagValue(event, "title")?.trim() || "Untitled project";
  const members = new Set(
    event.tags.flatMap(([name, value]) =>
      name === "p" && isPubkey(value) ? [value] : []
    )
  );
  members.delete(event.pubkey);
  return {
    address: projectAddress(event.pubkey, id),
    color: parseColor(getTagValue(event, "color"), "yellow"),
    creator: event.pubkey,
    description: getTagValue(event, "description") ?? "",
    event,
    id,
    members: [event.pubkey, ...members],
    slug:
      slugify(getTagValue(event, "slug") ?? "") ||
      slugify(title) ||
      id.slice(0, 8),
    title,
  };
}

export function projectTemplate(project: ProjectFields): Template {
  return {
    content: "",
    kind: PROJECT_KIND,
    tags: [
      ["d", project.id],
      ["title", project.title],
      ["description", project.description],
      ["slug", project.slug],
      ["color", project.color],
      ...project.members
        .filter((member) => member !== project.creator)
        .map((member) => ["p", member]),
      ["alt", `Project: ${project.title}`],
    ],
  };
}

export function deleteProjectTemplate(project: Project): Template {
  return {
    content: "",
    kind: DELETE_KIND,
    tags: [
      ["a", project.address],
      ["k", String(PROJECT_KIND)],
    ],
  };
}

export function sortProjects(projects: Project[]): Project[] {
  return projects.toSorted(
    (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
  );
}
