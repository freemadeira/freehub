import type { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { isEventPointer } from "applesauce-core/helpers/pointers";
import { isFromRelay } from "applesauce-core/helpers/relays";
import type { UnifiedEventLoader } from "applesauce-loaders/loaders";
import type { Observable } from "rxjs";
import {
  concat,
  defer,
  EMPTY,
  filter,
  fromEvent,
  of,
  race,
  repeat,
  takeUntil,
  timer,
} from "rxjs";

import { isPubkey } from "@/lib/model";
import { readStorage, writeStorage } from "@/lib/utils";

/**
 * People's names and pictures, kept in this browser so they show at once on
 * the next visit, and when the lookup relays are slow or down. Each is still
 * looked up again in the background, so a changed name only shows late once.
 * Only public ones are kept: connectors' are on the team relays alone.
 */

export const PROFILE_KIND = 0;

type Loader = NonNullable<EventStore["eventLoader"]>;
type Pointer = Parameters<Loader>[0];

const CACHE_KEY = "profiles";
/** Profiles kept, the ones shown least lately going first. */
const MAX_CACHED = 200;
/** Characters the cache may take, leaving localStorage to unsent changes and drafts. */
const MAX_CACHE_SIZE = 200_000;
/** Bigger ones, like a picture inlined as data, are looked up each visit instead. */
const MAX_PROFILE_SIZE = 10_000;
const SAVE_DELAY = 2000;
/** First wait before looking for a profile again, doubling up to RETRY_MAX. */
const RETRY_FIRST = 15_000;
const RETRY_MAX = 10 * 60_000;

/** By pubkey, the ones shown least lately first. */
let cache: Map<string, NostrEvent> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function isProfileEvent(value: unknown): value is NostrEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === PROFILE_KIND &&
    "pubkey" in value &&
    typeof value.pubkey === "string" &&
    "id" in value &&
    typeof value.id === "string" &&
    "sig" in value &&
    typeof value.sig === "string" &&
    "created_at" in value &&
    typeof value.created_at === "number" &&
    "content" in value &&
    typeof value.content === "string" &&
    "tags" in value &&
    Array.isArray(value.tags)
  );
}

function cached(): Map<string, NostrEvent> {
  if (!cache) {
    cache = new Map();
    try {
      const saved: unknown = JSON.parse(readStorage(CACHE_KEY) ?? "[]");
      for (const event of Array.isArray(saved) ? saved : []) {
        if (isProfileEvent(event)) {
          cache.set(event.pubkey, event);
        }
      }
    } catch {
      // Unreadable: start over.
    }
  }
  return cache;
}

function save(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const kept: string[] = [];
  let size = 0;
  for (const event of [...cached().values()].toReversed()) {
    const json = JSON.stringify(event);
    if (json.length <= MAX_PROFILE_SIZE) {
      if (size + json.length > MAX_CACHE_SIZE) {
        break;
      }
      kept.push(json);
      size += json.length + 1;
    }
  }
  writeStorage(CACHE_KEY, `[${kept.toReversed().join(",")}]`);
}

function saveSoon(): void {
  saveTimer ??= setTimeout(save, SAVE_DELAY);
}

function remember(event: NostrEvent): void {
  const profiles = cached();
  const known = profiles.get(event.pubkey);
  if (known && known.created_at > event.created_at) {
    return;
  }
  profiles.delete(event.pubkey);
  profiles.set(event.pubkey, event);
  for (const pubkey of profiles.keys()) {
    if (profiles.size <= MAX_CACHED) {
      break;
    }
    profiles.delete(pubkey);
  }
  saveSoon();
}

/** The saved profile, put back in the store, if it still checks out. */
function restore(store: EventStore, pubkey: string): NostrEvent | undefined {
  const saved = cached().get(pubkey);
  if (!saved) {
    return undefined;
  }
  const event = store.add(saved);
  if (!event) {
    cached().delete(pubkey);
    saveSoon();
  }
  return event ?? undefined;
}

function profileAdded(store: EventStore, pubkey: string): Observable<unknown> {
  return store.insert$.pipe(
    filter((event) => event.kind === PROFILE_KIND && event.pubkey === pubkey)
  );
}

// Back online, or after a while: relays answer differently from one moment to
// the next. Stops once the profile comes in, from here or from elsewhere.
function retryAfter(
  store: EventStore,
  pubkey: string,
  attempt: number
): Observable<unknown> {
  if (store.hasReplaceable(PROFILE_KIND, pubkey)) {
    return EMPTY;
  }
  return race(
    timer(Math.min(RETRY_FIRST * 2 ** (attempt - 1), RETRY_MAX)),
    fromEvent(window, "online")
  ).pipe(takeUntil(profileAdded(store, pubkey)));
}

/**
 * Loads what the store doesn't have. Profiles show the saved copy first, and
 * one not found is looked for again for as long as someone shows it.
 * Connectors' profiles are on the team relays, which sync them on their own.
 */
function loadProfiles(
  store: EventStore,
  load: UnifiedEventLoader,
  connectors: string[]
): Loader {
  return (pointer: Pointer) => {
    if (isEventPointer(pointer) || pointer.kind !== PROFILE_KIND) {
      return load(pointer);
    }
    const { pubkey } = pointer;
    // No relay has it, and strict ones turn down the whole batch it's in.
    if (!isPubkey(pubkey)) {
      return EMPTY;
    }
    return defer(() => {
      const saved = restore(store, pubkey);
      if (saved) {
        return concat(of(saved), load(pointer));
      }
      if (connectors.includes(pubkey)) {
        return load(pointer);
      }
      return load(pointer).pipe(
        repeat({ delay: (attempt) => retryAfter(store, pubkey, attempt) })
      );
    });
  };
}

/** Has the store load profiles as above, and keeps the public ones it gets. */
export function startProfiles(
  store: EventStore,
  load: UnifiedEventLoader,
  { connectors, teamRelays }: { connectors: string[]; teamRelays: string[] }
): void {
  store.eventLoader = loadProfiles(store, load, connectors);
  store.insert$
    .pipe(
      filter(
        (event) =>
          event.kind === PROFILE_KIND &&
          !teamRelays.some((url) => isFromRelay(event, url))
      )
    )
    .subscribe(remember);
  // Writes are synchronous, so this still lands while the page closes.
  addEventListener("pagehide", () => {
    if (saveTimer !== undefined) {
      save();
    }
  });
}
