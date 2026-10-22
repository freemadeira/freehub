import { useSyncExternalStore } from "react";

import type { PlaceKind } from "@/lib/search";
import { MAX_QUERY, PLACE_KINDS } from "@/lib/search";
import { readStorage, writeStorage } from "@/lib/utils";

/** How many places and searches are kept, newest first. */
const PLACES_KEPT = 40;
const SEARCHES_KEPT = 10;

/**
 * A place the user opened, by what finds it again: an address for projects,
 * boards and tables, else the address it sits in and its id, after a slash.
 */
export interface RecentPlace {
  kind: PlaceKind;
  id: string;
  at: number;
}

/** What the user opened and searched for lately, on this device, newest first. */
export interface Recents {
  places: RecentPlace[];
  searches: string[];
}

const NONE: Recents = { places: [], searches: [] };
const kept = new Map<string, Recents>();
const listeners = new Set<() => void>();

function storageKey(pubkey: string): string {
  return `recents:${pubkey}`;
}

function isPlace(value: unknown): value is RecentPlace {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { kind, id, at } = value as Partial<RecentPlace>;
  return (
    PLACE_KINDS.some((each) => each === kind) &&
    typeof id === "string" &&
    typeof at === "number"
  );
}

function parse(raw: string | null): Recents {
  try {
    const value = JSON.parse(raw ?? "null") as Partial<Recents> | null;
    return {
      places: Array.isArray(value?.places) ? value.places.filter(isPlace) : [],
      searches: Array.isArray(value?.searches)
        ? value.searches.filter((words) => typeof words === "string")
        : [],
    };
  } catch {
    return NONE;
  }
}

function read(pubkey: string): Recents {
  const key = storageKey(pubkey);
  let recents = kept.get(key);
  if (!recents) {
    recents = parse(readStorage(key));
    kept.set(key, recents);
  }
  return recents;
}

function write(pubkey: string, recents: Recents): void {
  const key = storageKey(pubkey);
  kept.set(key, recents);
  writeStorage(key, JSON.stringify(recents));
  for (const listener of listeners) {
    listener();
  }
}

// Another tab's visits and searches show here too.
globalThis.addEventListener?.("storage", (event) => {
  if (event.key?.startsWith("recents:") && kept.delete(event.key)) {
    for (const listener of listeners) {
      listener();
    }
  }
});

/** Brings the place to the top, and lets go of the oldest past what's kept. */
export function markVisited(pubkey: string, kind: PlaceKind, id: string) {
  const { places, searches } = read(pubkey);
  const rest = places.filter((place) => place.kind !== kind || place.id !== id);
  write(pubkey, {
    places: [{ at: Date.now(), id, kind }, ...rest].slice(0, PLACES_KEPT),
    searches,
  });
}

/** Keeps words searched for that found what was opened. */
export function markSearched(pubkey: string, text: string) {
  const words = text.trim().replaceAll(/\s+/gu, " ").slice(0, MAX_QUERY);
  if (!words) {
    return;
  }
  const { places, searches } = read(pubkey);
  write(pubkey, {
    places,
    searches: [words, ...searches.filter((each) => each !== words)].slice(
      0,
      SEARCHES_KEPT
    ),
  });
}

export function forgetSearches(pubkey: string) {
  write(pubkey, { places: read(pubkey).places, searches: [] });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRecents(pubkey: string): Recents {
  return useSyncExternalStore(subscribe, () => read(pubkey));
}
