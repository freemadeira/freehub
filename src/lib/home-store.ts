import type { Observable } from "rxjs";
import { map, shareReplay } from "rxjs";

import type { HomeDoc, HomePrefs, HomeSetting, Pin } from "@/lib/home";
import {
  findPinMark,
  HOME_D,
  homePrefs,
  homeTemplate,
  mergeHomeDocs,
  parseHomeDoc,
  sameHomeDoc,
  serializeHomeDoc,
  withPinMark,
} from "@/lib/home";
import { syncedPrivateDoc } from "@/lib/private-doc";

export interface HomeStore {
  prefs$: Observable<HomePrefs>;
  set: <K extends HomeSetting>(key: K, value: HomePrefs[K]) => void;
  /** Pins or unpins it, and returns the way to undo that. */
  setPinned: (pin: Pin, pinned: boolean) => () => void;
}

/** Settings show from this browser's copy at once, and go to the relay a moment after they change. */
function syncedHomeStore(pubkey: string): HomeStore {
  const doc = syncedPrivateDoc<HomeDoc>(pubkey, {
    d: HOME_D,
    empty: {},
    merge: mergeHomeDocs,
    parse: parseHomeDoc,
    same: sameHomeDoc,
    serialize: serializeHomeDoc,
    storage: "home",
    template: homeTemplate,
  });
  return {
    prefs$: doc.doc$.pipe(map(homePrefs), shareReplay(1)),
    set: (setting, value) =>
      doc.change({ ...doc.current(), [setting]: { at: Date.now(), value } }),
    setPinned: (pin, pinned) => {
      const before = findPinMark(doc.current(), pin);
      const at = Date.now();
      // Pinned again, it goes last; unpinned, it keeps its place for an undo.
      const order = before && (before.pinned || !pinned) ? before.order : at;
      doc.change(withPinMark(doc.current(), { at, order, pin, pinned }));
      return () =>
        doc.change(
          withPinMark(doc.current(), {
            at: Date.now(),
            order: before?.order ?? order,
            pin,
            pinned: before?.pinned ?? !pinned,
          })
        );
    },
  };
}

const stores = new Map<string, HomeStore>();

/** The Home settings of one account, shared by everything that shows them. */
export function homeStore(pubkey: string): HomeStore {
  let store = stores.get(pubkey);
  if (!store) {
    store = syncedHomeStore(pubkey);
    stores.set(pubkey, store);
  }
  return store;
}
