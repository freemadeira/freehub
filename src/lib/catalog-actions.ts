import { unixNow } from "applesauce-core/helpers/time";
import { filter, firstValueFrom, map, timeout } from "rxjs";
import { toast } from "sonner";

import { getConfig } from "@/config";
import { catalogStore } from "@/lib/catalog-store";
import type {
  Byline,
  Catalog,
  CatalogCategory,
  CatalogFields,
  CatalogsContent,
  Link,
  LinkEdits,
  LinkFields,
  LinkType,
  SavedLink,
  SortFailure,
  SortReport,
} from "@/lib/catalogs";
import {
  catalogTemplate,
  catalogTombstoneTemplate,
  categoryKey,
  cleanCategoryName,
  clip,
  linkCommentTemplate,
  linkKey,
  linkTemplate,
  MAX_BYLINE,
  MAX_CATALOG_DESCRIPTION,
  MAX_CATALOG_NAME,
  MAX_CATEGORIES,
  MAX_LINK_BATCH,
  MAX_LINK_CATEGORIES,
  MAX_LINK_TITLE,
  MAX_LINKS_AT_ONCE,
  MAX_NOTE,
  MAX_SUMMARY,
  nextCategoryColor,
  resolveCatalogs,
  splitPasted,
} from "@/lib/catalogs";
import { shortId } from "@/lib/crm";
import type { Comment } from "@/lib/model";
import {
  CATALOG_KIND,
  deleteCommentTemplate,
  LINK_KIND,
  newId,
  READING_KIND,
} from "@/lib/model";
import { accounts, eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { publish } from "@/lib/publish";
import { plural } from "@/lib/utils";

/** How long a toast waits on the reader to say how sorting went. */
const SORT_WAIT = 3 * 60_000;

function me(): string | undefined {
  return accounts.active?.pubkey;
}

/** Whose readings of links are trusted: the organization's reader, if it runs one. */
export function catalogReaders(): ReadonlySet<string> {
  const reader = getConfig().reader?.pubkey;
  return new Set(reader ? [reader] : []);
}

/** Whether the organization runs a reader, which reads links and sorts them. */
export function hasReader(): boolean {
  return getConfig().reader !== undefined;
}

/**
 * The project's catalogs as the store has them now, changes still at the
 * signer included: each change in a batch sees the ones before it.
 */
export function currentCatalogs(project: Project): CatalogsContent {
  return resolveCatalogs(
    project,
    eventStore.getTimeline([
      {
        "#a": [project.address],
        kinds: [CATALOG_KIND, LINK_KIND, READING_KIND],
      },
    ]),
    catalogReaders()
  );
}

function tooMany(count: number): boolean {
  if (count > MAX_LINK_BATCH) {
    toast.error(`Up to ${MAX_LINK_BATCH} at a time.`);
    return true;
  }
  return false;
}

// ———————————————————————————————————————— Catalogs

export interface CatalogDraft {
  title: string;
  description: string;
}

function catalogFields(catalog: Catalog): CatalogFields {
  return {
    categories: catalog.categories,
    createdAt: catalog.createdAt,
    creator: catalog.creator,
    description: catalog.description,
    dismissed: catalog.dismissed,
    id: catalog.id,
    sorts: catalog.sorts,
    title: catalog.title,
  };
}

/** The catalog as it is now, with the changes made from it. */
function saveCatalog(
  project: Project,
  catalog: Catalog,
  changes: (fields: CatalogFields) => Partial<CatalogFields>
): Promise<boolean> {
  const latest = currentCatalogs(project).byId.get(catalog.id) ?? catalog;
  const fields = catalogFields(latest);
  return publish(
    catalogTemplate(project, { ...fields, ...changes(fields) }),
    latest.event
  );
}

function cleanDraft(draft: CatalogDraft): CatalogDraft | undefined {
  const title = draft.title.trim().slice(0, MAX_CATALOG_NAME);
  if (!title) {
    toast.error("Give the catalog a name.");
    return undefined;
  }
  return {
    description: draft.description.trim().slice(0, MAX_CATALOG_DESCRIPTION),
    title,
  };
}

/** Starts a catalog in the project. Its id is known at once, to open it. */
export function createCatalog(
  project: Project,
  draft: CatalogDraft
): { id: string; saved: Promise<boolean> } | undefined {
  const clean = cleanDraft(draft);
  if (!clean) {
    return undefined;
  }
  const id = newId();
  const saved = publish(
    catalogTemplate(project, {
      ...clean,
      categories: [],
      createdAt: unixNow(),
      creator: me(),
      dismissed: [],
      id,
      sorts: [],
    })
  );
  return { id, saved };
}

export function updateCatalog(
  project: Project,
  catalog: Catalog,
  draft: CatalogDraft
): Promise<boolean> {
  const clean = cleanDraft(draft);
  return clean
    ? saveCatalog(project, catalog, () => clean)
    : Promise.resolve(false);
}

/** Deletes the catalog for everyone; its links go with it. */
export function deleteCatalog(
  project: Project,
  catalog: Catalog
): Promise<boolean> {
  return publish(catalogTombstoneTemplate(project, catalog), catalog.event);
}

/** Why sorting didn't run, as the person reads it. */
const SORT_FAILURES: Record<SortFailure, string> = {
  failed: "Sorting didn’t work this time. Try again.",
  limit: "Too many AI runs lately. Try again in a while.",
  off: "AI isn’t set up on the reader, so links can’t be sorted.",
};

/** How the reader's sorting into the category went, once it says. */
function sortReport(
  project: Project,
  catalog: string,
  category: string,
  at: number
): Promise<SortReport | undefined> {
  return firstValueFrom(
    eventStore
      .timeline([
        {
          "#a": [project.address],
          authors: [...catalogReaders()],
          kinds: [READING_KIND],
        },
      ])
      .pipe(
        map((events) =>
          resolveCatalogs(project, events, catalogReaders())
            .sorts.get(catalog)
            ?.find((report) => report.category === category && report.at >= at)
        ),
        filter((report) => report !== undefined),
        timeout({ first: SORT_WAIT, with: () => [undefined] })
      )
  );
}

/** Says how sorting into the category went, once the reader does, in the toast that waits for it. */
async function announceSort(
  project: Project,
  catalog: Catalog,
  category: CatalogCategory,
  at: number
): Promise<void> {
  const id = toast.loading(`Sorting links into ${category.name}…`);
  const report = await sortReport(project, catalog.id, category.id, at);
  if (!report) {
    toast.dismiss(id);
  } else if (report.ok) {
    toast.success(
      report.filed > 0
        ? `Filed ${plural(report.filed, "link")} under ${category.name}`
        : `No other links belong in ${category.name}`,
      { id }
    );
  } else {
    toast.error(SORT_FAILURES[report.reason], { id });
  }
}

/**
 * Asks the reader to sort the catalog's links into the categories, with a
 * toast for each that says how it went.
 */
export async function sortInto(
  project: Project,
  catalog: Catalog,
  categories: CatalogCategory[]
): Promise<void> {
  if (categories.length === 0) {
    return;
  }
  const at = unixNow();
  const ids = new Set(categories.map((category) => category.id));
  const saved = await saveCatalog(project, catalog, (fields) => ({
    sorts: [
      ...fields.sorts.filter((sort) => !ids.has(sort.category)),
      ...categories.map((category) => ({ at, category: category.id })),
    ],
  }));
  if (!saved) {
    return;
  }
  await Promise.all(
    categories.map((category) => announceSort(project, catalog, category, at))
  );
}

/** Offers to sort links into categories just added or renamed. */
function offerSort(
  project: Project,
  catalog: Catalog,
  categories: CatalogCategory[]
): void {
  const links = currentCatalogs(project).linksIn.get(catalog.id) ?? [];
  if (!hasReader() || links.length === 0 || categories.length === 0) {
    return;
  }
  const [only] = categories;
  toast(
    categories.length === 1 && only
      ? `Sort existing links into ${only.name}?`
      : `Sort existing links into the ${categories.length} new categories?`,
    {
      action: {
        label: "Sort",
        onClick: () => sortInto(project, catalog, categories),
      },
      duration: 10_000,
    }
  );
}

/**
 * Saves the catalog's categories as edited, then offers to sort links into
 * new or renamed ones. Links in a category deleted stay where they are.
 */
export async function editCategories(
  project: Project,
  catalog: Catalog,
  categories: CatalogCategory[]
): Promise<boolean> {
  const names = new Set<string>();
  const clean: CatalogCategory[] = [];
  for (const category of categories) {
    const name = cleanCategoryName(category.name);
    if (!name) {
      toast.error("Name each category.");
      return false;
    }
    if (names.has(categoryKey(name))) {
      toast.error(`There are two categories named “${name}”.`);
      return false;
    }
    names.add(categoryKey(name));
    clean.push({ ...category, name });
  }
  if (clean.length > MAX_CATEGORIES) {
    toast.error(`A catalog keeps up to ${MAX_CATEGORIES} categories.`);
    return false;
  }
  const saved = await saveCatalog(project, catalog, (fields) => ({
    categories: clean,
    sorts: fields.sorts.filter((sort) =>
      clean.some((category) => category.id === sort.category)
    ),
  }));
  if (saved) {
    const before = new Map(catalog.categories.map((c) => [c.id, c.name]));
    offerSort(
      project,
      catalog,
      clean.filter((category) => before.get(category.id) !== category.name)
    );
  }
  return saved;
}

/** A new category, in the next color round the palette. */
export function newCategory(
  catalog: Pick<Catalog, "categories">,
  name: string
): CatalogCategory {
  return {
    color: nextCategoryColor(catalog.categories),
    id: shortId(),
    name: cleanCategoryName(name),
  };
}

/**
 * Adds a category the reader suggested; the links that suggested it are filed
 * under it, unless they were filed by hand.
 */
export async function acceptSuggestion(
  project: Project,
  catalog: Catalog,
  name: string
): Promise<void> {
  const latest = currentCatalogs(project).byId.get(catalog.id) ?? catalog;
  const key = categoryKey(name);
  if (
    !latest.categories.some((category) => categoryKey(category.name) === key)
  ) {
    if (latest.categories.length >= MAX_CATEGORIES) {
      toast.error(`A catalog keeps up to ${MAX_CATEGORIES} categories.`);
      return;
    }
    const added = newCategory(latest, name);
    const saved = await saveCatalog(project, latest, (fields) => ({
      categories: [...fields.categories, added],
    }));
    if (!saved) {
      return;
    }
    const content = currentCatalogs(project);
    const links = content.linksIn.get(catalog.id) ?? [];
    const filed = links.filter((link) =>
      link.categories.includes(added.id)
    ).length;
    const rest = links.length - filed;
    const updated = content.byId.get(catalog.id) ?? latest;
    toast.success(
      `Added ${added.name}${filed > 0 ? ` · filed ${plural(filed, "link")}` : ""}`,
      rest > 0 && hasReader()
        ? {
            action: {
              label: "Sort the rest",
              onClick: () => sortInto(project, updated, [added]),
            },
            duration: 8000,
          }
        : undefined
    );
  }
}

/** Waves a suggested category away, from every link that suggested it. */
export function dismissSuggestion(
  project: Project,
  catalog: Catalog,
  name: string
): Promise<boolean> {
  return saveCatalog(project, catalog, (fields) => ({
    dismissed: [
      ...fields.dismissed.filter((item) => item !== categoryKey(name)),
      categoryKey(name),
    ],
  }));
}

// ———————————————————————————————————————— Links

function linkFields(link: SavedLink): LinkFields {
  return {
    catalog: link.catalog,
    createdAt: link.createdAt,
    creator: link.creator,
    edits: link.edits,
    id: link.id,
    note: link.note,
    readAt: link.readAt,
    url: link.url,
  };
}

/** The link as it is now, with the changes made from it. */
function saveLink(
  project: Project,
  link: Pick<Link, "id" | "saved">,
  changes: (fields: LinkFields) => Partial<LinkFields>
): Promise<boolean> {
  const latest =
    currentCatalogs(project).linkById.get(link.id)?.saved ?? link.saved;
  const fields = linkFields(latest);
  return publish(
    linkTemplate(project, { ...fields, ...changes(fields) }),
    latest.event
  );
}

/** What saving found: links added, links the catalog had already, and others elsewhere in the project. */
export interface Saved {
  added: string[];
  existing: string[];
  /** Links just added that another catalog in the project has too, by that catalog's title. */
  elsewhere: { link: string; catalog: string }[];
}

// ———————————————————————————————————————— Comments

export function addLinkComment(
  link: Pick<Link, "id" | "author" | "savedBy">,
  content: string
): Promise<boolean> {
  return publish(
    linkCommentTemplate(
      { author: link.author, creator: link.savedBy, id: link.id },
      content
    )
  );
}

export function deleteLinkComment(comment: Comment): Promise<boolean> {
  return publish(deleteCommentTemplate(comment));
}

// ———————————————————————————————————————— Saving

/** Says what saving found. */
function announceSaved(saved: Saved): void {
  const [elsewhere] = saved.elsewhere;
  if (saved.added.length === 0) {
    toast(
      saved.existing.length === 1
        ? "Already saved here"
        : `All ${saved.existing.length} were saved here already`
    );
  } else if (elsewhere && saved.added.length === 1) {
    toast.success(`Saved · it’s in ${elsewhere.catalog} too`);
  } else if (saved.existing.length > 0) {
    toast.success(
      `Saved ${plural(saved.added.length, "link")} · ${saved.existing.length} already here`
    );
  } else if (saved.added.length > 1) {
    toast.success(`Saved ${plural(saved.added.length, "link")}`);
  }
}

/**
 * Saves the links in the text, with the rest of it as their note. A link the
 * catalog has already isn't saved twice: the note goes on it as a comment.
 */
export async function saveLinks(
  project: Project,
  catalog: Pick<Catalog, "id" | "title">,
  text: string,
  { quiet = false }: { quiet?: boolean } = {}
): Promise<Saved | undefined> {
  const creator = me();
  const { links, note } = splitPasted(text);
  if (!creator) {
    return undefined;
  }
  if (links.length === 0) {
    toast.error("Paste a link to save, like https://…");
    return undefined;
  }
  if (links.length > MAX_LINKS_AT_ONCE) {
    toast.error(`Save up to ${MAX_LINKS_AT_ONCE} links at a time.`);
    return undefined;
  }
  const kept = note.slice(0, MAX_NOTE);
  const content = currentCatalogs(project);
  const saved: Saved = { added: [], elsewhere: [], existing: [] };
  const saves: Promise<boolean>[] = [];
  for (const url of links) {
    const key = linkKey(url);
    const same = content.links.filter((link) => link.key === key);
    const there = same.find((link) => link.catalog === catalog.id);
    if (there) {
      saved.existing.push(there.id);
      if (kept) {
        saves.push(addLinkComment(there, kept));
      }
      continue;
    }
    const id = newId();
    saves.push(
      publish(
        linkTemplate(project, {
          catalog: catalog.id,
          createdAt: unixNow(),
          creator,
          edits: {},
          id,
          note: kept,
          url,
        })
      )
    );
    saved.added.push(id);
    const other = same.find((link) => link.catalog !== catalog.id);
    const otherCatalog = other && content.byId.get(other.catalog);
    if (otherCatalog) {
      saved.elsewhere.push({ catalog: otherCatalog.title, link: id });
    }
  }
  const done = await Promise.all(saves);
  if (!done.some(Boolean) && saves.length > 0) {
    return undefined;
  }
  if (!quiet) {
    announceSaved(saved);
  }
  return saved;
}

/** What can change on a link by hand. */
export interface LinkChanges {
  title?: string;
  summary?: string;
  note?: string;
  type?: LinkType;
  /** Who made it; empty takes them off. */
  creator?: string;
  categories?: string[];
}

/** Changes what's given; it shows over what was read until it's handed back. */
export function updateLink(
  project: Project,
  link: Link,
  changes: LinkChanges
): Promise<boolean> {
  const edits: LinkEdits = {};
  if (changes.title !== undefined) {
    const title = clip(changes.title, MAX_LINK_TITLE);
    if (!title) {
      toast.error("Give the link a title.");
      return Promise.resolve(false);
    }
    edits.title = title;
  }
  if (changes.summary !== undefined) {
    edits.summary = changes.summary.trim().slice(0, MAX_SUMMARY);
  }
  if (changes.type !== undefined) {
    edits.type = changes.type;
  }
  if (changes.creator !== undefined) {
    const name = clip(changes.creator, MAX_BYLINE);
    const byline: Byline | null = name
      ? { name, url: link.byline?.name === name ? link.byline.url : undefined }
      : null;
    edits.byline = byline;
  }
  if (changes.categories !== undefined) {
    if (changes.categories.length > MAX_LINK_CATEGORIES) {
      toast.error(`A link goes in up to ${MAX_LINK_CATEGORIES} categories.`);
      return Promise.resolve(false);
    }
    edits.filed = [...new Set(changes.categories)];
  }
  return saveLink(project, link, (fields) => ({
    edits: { ...fields.edits, ...edits },
    ...(changes.note === undefined
      ? {}
      : { note: changes.note.trim().slice(0, MAX_NOTE) }),
  }));
}

/** Hands what was changed by hand back to what the reader made of the link. */
export function resetLink(project: Project, link: Link): Promise<boolean> {
  return saveLink(project, link, () => ({ edits: {} }));
}

/** Asks the reader to read the link again, as its page says now. */
export function rereadLink(project: Project, link: Link): Promise<boolean> {
  return saveLink(project, link, () => ({ readAt: unixNow() }));
}

/** Files links under a category, or takes them out of it, by hand. */
export async function fileLinks(
  project: Project,
  links: Link[],
  category: string,
  filed: boolean
): Promise<boolean> {
  if (tooMany(links.length)) {
    return false;
  }
  let full = 0;
  const saves: Promise<boolean>[] = [];
  for (const link of links) {
    const has = link.categories.includes(category);
    if (has === filed) {
      continue;
    }
    if (filed && link.categories.length >= MAX_LINK_CATEGORIES) {
      full += 1;
      continue;
    }
    saves.push(
      updateLink(project, link, {
        categories: filed
          ? [...link.categories, category]
          : link.categories.filter((id) => id !== category),
      })
    );
  }
  if (full > 0) {
    toast(
      `${plural(full, "link")} already ${full === 1 ? "has" : "have"} ${MAX_LINK_CATEGORIES} categories`
    );
  }
  const done = await Promise.all(saves);
  return done.every(Boolean);
}

/** Brings deleted links back as they were. */
function restoreLinks(project: Project, links: Link[]): void {
  for (const link of links) {
    const tombstone = eventStore.getReplaceable(LINK_KIND, me() ?? "", link.id);
    publish(linkTemplate(project, linkFields(link.saved)), tombstone);
  }
}

/** Deletes links, with a toast to bring them back. */
export async function removeLinks(
  project: Project,
  links: Link[]
): Promise<boolean> {
  if (tooMany(links.length) || links.length === 0) {
    return false;
  }
  const done = await Promise.all(
    links.map((link) =>
      publish(catalogTombstoneTemplate(project, link), link.event)
    )
  );
  const removed = links.filter((_, index) => done[index]);
  if (removed.length > 0) {
    toast.success(
      removed.length === 1
        ? "Link deleted"
        : `${plural(removed.length, "link")} deleted`,
      {
        action: {
          label: "Undo",
          onClick: () => restoreLinks(project, removed),
        },
      }
    );
  }
  return removed.length === links.length;
}

/**
 * Moves links to another catalog, and has the reader file them there. Ones
 * filed by hand keep the categories the other catalog has by the same name;
 * ones it has already stay where they are. Into another project, a link
 * starts over there: its comments and reactions stay behind.
 */
export async function moveLinks(
  project: Project,
  links: Link[],
  to: { project: Project; catalog: Catalog }
): Promise<boolean> {
  if (tooMany(links.length)) {
    return false;
  }
  const from = currentCatalogs(project);
  const target = currentCatalogs(to.project);
  const known = new Set(
    (target.linksIn.get(to.catalog.id) ?? []).map((link) => link.key)
  );
  let skipped = 0;
  const saves: Promise<boolean>[] = [];
  for (const link of links) {
    if (link.catalog === to.catalog.id) {
      continue;
    }
    if (known.has(link.key)) {
      skipped += 1;
      continue;
    }
    known.add(link.key);
    const names = new Map(
      (from.byId.get(link.catalog)?.categories ?? []).map((category) => [
        category.id,
        categoryKey(category.name),
      ])
    );
    const filed = link.saved.edits.filed?.flatMap((id) => {
      const found = to.catalog.categories.find(
        (category) => categoryKey(category.name) === names.get(id)
      );
      return found ? [found.id] : [];
    });
    const fields: LinkFields = {
      ...linkFields(link.saved),
      catalog: to.catalog.id,
      edits: { ...link.saved.edits, filed },
      readAt: unixNow(),
    };
    if (to.project.address === project.address) {
      saves.push(publish(linkTemplate(project, fields), link.event));
    } else {
      saves.push(
        publish(linkTemplate(to.project, { ...fields, id: newId() })),
        publish(catalogTombstoneTemplate(project, link), link.event)
      );
    }
  }
  const done = await Promise.all(saves);
  const moved = links.length - skipped;
  if (moved > 0 || skipped > 0) {
    const said = `Moved ${plural(moved, "link")} to ${to.catalog.title}`;
    toast.success(
      skipped > 0
        ? `${said} · ${skipped} ${skipped === 1 ? "was" : "were"} there already`
        : said
    );
  }
  return done.every(Boolean);
}

/** Stars links for the signed-in person, or takes the star off. */
export function starLinks(ids: string[], starred: boolean): void {
  const pubkey = me();
  if (pubkey) {
    catalogStore(pubkey).setStarred(ids, starred);
  }
}

/** Marks a link as seen by the person, once it's been on screen. */
export function markSeen(project: Project, catalog: string, id: string): void {
  const pubkey = me();
  if (!pubkey) {
    return;
  }
  catalogStore(pubkey).markSeen(catalog, id, () => {
    const content = currentCatalogs(project);
    const found = content.byId.get(catalog);
    return (
      found && { catalog: found, links: content.linksIn.get(catalog) ?? [] }
    );
  });
}

export function markAllSeen(catalog: Catalog): void {
  const pubkey = me();
  if (pubkey) {
    catalogStore(pubkey).markAllSeen(catalog);
  }
}
