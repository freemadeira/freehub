import { unixNow } from "applesauce-core/helpers/time";
import type { Observable } from "rxjs";
import { filter, take } from "rxjs";

import type { CatalogsDoc } from "@/lib/catalog-marks";
import {
  CATALOGS_D,
  catalogsDocTemplate,
  mergeCatalogsDocs,
  NO_CATALOG_MARKS,
  parseCatalogsDoc,
  sameCatalogsDoc,
  serializeCatalogsDoc,
  withAllSeen,
  withSeen,
  withStars,
} from "@/lib/catalog-marks";
import type { Catalog, Link } from "@/lib/catalogs";
import { syncedPrivateDoc } from "@/lib/private-doc";

/** A catalog and its links, as marking them seen needs them. */
export interface SeenIn {
  catalog: Catalog;
  links: readonly Link[];
}

/** Links seen on screen lately are marked together, this long after the first. */
const SEEN_DELAY = 400;

export interface CatalogStore {
  marks$: Observable<CatalogsDoc>;
  setStarred: (ids: string[], starred: boolean) => void;
  /**
   * Marks a link seen, once it's been on screen, with others seen about
   * then. Its catalog and links are looked up when they're marked.
   */
  markSeen: (
    catalog: string,
    id: string,
    find: () => SeenIn | undefined
  ) => void;
  markAllSeen: (catalog: Catalog) => void;
}

function syncedCatalogStore(pubkey: string): CatalogStore {
  const doc = syncedPrivateDoc<CatalogsDoc>(pubkey, {
    d: CATALOGS_D,
    empty: NO_CATALOG_MARKS,
    merge: mergeCatalogsDocs,
    parse: parseCatalogsDoc,
    same: sameCatalogsDoc,
    serialize: serializeCatalogsDoc,
    storage: "catalogs",
    template: catalogsDocTemplate,
  });
  // Marks start once the relay's copy is in: what was saved before was never news.
  doc.loaded$.pipe(filter(Boolean), take(1)).subscribe(() => {
    if (doc.current().since === undefined) {
      doc.change({ ...doc.current(), since: unixNow() });
    }
  });

  const queued = new Map<
    string,
    { find: () => SeenIn | undefined; ids: Set<string> }
  >();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    let next = doc.current();
    for (const { find, ids } of queued.values()) {
      const found = find();
      if (found) {
        next = withSeen(next, found.catalog, found.links, [...ids], pubkey);
      }
    }
    queued.clear();
    doc.change(next);
  };

  return {
    markAllSeen: (catalog) =>
      doc.change(withAllSeen(doc.current(), catalog, unixNow())),
    markSeen: (catalog, id, find) => {
      const entry = queued.get(catalog) ?? { find, ids: new Set<string>() };
      entry.ids.add(id);
      queued.set(catalog, { ...entry, find });
      timer ??= setTimeout(flush, SEEN_DELAY);
    },
    marks$: doc.doc$,
    setStarred: (ids, starred) =>
      doc.change(withStars(doc.current(), ids, starred, Date.now())),
  };
}

const stores = new Map<string, CatalogStore>();

/** The catalog marks of one account, shared by everything that shows them. */
export function catalogStore(pubkey: string): CatalogStore {
  let store = stores.get(pubkey);
  if (!store) {
    store = syncedCatalogStore(pubkey);
    stores.set(pubkey, store);
  }
  return store;
}
