import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Observable } from "rxjs";
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
} from "rxjs";

import { onLeave } from "@/lib/leaving";
import type { Template } from "@/lib/model";
import { APP_DATA_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { decryptFor, encryptFor } from "@/lib/private-data";
import { publish } from "@/lib/publish";
import { access$, sync } from "@/lib/relays";
import { readStorage, writeStorage } from "@/lib/utils";

/** Changes wait this long for more before they're saved, so a run of them signs once. */
const SAVE_DELAY = 2000;

/** What a person keeps for themselves on the relay, and how two copies of it meet. */
export interface PrivateDocKind<Doc> {
  /** The NIP-78 app data event's `d` tag. */
  d: string;
  /** Where this browser keeps its copy, before the account's pubkey. */
  storage: string;
  /** What a copy holds, or nothing when it can't be read. */
  parse: (text: string) => Doc | undefined;
  serialize: (doc: Doc) => string;
  /** Both copies' changes, the newer of each winning. */
  merge: (local: Doc, remote: Doc) => Doc;
  same: (a: Doc, b: Doc) => boolean;
  /** What there is before anything was kept. */
  empty: Doc;
  /** The event that carries the encrypted copy. */
  template: (content: string) => Template;
}

export interface PrivateDoc<Doc> {
  doc$: Observable<Doc>;
  /** This device's copy now. */
  current: () => Doc;
  /** Keeps a new copy here at once, and on the relay a moment later. */
  change: (doc: Doc) => void;
  /** Whether the relay's copy has been read, or the relay said there's none. */
  loaded$: Observable<boolean>;
}

/**
 * A person's own data kept on the team relay, encrypted to themselves with
 * NIP-44, with a copy in this browser. It shows from that copy at once, and
 * goes to the relay a moment after it changes; copies from other devices are
 * merged in as they arrive. Tabs share the copy.
 */
export function syncedPrivateDoc<Doc>(
  pubkey: string,
  kind: PrivateDocKind<Doc>
): PrivateDoc<Doc> {
  const key = `${kind.storage}:${pubkey}`;
  const readLocal = (text: string | null): Doc =>
    (text === null ? undefined : kind.parse(text)) ?? kind.empty;
  const local$ = new BehaviorSubject(readLocal(readStorage(key)));
  const loaded$ = new BehaviorSubject(false);
  /** The newest event this device knows of. */
  let event: NostrEvent | undefined;
  /**
   * What `event` holds, once read; empty when the relay has none. Unset while
   * it's being read, or when it can't be: saving waits, so as never to
   * replace data this device couldn't read.
   */
  let remote: Doc | undefined;
  /** Contents this device encrypted, so its own saves aren't decrypted again. */
  const known = new Map<string, Doc>();
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

  const keep = (doc: Doc) => {
    writeStorage(key, kind.serialize(doc));
    local$.next(doc);
  };

  const read = async (current: NostrEvent): Promise<Doc | undefined> => {
    const cached = known.get(current.content);
    if (cached) {
      return cached;
    }
    const text = await decryptFor(pubkey, pubkey, current.content);
    return text === undefined ? undefined : kind.parse(text);
  };

  const save = async () => {
    clearTimeout(timer);
    if (!loaded || saving || stalled || !remote) {
      return;
    }
    const local = local$.value;
    const next = kind.merge(local, remote);
    if (kind.same(next, remote)) {
      pending = false;
      return;
    }
    saving = true;
    let saved = false;
    try {
      const content = await encryptFor(pubkey, pubkey, kind.serialize(next));
      if (content !== undefined) {
        known.set(content, next);
        saved = await publish(kind.template(content), event);
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

  // Only a relay that answered can say there's nothing kept yet; offline,
  // saving could replace what was kept on other devices.
  combineLatest([
    sync([{ "#d": [kind.d], authors: [pubkey], kinds: [APP_DATA_KIND] }]),
    access$,
  ])
    .pipe(map(([done, access]) => done && access === "ok"))
    .subscribe((done) => {
      if (done && !loaded) {
        loaded = true;
        if (!event) {
          remote = kind.empty;
          loaded$.next(true);
        }
        schedule(0);
      }
    });

  eventStore
    .replaceable(APP_DATA_KIND, pubkey, kind.d)
    .pipe(distinctUntilChanged((a, b) => a?.id === b?.id))
    .subscribe(async (current) => {
      event = current;
      // A save the signer or the relay refused leaves no event behind.
      remote = !current && loaded ? kind.empty : undefined;
      if (!current) {
        return;
      }
      const doc = await read(current);
      if (!doc || event !== current) {
        return;
      }
      remote = doc;
      loaded$.next(true);
      const merged = kind.merge(local$.value, doc);
      if (!kind.same(merged, local$.value)) {
        keep(merged);
      }
      if (!kind.same(merged, doc)) {
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
    change: (doc) => {
      keep(doc);
      pending = true;
      stalled = false;
      schedule();
    },
    current: () => local$.value,
    doc$: local$,
    loaded$,
  };
}
