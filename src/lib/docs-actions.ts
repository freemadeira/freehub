import type { NostrEvent } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";

import type { DocPage, DocPageFields, DocsContent } from "@/lib/docs";
import {
  descendants,
  lastRank,
  pageTemplate,
  pageTombstoneTemplate,
} from "@/lib/docs";
import {
  DOC_PAGE_KIND,
  isDeleted,
  newer,
  newId,
  rankBetween,
} from "@/lib/model";
import { accounts, eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { publish } from "@/lib/publish";

/** Starts a page, last under `parent`. Its id is known at once, to open it. */
export function createPage(
  project: Project,
  content: DocsContent,
  page: Partial<Pick<DocPageFields, "title" | "icon" | "content">> & {
    parent?: string;
  } = {}
): { id: string; saved: Promise<boolean> } {
  const id = newId();
  const saved = publish(
    pageTemplate(project, {
      content: page.content ?? "",
      createdAt: unixNow(),
      creator: accounts.active?.pubkey,
      icon: page.icon ?? "",
      id,
      mentions: [],
      parent: page.parent,
      rank: lastRank(content, page.parent),
      title: page.title ?? "",
    })
  );
  return { id, saved };
}

/** Saves the page with the given changes, as edited from its newest version. */
export function updatePage(
  project: Project,
  page: DocPage,
  changes: Partial<DocPageFields>
): Promise<boolean> {
  return publish(
    pageTemplate(project, { ...page, ...changes }, page.event),
    page.event
  );
}

/**
 * Moves the page under `parent` (or to the top), between the pages `before`
 * and `after` there, or last when neither is given.
 */
export function movePage(
  project: Project,
  content: DocsContent,
  page: DocPage,
  parent?: string,
  { before, after }: { before?: DocPage; after?: DocPage } = {}
): Promise<boolean> {
  const rank =
    before || after
      ? rankBetween(before?.rank, after?.rank)
      : lastRank(content, parent);
  return updatePage(project, page, { parent, rank });
}

/** Deletes the page and every page under it. */
export function deletePage(
  project: Project,
  content: DocsContent,
  page: DocPage
): Promise<boolean[]> {
  return Promise.all(
    [page, ...descendants(content, page)].map((item) =>
      publish(pageTombstoneTemplate(project, item), item.event)
    )
  );
}

/** Whether the page's newest version, from any member, deletes it. */
export function isPageDeleted(project: Project, id: string): boolean {
  let latest: NostrEvent | undefined;
  for (const member of project.members) {
    const event = eventStore.getReplaceable(DOC_PAGE_KIND, member, id);
    if (event && (!latest || newer(event, latest))) {
      latest = event;
    }
  }
  return latest !== undefined && isDeleted(latest);
}

/** Whether `page` may move under `parent`: never under itself. */
export function canMoveUnder(
  content: DocsContent,
  page: DocPage,
  parent: string | undefined
): boolean {
  return (
    parent === undefined ||
    (parent !== page.id &&
      !descendants(content, page).some((item) => item.id === parent))
  );
}
