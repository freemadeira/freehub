import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Observable } from "rxjs";
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  shareReplay,
} from "rxjs";

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
import { onLeave } from "@/lib/leaving";
import { APP_DATA_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { decryptFor, encryptFor } from "@/lib/private-data";
import { publish } from "@/lib/publish";
import { access$, sync } from "@/lib/relays";
import { readStorage, writeStorage } from "@/lib/utils";

/** Changes wait this long for more before they're saved, so a run of them signs once. */
const SAVE_DELAY = 2000;

export interface HomeStore {
  prefs$: Observable<HomePrefs>;
  set: <K extends HomeSetting>(key: K, value: HomePrefs[K]) => void;
  /** Pins or unpins it, and returns the way to undo that. */
  setPinned: (pin: Pin, pinned: boolean) => () => void;
}

function readLocal(text: string | null): HomeDoc {
  return parseHomeDoc(text ?? "{}") ?? {};
}

/**
 * Settings show from this browser's copy at once, and go to the relay a
 * moment after they change. Tabs share the copy.
 */
function syncedHomeStore(pubkey: string): HomeStore {
  const key = `home:${pubkey}`;
  const local$ = new BehaviorSubject(readLocal(readStorage(key)));
  /** The newest settings event this device knows of. */
  let event: NostrEvent | undefined;
  /**
   * What `event` holds, once read; empty when the relay has none. Unset while
   * it's being read, or when it can't be: saving waits, so as never to
   * replace settings this device couldn't read.
   */
  let remote: HomeDoc | undefined;
  /** Contents this device encrypted, so its own saves aren't decrypted again. */
  const known = new Map<string, HomeDoc>();
  let loaded = false;
  let saving = false;
  /** This browser's copy may hold changes the relay hasn't got. */
  let pending = true;
  /**
   * A save failed, say the signer refused it: the next change tries again,
   * rather than asking the signer over and over.
   */
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const keep = (doc: HomeDoc) => {
    writeStorage(key, serializeHomeDoc(doc));
    local$.next(doc);
  };

  const read = async (current: NostrEvent): Promise<HomeDoc | undefined> => {
    const cached = known.get(current.content);
    if (cached) {
      return cached;
    }
    const text = await decryptFor(pubkey, pubkey, current.content);
    return text === undefined ? undefined : parseHomeDoc(text);
  };

  const save = async () => {
    clearTimeout(timer);
    if (!loaded || saving || stalled || !remote) {
      return;
    }
    const local = local$.value;
    const next = mergeHomeDocs(local, remote);
    if (sameHomeDoc(next, remote)) {
      pending = false;
      return;
    }
    saving = true;
    let saved = false;
    try {
      const content = await encryptFor(pubkey, pubkey, serializeHomeDoc(next));
      if (content !== undefined) {
        known.set(content, next);
        saved = await publish(homeTemplate(content), event);
      }
    } finally {
      saving = false;
    }
    if (!saved) {
      stalled = true;
      return;
    }
    // Changed again while this was saving.
    if (local$.value === local) {
      pending = false;
    } else {
      timer = setTimeout(save, SAVE_DELAY);
    }
  };

  const schedule = (delay = SAVE_DELAY) => {
    clearTimeout(timer);
    if (pending && !stalled) {
      timer = setTimeout(save, delay);
    }
  };

  const changed = (doc: HomeDoc) => {
    keep(doc);
    pending = true;
    stalled = false;
    schedule();
  };

  // Only a relay that answered can say there are no settings yet; offline,
  // saving could replace settings made on other devices.
  combineLatest([
    sync([{ "#d": [HOME_D], authors: [pubkey], kinds: [APP_DATA_KIND] }]),
    access$,
  ])
    .pipe(map(([done, access]) => done && access === "ok"))
    .subscribe((done) => {
      if (done && !loaded) {
        loaded = true;
        if (!event) {
          remote = {};
        }
        schedule(0);
      }
    });

  eventStore
    .replaceable(APP_DATA_KIND, pubkey, HOME_D)
    .pipe(distinctUntilChanged((a, b) => a?.id === b?.id))
    .subscribe(async (current) => {
      event = current;
      // A save the signer or the relay refused leaves no event behind.
      remote = !current && loaded ? {} : undefined;
      if (!current) {
        return;
      }
      const doc = await read(current);
      if (!doc || event !== current) {
        return;
      }
      remote = doc;
      const merged = mergeHomeDocs(local$.value, doc);
      if (!sameHomeDoc(merged, local$.value)) {
        keep(merged);
      }
      if (!sameHomeDoc(merged, doc)) {
        schedule();
      }
    });

  // Another tab changed something.
  addEventListener("storage", (change) => {
    if (change.key === key) {
      local$.next(readLocal(change.newValue));
    }
  });
  // Hidden is the last moment a closing page is sure to get.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      save();
    }
  });
  onLeave(save);

  return {
    prefs$: local$.pipe(map(homePrefs), shareReplay(1)),
    set: (setting, value) =>
      changed({ ...local$.value, [setting]: { at: Date.now(), value } }),
    setPinned: (pin, pinned) => {
      const before = findPinMark(local$.value, pin);
      const at = Date.now();
      // Pinned again, it goes last; unpinned, it keeps its place for an undo.
      const order = before && (before.pinned || !pinned) ? before.order : at;
      changed(withPinMark(local$.value, { at, order, pin, pinned }));
      return () =>
        changed(
          withPinMark(local$.value, {
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
