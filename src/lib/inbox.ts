import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Observable } from "rxjs";
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  shareReplay,
} from "rxjs";

import type { InboxMarks, MarkChange } from "@/lib/inbox-marks";
import {
  applyMarkChanges,
  INBOX_D,
  markKey,
  marksReader,
  marksTemplate,
  NO_MARKS,
  parseMarks,
  serializeMarks,
} from "@/lib/inbox-marks";
import { onLeave } from "@/lib/leaving";
import { APP_DATA_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { decryptFor, encryptFor, privateReader } from "@/lib/private-data";
import { publish } from "@/lib/publish";
import { access$, sync } from "@/lib/relays";
import { readStorage, writeStorage } from "@/lib/utils";

/** Marks wait this long for more before they're saved, so a run of them signs once. */
const SAVE_DELAY = 2000;

export interface InboxStore {
  marks$: Observable<InboxMarks>;
  setRead: (ids: string[], read: boolean) => void;
  setArchived: (ids: string[], archived: boolean) => void;
}

/**
 * What this browser knows: the marks as last seen, and changes the relay
 * doesn't have yet. Tabs share it, so whichever saves takes them all.
 */
interface Local {
  marks: InboxMarks;
  changes: MarkChange[];
}

function isChange(value: unknown): value is MarkChange {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const change: Partial<Record<keyof MarkChange, unknown>> = value;
  return (
    typeof change.id === "string" &&
    (change.mark === "read" || change.mark === "archived") &&
    typeof change.on === "boolean" &&
    Array.isArray(change.keys) &&
    change.keys.every((key) => typeof key === "string")
  );
}

function newChange(
  mark: MarkChange["mark"],
  on: boolean,
  keys: string[]
): MarkChange {
  return { id: crypto.randomUUID(), keys, mark, on };
}

/**
 * Marks made before they were kept on the relay only lived here: they're
 * changes still to save, so they join whatever other devices marked.
 */
function readLocal(key: string): Local {
  const raw = readStorage(key);
  const marks = parseMarks(raw ?? "{}");
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    saved = typeof parsed === "object" && parsed !== null ? { ...parsed } : {};
  } catch {
    // Unreadable: start over.
  }
  if (!Array.isArray(saved.changes)) {
    return {
      changes: [
        newChange("read", true, [...marks.read]),
        newChange("archived", true, [...marks.archived]),
      ].filter((change) => change.keys.length > 0),
      marks,
    };
  }
  return { changes: saved.changes.filter(isChange), marks };
}

function writeLocal(key: string, { marks, changes }: Local): void {
  writeStorage(
    key,
    JSON.stringify({ ...JSON.parse(serializeMarks(marks)), changes })
  );
}

function syncedInboxStore(pubkey: string): InboxStore {
  const key = `inbox:${pubkey}`;
  // Marks kept the old way become changes with ids that stay put.
  writeLocal(key, readLocal(key));
  const local$ = new BehaviorSubject(readLocal(key));
  /** The marks on the relay, once known: none if it has none. */
  const remote$ = new BehaviorSubject<InboxMarks | undefined>(undefined);
  /** Contents this device encrypted, so its own saves aren't decrypted again. */
  const known = new Map<string, InboxMarks>();
  let event: NostrEvent | undefined;
  let loaded = false;
  let saving = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const marks$ = combineLatest([local$, remote$]).pipe(
    map(([local, remote]) =>
      remote ? applyMarkChanges(remote, local.changes) : local.marks
    ),
    shareReplay(1)
  );

  const refreshLocal = () => local$.next(readLocal(key));

  // Remembers the relay's marks here, for the next visit to start from.
  const adopt = (remote: InboxMarks) => {
    const { changes } = readLocal(key);
    writeLocal(key, { changes, marks: applyMarkChanges(remote, changes) });
    remote$.next(remote);
    refreshLocal();
  };

  const read = async (current: NostrEvent): Promise<InboxMarks | undefined> => {
    const cached = known.get(current.content);
    if (cached) {
      return cached;
    }
    const text = await decryptFor(
      pubkey,
      marksReader(current),
      current.content
    );
    return text === undefined ? undefined : parseMarks(text);
  };

  const save = async () => {
    clearTimeout(timer);
    const { changes } = readLocal(key);
    if (!loaded || saving || changes.length === 0) {
      return;
    }
    saving = true;
    try {
      // Never save over marks this device couldn't read: they'd be lost.
      const base = event ? (remote$.value ?? (await read(event))) : NO_MARKS;
      if (!base) {
        return;
      }
      const next = applyMarkChanges(base, changes);
      const reader = privateReader(pubkey);
      const content = await encryptFor(pubkey, reader, serializeMarks(next));
      if (content === undefined) {
        return;
      }
      known.set(content, next);
      if (!(await publish(marksTemplate(content, reader), event))) {
        return;
      }
      const sent = new Set(changes.map(({ id }) => id));
      const rest = readLocal(key).changes.filter(({ id }) => !sent.has(id));
      writeLocal(key, { changes: rest, marks: applyMarkChanges(next, rest) });
      remote$.next(next);
      refreshLocal();
    } finally {
      saving = false;
    }
  };

  const schedule = (delay = SAVE_DELAY) => {
    clearTimeout(timer);
    timer = setTimeout(save, delay);
  };

  // Only a relay that answered can say there are no marks yet; offline,
  // saving could replace marks made on other devices.
  combineLatest([
    sync([{ "#d": [INBOX_D], authors: [pubkey], kinds: [APP_DATA_KIND] }]),
    access$,
  ])
    .pipe(map(([done, access]) => done && access === "ok"))
    .subscribe((done) => {
      if (done && !loaded) {
        loaded = true;
        if (!event) {
          remote$.next(NO_MARKS);
        }
        schedule(0);
      }
    });

  eventStore
    .replaceable(APP_DATA_KIND, pubkey, INBOX_D)
    .pipe(distinctUntilChanged((a, b) => a?.id === b?.id))
    .subscribe(async (current) => {
      event = current;
      if (!current) {
        return;
      }
      const remote = await read(current);
      if (remote && event === current) {
        adopt(remote);
      }
    });

  // Another tab marked something.
  addEventListener("storage", (change) => {
    if (change.key === key) {
      refreshLocal();
    }
  });
  // Hidden is the last moment a closing page is sure to get.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      save();
    }
  });
  onLeave(save);

  let current: InboxMarks = local$.value.marks;
  marks$.subscribe((marks) => {
    current = marks;
  });

  const mark = (kind: MarkChange["mark"], ids: string[], on: boolean) => {
    const keys = [...new Set(ids.map(markKey))];
    const set = kind === "read" ? current.read : current.archived;
    if (keys.every((item) => set.has(item) === on)) {
      return;
    }
    const change = newChange(kind, on, keys);
    const { marks, changes } = readLocal(key);
    writeLocal(key, {
      changes: [...changes, change],
      marks: applyMarkChanges(marks, [change]),
    });
    refreshLocal();
    schedule();
  };

  return {
    marks$,
    setArchived: (ids, archived) => mark("archived", ids, archived),
    setRead: (ids, isRead) => mark("read", ids, isRead),
  };
}

const stores = new Map<string, InboxStore>();

/** The inbox marks of one account, shared by everything that shows them. */
export function inboxStore(pubkey: string): InboxStore {
  let store = stores.get(pubkey);
  if (!store) {
    store = syncedInboxStore(pubkey);
    stores.set(pubkey, store);
  }
  return store;
}
