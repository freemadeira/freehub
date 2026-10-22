import type { RefCallback } from "react";
import { createContext, use, useCallback } from "react";

import { markSeen } from "@/lib/catalog-actions";
import type { CatalogsDoc } from "@/lib/catalog-marks";
import { isNewTo, starredLinks } from "@/lib/catalog-marks";
import type { Catalog, CatalogCategory, Link } from "@/lib/catalogs";
import type { Comment } from "@/lib/model";
import type { Project } from "@/lib/project";

/** A link as a catalog shows it to someone: with their star, whether it's new to them, and its comments. */
export type ShownLink = Link & {
  starred: boolean;
  isNew: boolean;
  commentCount: number;
};

/** The catalog's links as the person sees them, newest first. */
export function shownLinks(
  catalog: Catalog,
  links: readonly Link[],
  marks: CatalogsDoc,
  comments: ReadonlyMap<string, Comment[]>,
  me: string
): ShownLink[] {
  const stars = starredLinks(marks);
  return links.map((link) => ({
    ...link,
    commentCount: comments.get(link.id)?.length ?? 0,
    isNew: isNewTo(marks, catalog, link, me),
    starred: stars.has(link.id),
  }));
}

/** How many of the catalog's links are new to the person. */
export function countNew(
  catalog: Catalog,
  links: readonly Link[],
  marks: CatalogsDoc,
  me: string
): number {
  return links.filter((link) => isNewTo(marks, catalog, link, me)).length;
}

/** What a catalog's page shares with its cards, rows and quick look. */
export interface CatalogScope {
  catalog: Catalog;
  project: Project;
  /** Every link in the catalog, as shown, newest first. */
  links: ShownLink[];
  canEdit: boolean;
  /** Who's looking. */
  me: string;
  /** The catalog's categories by id. */
  categories: Map<string, CatalogCategory>;
  /** Links picked for something done to them all at once. */
  selected: ReadonlySet<string>;
  /** Picks a link, or unpicks it; with `range`, every link from the last one picked too. */
  toggle: (link: ShownLink, range: boolean) => void;
  /** Opens the link over the catalog. */
  open: (link: ShownLink) => void;
}

export const CatalogContext = createContext<CatalogScope | null>(null);

export function useCatalog(): CatalogScope {
  const scope = use(CatalogContext);
  if (!scope) {
    throw new Error("useCatalog needs a CatalogContext provider.");
  }
  return scope;
}

/** How long a new link stays on screen before it counts as seen. */
const SEEN_AFTER = 1000;

/**
 * Watches a new link's card, and marks the link seen once at least half of
 * it has been on screen for a second, while the page is in view.
 */
export function useSeenRef(link: ShownLink): RefCallback<HTMLElement> {
  const { project } = useCatalog();
  const { id, catalog, isNew } = link;
  return useCallback(
    (element: HTMLElement | null) => {
      if (!(element && isNew)) {
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observer = new IntersectionObserver(
        ([entry]) => {
          clearTimeout(timer);
          if (entry?.isIntersecting && document.visibilityState === "visible") {
            timer = setTimeout(
              () => markSeen(project, catalog, id),
              SEEN_AFTER
            );
          }
        },
        { threshold: 0.5 }
      );
      observer.observe(element);
      return () => {
        observer.disconnect();
        clearTimeout(timer);
      };
    },
    [project, catalog, id, isNew]
  );
}
