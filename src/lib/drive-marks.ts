import type { Observable } from "rxjs";
import { BehaviorSubject } from "rxjs";

import { readStorage, writeStorage } from "@/lib/utils";

/** What one person starred in a project's Drive, and the files they opened lately. */
export interface DriveMarks {
  stars: ReadonlySet<string>;
  /** Files opened, newest first, with when, in seconds. */
  opens: readonly { id: string; at: number }[];
}

/**
 * Where Drive marks live. This browser keeps them for now, like inbox marks;
 * a store synced across devices, like a NIP-78 app data event, can stand in later.
 */
export interface DriveMarksStore {
  marks$: Observable<DriveMarks>;
  setStarred: (ids: string[], starred: boolean) => void;
  opened: (id: string) => void;
}

/** Opens kept to find recent files, comfortably more than are listed. */
const KEEP_OPENS = 50;
const MAX_STARS = 1000;
/** Opening the same file again this soon doesn't count as another open. */
const REOPEN_SECONDS = 60;

const stores = new Map<string, DriveMarksStore>();

function parseMarks(raw: string | null): DriveMarks {
  try {
    const saved: unknown = JSON.parse(raw ?? "{}");
    const fields: Record<string, unknown> =
      typeof saved === "object" && saved !== null ? { ...saved } : {};
    const stars = Array.isArray(fields.stars)
      ? fields.stars.filter((id): id is string => typeof id === "string")
      : [];
    const opens = Array.isArray(fields.opens)
      ? fields.opens.flatMap((open: unknown) =>
          typeof open === "object" &&
          open !== null &&
          "id" in open &&
          typeof open.id === "string" &&
          "at" in open &&
          typeof open.at === "number"
            ? [{ at: open.at, id: open.id }]
            : []
        )
      : [];
    return { opens, stars: new Set(stars) };
  } catch {
    return { opens: [], stars: new Set() };
  }
}

function localStore(key: string): DriveMarksStore {
  const marks$ = new BehaviorSubject(parseMarks(readStorage(key)));

  const save = (marks: DriveMarks) => {
    marks$.next(marks);
    writeStorage(
      key,
      JSON.stringify({
        opens: marks.opens.slice(0, KEEP_OPENS),
        stars: [...marks.stars].slice(-MAX_STARS),
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
    marks$,
    opened(id) {
      const { opens, stars } = marks$.value;
      const now = Math.floor(Date.now() / 1000);
      const [last] = opens;
      if (last?.id === id && now - last.at < REOPEN_SECONDS) {
        return;
      }
      save({
        opens: [{ at: now, id }, ...opens.filter((open) => open.id !== id)],
        stars,
      });
    },
    setStarred(ids, starred) {
      const { opens, stars } = marks$.value;
      if (ids.every((id) => stars.has(id) === starred)) {
        return;
      }
      const next = new Set(stars);
      for (const id of ids) {
        if (starred) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      save({ opens, stars: next });
    },
  };
}

/** The Drive marks of one account in one project, shared by everything that shows them. */
export function driveMarks(pubkey: string, project: string): DriveMarksStore {
  const key = `drive:${pubkey}:${project}`;
  let store = stores.get(key);
  if (!store) {
    store = localStore(key);
    stores.set(key, store);
  }
  return store;
}
