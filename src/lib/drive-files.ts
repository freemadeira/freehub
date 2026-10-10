import { useEffect, useSyncExternalStore } from "react";
import { noop } from "rxjs";

import { CanceledError, downloadBlob, open } from "@/lib/blossom";
import type { DriveFile, SealedBlob } from "@/lib/drive";
import { mimeOf } from "@/lib/drive";
import { errorMessage } from "@/lib/utils";

/**
 * Files and thumbnails, fetched from the Blossom servers and opened in the
 * browser, held as object URLs that every view showing them shares. What no
 * view shows any more is let go once more than BUDGET is held.
 */

/** Something to fetch and open: a file, or its thumbnail. */
export interface Sealed {
  key: string;
  blob: SealedBlob;
  /** The MIME type it opens as. */
  type: string;
}

export interface Opened {
  url?: string;
  /** How much has come in, 0 to 1, while it's on its way. */
  progress?: number;
  error?: string;
}

interface Entry extends Opened {
  blob?: Blob;
  bytes: number;
  /** Views showing it now. */
  users: number;
  usedAt: number;
  promise?: Promise<Blob>;
  controller?: AbortController;
}

const BUDGET = 300 * 1024 * 1024;
const STOP_DELAY = 1000;
/** Progress shows at most this often, plenty for a bar. */
const PROGRESS_MS = 100;
const IDLE: Opened = {};

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function notify(hash: string): void {
  for (const listener of listeners.get(hash) ?? []) {
    listener();
  }
}

function patch(hash: string, change: Partial<Entry>): void {
  const entry = entries.get(hash);
  if (entry) {
    entries.set(hash, { ...entry, ...change });
    notify(hash);
  }
}

/** Lets go of what nothing shows, oldest first, until what's held fits. */
function trim(): void {
  let held = 0;
  for (const entry of entries.values()) {
    held += entry.bytes;
  }
  const idle = [...entries]
    .filter(([, entry]) => entry.users === 0 && entry.url)
    .toSorted(([, a], [, b]) => a.usedAt - b.usedAt);
  for (const [hash, entry] of idle) {
    if (held <= BUDGET) {
      return;
    }
    held -= entry.bytes;
    if (entry.url) {
      URL.revokeObjectURL(entry.url);
    }
    entries.delete(hash);
  }
}

/** Fetches and opens the blob, keeping the entry up to date as it goes. */
async function fetchAndOpen(
  sealed: Sealed,
  controller: AbortController
): Promise<Blob> {
  const { hash } = sealed.blob;
  let shownAt = 0;
  try {
    const data = await downloadBlob(hash, {
      onProgress: (loaded, total) => {
        const now = performance.now();
        if (total && now - shownAt > PROGRESS_MS) {
          shownAt = now;
          patch(hash, { progress: loaded / total });
        }
      },
      signal: controller.signal,
    });
    const blob = new Blob([await open(data, sealed.key, sealed.blob.nonce)], {
      type: sealed.type,
    });
    patch(hash, {
      blob,
      bytes: blob.size,
      controller: undefined,
      progress: undefined,
      promise: undefined,
      url: URL.createObjectURL(blob),
    });
    trim();
    return blob;
  } catch (error) {
    if (error instanceof CanceledError) {
      entries.delete(hash);
      notify(hash);
    } else {
      // Kept, so a broken file isn't fetched over and over.
      patch(hash, {
        controller: undefined,
        error: errorMessage(error),
        progress: undefined,
        promise: undefined,
      });
    }
    throw error;
  }
}

function load(sealed: Sealed): Promise<Blob> {
  const { hash } = sealed.blob;
  const known = entries.get(hash);
  if (known?.blob) {
    return Promise.resolve(known.blob);
  }
  if (known?.promise) {
    return known.promise;
  }
  const controller = new AbortController();
  entries.set(hash, {
    bytes: 0,
    controller,
    progress: 0,
    usedAt: performance.now(),
    users: known?.users ?? 0,
  });
  const promise = fetchAndOpen(sealed, controller);
  patch(hash, { promise });
  return promise;
}

/** Starts fetching the blob unless it's there, on its way, or known to be broken. */
async function ensure(sealed: Sealed): Promise<void> {
  const entry = entries.get(sealed.blob.hash);
  if (entry && (entry.url || entry.promise || entry.error)) {
    return;
  }
  try {
    await load(sealed);
  } catch {
    // The entry says what went wrong, to whatever shows it.
  }
}

/** Holds the entry while it's shown or awaited, so it's neither let go nor stopped. */
function hold(hash: string): () => void {
  const entry = entries.get(hash);
  if (entry) {
    entries.set(hash, { ...entry, users: entry.users + 1 });
  }
  return () => {
    const current = entries.get(hash);
    if (!current) {
      return;
    }
    entries.set(hash, {
      ...current,
      usedAt: performance.now(),
      users: Math.max(0, current.users - 1),
    });
    // A moment later, so a view shown again right away picks it up where it was.
    setTimeout(() => {
      const later = entries.get(hash);
      if (later?.users === 0) {
        // Nobody waits on it any more: stop fetching what nothing will show.
        later.controller?.abort();
        trim();
      }
    }, STOP_DELAY);
  };
}

export function fileSource(file: DriveFile): Sealed {
  return { blob: file.blob, key: file.key, type: mimeOf(file) };
}

export function thumbSource(file: DriveFile): Sealed | undefined {
  return file.thumb
    ? { blob: file.thumb, key: file.key, type: "image/webp" }
    : undefined;
}

/** The file opened, as a blob of its type: to save it, or read its text. */
export async function fetchFile(file: DriveFile): Promise<Blob> {
  const sealed = fileSource(file);
  const loading = load(sealed);
  const release = hold(sealed.blob.hash);
  try {
    return await loading;
  } finally {
    release();
  }
}

/** Starts fetching something about to be shown, like the next picture over. */
export function preload(sealed: Sealed): void {
  ensure(sealed);
}

function subscribe(hash: string | undefined, listener: () => void) {
  if (!hash) {
    return noop;
  }
  const set = listeners.get(hash) ?? new Set();
  set.add(listener);
  listeners.set(hash, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(hash);
    }
  };
}

/**
 * The file or thumbnail as an object URL, fetched and opened the first time
 * it's shown. Pass nothing to show nothing.
 */
export function useOpened(sealed: Sealed | undefined): Opened {
  const hash = sealed?.blob.hash;
  const nonce = sealed?.blob.nonce;
  const key = sealed?.key;
  const type = sealed?.type;
  const state = useSyncExternalStore(
    (listener) => subscribe(hash, listener),
    () => (hash ? (entries.get(hash) ?? IDLE) : IDLE)
  );
  useEffect(() => {
    if (!(hash && nonce && key && type !== undefined)) {
      return;
    }
    ensure({ blob: { hash, nonce }, key, type });
    return hold(hash);
  }, [hash, nonce, key, type]);
  return { error: state.error, progress: state.progress, url: state.url };
}
