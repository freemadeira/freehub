import type { Observable } from "rxjs";
import { BehaviorSubject } from "rxjs";

import { readStorage, writeStorage } from "@/lib/utils";

/** Notification ids the user read or archived. */
export interface InboxMarks {
  read: ReadonlySet<string>;
  archived: ReadonlySet<string>;
}

/**
 * Where inbox marks live. This browser keeps them for now; a store synced
 * across devices, like a NIP-78 app data event, can stand in for it later.
 */
export interface InboxStore {
  marks$: Observable<InboxMarks>;
  setRead: (ids: string[], read: boolean) => void;
  archive: (ids: string[]) => void;
}

/** Comfortably more than the notifications the relays are asked for. */
const MAX_IDS = 500;

const stores = new Map<string, InboxStore>();

function idList(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : []
  );
}

function parseMarks(raw: string | null): InboxMarks {
  try {
    const saved: unknown = JSON.parse(raw ?? "{}");
    const fields: Record<string, unknown> =
      typeof saved === "object" && saved !== null ? { ...saved } : {};
    return { archived: idList(fields.archived), read: idList(fields.read) };
  } catch {
    return { archived: new Set(), read: new Set() };
  }
}

function localInboxStore(pubkey: string): InboxStore {
  const key = `inbox:${pubkey}`;
  const marks$ = new BehaviorSubject(parseMarks(readStorage(key)));

  const save = (marks: InboxMarks) => {
    marks$.next(marks);
    writeStorage(
      key,
      JSON.stringify({
        archived: [...marks.archived].slice(-MAX_IDS),
        read: [...marks.read].slice(-MAX_IDS),
      })
    );
  };

  // Keeps tabs in step when another one marks something.
  addEventListener("storage", (event) => {
    if (event.key === key) {
      marks$.next(parseMarks(event.newValue));
    }
  });

  return {
    archive(ids) {
      const { archived, read } = marks$.value;
      if (ids.every((id) => archived.has(id))) {
        return;
      }
      save({ archived: new Set([...archived, ...ids]), read });
    },
    marks$,
    setRead(ids, isRead) {
      const { archived, read } = marks$.value;
      if (ids.every((id) => read.has(id) === isRead)) {
        return;
      }
      const next = new Set(read);
      for (const id of ids) {
        if (isRead) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      save({ archived, read: next });
    },
  };
}

/** The inbox marks of one account, shared by everything that shows them. */
export function inboxStore(pubkey: string): InboxStore {
  let store = stores.get(pubkey);
  if (!store) {
    store = localInboxStore(pubkey);
    stores.set(pubkey, store);
  }
  return store;
}
