import { useState } from "react";

import type { ShownLink } from "@/features/catalogs/catalog-context";
import type { Catalog, CatalogCategory, LinkType } from "@/lib/catalogs";
import { hostOf, LINK_TYPE_NAMES, platformName } from "@/lib/catalogs";
import { searchTerms } from "@/lib/search";
import { readStorage, writeStorage } from "@/lib/utils";

/** What the category pills show: everything, what's new or starred, one category, or none. */
export type Shelf = "all" | "new" | "starred" | "none" | `category:${string}`;

export interface LinkFilters {
  platforms: string[];
  types: LinkType[];
  savers: string[];
}

export const NO_FILTERS: LinkFilters = { platforms: [], savers: [], types: [] };

export function activeFilters(filters: LinkFilters): number {
  return (
    filters.platforms.length + filters.types.length + filters.savers.length
  );
}

export const SORTS = [
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
  { label: "Recently published", value: "published" },
  { label: "Title", value: "title" },
] as const;
export type Sort = (typeof SORTS)[number]["value"];

export const GROUPS = [
  { label: "None", value: "none" },
  { label: "Category", value: "category" },
  { label: "Platform", value: "platform" },
  { label: "Type", value: "type" },
  { label: "Creator", value: "creator" },
  { label: "Saved by", value: "saver" },
] as const;
export type Grouping = (typeof GROUPS)[number]["value"];

export type Layout = "gallery" | "list";

export interface Display {
  layout: Layout;
  sort: Sort;
  group: Grouping;
}

const DEFAULT_DISPLAY: Display = {
  group: "none",
  layout: "gallery",
  sort: "newest",
};

function displayKey(catalog: string): string {
  return `catalog:${catalog}:display`;
}

function readDisplay(catalog: string): Display {
  try {
    const stored: unknown = JSON.parse(
      readStorage(displayKey(catalog)) ?? "{}"
    );
    const value =
      typeof stored === "object" && stored !== null
        ? (stored as Partial<Display>)
        : {};
    return {
      group:
        GROUPS.find((item) => item.value === value.group)?.value ??
        DEFAULT_DISPLAY.group,
      layout: value.layout === "list" ? "list" : "gallery",
      sort:
        SORTS.find((item) => item.value === value.sort)?.value ??
        DEFAULT_DISPLAY.sort,
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

/** How the catalog lays out, sorts and groups its links, remembered on this device. */
export function useDisplay(
  catalog: string
): [Display, (changes: Partial<Display>) => void] {
  const [display, setDisplay] = useState(() => readDisplay(catalog));
  const change = (changes: Partial<Display>) => {
    const next = { ...display, ...changes };
    setDisplay(next);
    const same =
      next.group === DEFAULT_DISPLAY.group &&
      next.layout === DEFAULT_DISPLAY.layout &&
      next.sort === DEFAULT_DISPLAY.sort;
    writeStorage(displayKey(catalog), same ? null : JSON.stringify(next));
  };
  return [display, change];
}

/** Whether the link is on the shelf picked from the pills. */
export function onShelf(link: ShownLink, shelf: Shelf): boolean {
  switch (shelf) {
    case "all": {
      return true;
    }
    case "new": {
      return link.isNew;
    }
    case "starred": {
      return link.starred;
    }
    case "none": {
      return link.categories.length === 0;
    }
    default: {
      return link.categories.includes(shelf.slice("category:".length));
    }
  }
}

/** Every word searched for is somewhere in the link's title, summary, note, creator or site. */
function matches(link: ShownLink, terms: string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const text = [
    link.title,
    link.summary,
    link.note,
    link.byline?.name ?? "",
    hostOf(link.url),
    link.originalTitle ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => text.includes(term));
}

export function filterLinks(
  links: ShownLink[],
  {
    shelf,
    search,
    filters,
  }: { shelf: Shelf; search: string; filters: LinkFilters }
): ShownLink[] {
  const terms = searchTerms(search);
  return links.filter(
    (link) =>
      onShelf(link, shelf) &&
      matches(link, terms) &&
      (filters.platforms.length === 0 ||
        filters.platforms.includes(link.platform)) &&
      (filters.types.length === 0 || filters.types.includes(link.type)) &&
      (filters.savers.length === 0 || filters.savers.includes(link.savedBy))
  );
}

export function sortLinks(links: ShownLink[], sort: Sort): ShownLink[] {
  switch (sort) {
    case "oldest": {
      return links.toSorted((a, b) => a.savedAt - b.savedAt);
    }
    case "published": {
      // Those that don't say when they were published go last, newest saved first.
      return links.toSorted(
        (a, b) =>
          (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") ||
          b.savedAt - a.savedAt
      );
    }
    case "title": {
      return links.toSorted((a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true })
      );
    }
    default: {
      return links.toSorted((a, b) => b.savedAt - a.savedAt);
    }
  }
}

export interface LinkGroupOf {
  key: string;
  /** What heads the group: a category, platform, type, creator or person. */
  kind: Grouping;
  label: string;
  category?: CatalogCategory;
  platform?: string;
  pubkey?: string;
  links: ShownLink[];
}

/**
 * Links in groups, in the order their first link comes, but for categories,
 * which keep the catalog's order. A link in two categories is in both.
 */
export function groupLinks(
  links: ShownLink[],
  group: Grouping,
  catalog: Catalog
): LinkGroupOf[] {
  if (group === "none") {
    return [{ key: "all", kind: "none", label: "", links }];
  }
  if (group === "category") {
    const groups: LinkGroupOf[] = catalog.categories.map((category) => ({
      category,
      key: category.id,
      kind: "category",
      label: category.name,
      links: links.filter((link) => link.categories.includes(category.id)),
    }));
    groups.push({
      key: "none",
      kind: "category",
      label: "No category",
      links: links.filter((link) => link.categories.length === 0),
    });
    return groups.filter((item) => item.links.length > 0);
  }
  const groups = new Map<string, LinkGroupOf>();
  for (const link of links) {
    let key: string;
    let item: Omit<LinkGroupOf, "links" | "key">;
    switch (group) {
      case "platform": {
        key = link.platform;
        item = {
          kind: group,
          label: platformName(link.platform),
          platform: link.platform,
        };
        break;
      }
      case "type": {
        key = link.type;
        item = { kind: group, label: LINK_TYPE_NAMES[link.type] };
        break;
      }
      case "creator": {
        key = link.byline?.name.toLowerCase() ?? "";
        item = {
          kind: group,
          label: link.byline?.name ?? "Unknown",
          platform: link.platform,
        };
        break;
      }
      default: {
        key = link.savedBy;
        item = { kind: group, label: "", pubkey: link.savedBy };
      }
    }
    const known = groups.get(key);
    if (known) {
      known.links.push(link);
    } else {
      groups.set(key, { ...item, key, links: [link] });
    }
  }
  return [...groups.values()];
}
