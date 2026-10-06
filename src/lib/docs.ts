import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import type { Template } from "@/lib/model";
import {
  addressOf,
  DOC_PAGE_KIND,
  integer,
  isDeleted,
  isPubkey,
  latestVersions,
  PROJECT_KIND,
} from "@/lib/model";
import type { Project } from "@/lib/project";

const DRAFT = "draft-";
const EXCERPT_LENGTH = 160;
const MARKDOWN_SYNTAX =
  /!?\[(?<text>[^\]]*)\]\([^)]*\)|^\s{0,3}(?:#{1,6}|>|[-+*]|\d{1,9}[.)])\s+|\[[ x]\]\s|[*_~`]+|\\(?=\S)|&nbsp;/gmu;

export interface DocPageFields {
  id: string;
  title: string;
  /** An emoji shown before the title, or empty for the default icon. */
  icon: string;
  /** The page's text, as markdown. */
  content: string;
  /** The page it sits under, or none at the top of the project's docs. */
  parent?: string;
  /** Order among the pages under the same parent. */
  rank: number;
  createdAt: number;
  creator?: string;
}

export type DocPage = DocPageFields & {
  /** Address of the project the page belongs to. */
  project: string;
  /** Who saved the newest version. */
  author: string;
  updatedAt: number;
  event: NostrEvent;
};

export interface DocsContent {
  /** Every page, parents before their children, siblings in order. */
  pages: DocPage[];
  /** Pages at the top of the project's docs, in order. */
  roots: DocPage[];
  byId: Map<string, DocPage>;
  /** Pages under each page, in order. */
  children: Map<string, DocPage[]>;
  /** Each member's newest version of every page, to merge edits made at once. */
  versions: Map<string, NostrEvent[]>;
}

export const EMPTY_DOCS: DocsContent = {
  byId: new Map(),
  children: new Map(),
  pages: [],
  roots: [],
  versions: new Map(),
};

export function pageTitle(page: Pick<DocPageFields, "title">): string {
  return page.title.trim() || "Untitled";
}

/** A version saved and signed, as opposed to one still waiting on the signer. */
export function isSigned(event: NostrEvent): boolean {
  return !event.id.startsWith(DRAFT);
}

/** The opening words of a page, without its markdown. */
export function pageExcerpt(page: Pick<DocPageFields, "content">): string {
  const text = page.content
    .replace(MARKDOWN_SYNTAX, (_, link: string | undefined) => link ?? "")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return text.length > EXCERPT_LENGTH
    ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : text;
}

function parsePage(event: NostrEvent, id: string, project: string): DocPage {
  return {
    author: event.pubkey,
    content: event.content,
    createdAt: integer(getTagValue(event, "created")) ?? event.created_at,
    creator: [getTagValue(event, "creator")].find(isPubkey),
    event,
    icon: getTagValue(event, "icon")?.trim() ?? "",
    id,
    parent: getTagValue(event, "parent") || undefined,
    project,
    rank: Number(getTagValue(event, "rank")) || 0,
    title: getTagValue(event, "title") ?? "",
    updatedAt: event.created_at,
  };
}

function bySiblingOrder(a: DocPage, b: DocPage): number {
  return (
    a.rank - b.rank || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  );
}

// A page whose parent is gone, or that ends up under itself after two moves
// made at once, shows at the top instead of disappearing.
function placeable(page: DocPage, byId: Map<string, DocPage>): boolean {
  if (page.parent === undefined) {
    return true;
  }
  const seen = new Set<string>();
  for (
    let id: string | undefined = page.parent;
    id !== undefined && byId.has(id) && !seen.has(id);
    id = byId.get(id)?.parent
  ) {
    if (id === page.id) {
      return false;
    }
    seen.add(id);
  }
  return byId.has(page.parent);
}

/** The project's pages as a tree, resolved across every member's versions. */
export function resolveDocs(
  project: Project,
  events: NostrEvent[]
): DocsContent {
  const authors = new Set(project.members);
  const own = events.filter(
    (event) =>
      event.kind === DOC_PAGE_KIND &&
      authors.has(event.pubkey) &&
      addressOf(event, PROJECT_KIND) === project.address
  );
  const parsed = [...latestVersions(own, DOC_PAGE_KIND, authors)]
    .filter(([, event]) => !isDeleted(event))
    .map(([id, event]) => parsePage(event, id, project.address));
  const raw = new Map(parsed.map((page) => [page.id, page]));
  const placed = parsed.map((page) =>
    placeable(page, raw) ? page : { ...page, parent: undefined }
  );
  const byId = new Map(placed.map((page) => [page.id, page]));
  const children = new Map<string, DocPage[]>();
  const roots: DocPage[] = [];
  for (const page of placed.toSorted(bySiblingOrder)) {
    if (page.parent) {
      children.set(page.parent, [...(children.get(page.parent) ?? []), page]);
    } else {
      roots.push(page);
    }
  }
  const pages: DocPage[] = [];
  const visit = (page: DocPage) => {
    pages.push(page);
    for (const child of children.get(page.id) ?? []) {
      visit(child);
    }
  };
  for (const root of roots) {
    visit(root);
  }
  const versions = new Map<string, NostrEvent[]>();
  for (const event of own) {
    const id = getTagValue(event, "d");
    if (id && byId.has(id)) {
      versions.set(id, [...(versions.get(id) ?? []), event]);
    }
  }
  return { byId, children, pages, roots, versions };
}

/** The pages above this one, from the top down. */
export function ancestors(content: DocsContent, page: DocPage): DocPage[] {
  const chain: DocPage[] = [];
  for (
    let parent = page.parent && content.byId.get(page.parent);
    parent;
    parent = parent.parent && content.byId.get(parent.parent)
  ) {
    chain.unshift(parent);
  }
  return chain;
}

/** Every page under this one, at any depth. */
export function descendants(content: DocsContent, page: DocPage): DocPage[] {
  return (content.children.get(page.id) ?? []).flatMap((child) => [
    child,
    ...descendants(content, child),
  ]);
}

/** The rank that puts a page last among the pages under `parent`. */
export function lastRank(content: DocsContent, parent?: string): number {
  const siblings = parent
    ? (content.children.get(parent) ?? [])
    : content.roots;
  return (siblings.at(-1)?.rank ?? 0) + 1;
}

/**
 * A version of the page. `prev` names the version it was edited from, so a
 * teammate's editor can merge it with edits of their own made meanwhile.
 */
export function pageTemplate(
  project: Project,
  page: DocPageFields,
  prev?: NostrEvent
): Template {
  const tags = [
    ["d", page.id],
    ["a", project.address],
    ["title", page.title],
    ["rank", String(page.rank)],
    ["created", String(page.createdAt)],
  ];
  if (page.icon) {
    tags.push(["icon", page.icon]);
  }
  if (page.parent) {
    tags.push(["parent", page.parent]);
  }
  if (page.creator) {
    tags.push(["creator", page.creator]);
  }
  if (prev && isSigned(prev)) {
    tags.push(["prev", prev.id]);
  }
  tags.push(["alt", `Doc page: ${pageTitle(page)}`]);
  return { content: page.content, kind: DOC_PAGE_KIND, tags };
}

export function pageTombstoneTemplate(
  project: Project,
  page: DocPage
): Template {
  return {
    content: "",
    kind: DOC_PAGE_KIND,
    tags: [["d", page.id], ["a", project.address], ["deleted"]],
  };
}
