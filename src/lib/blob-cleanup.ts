import type { NostrEvent } from "applesauce-core/helpers/event";
import { getSeenRelays } from "applesauce-core/helpers/relays";

import { deleteBlobs } from "@/lib/blossom";
import { accounts } from "@/lib/nostr";
import { blobsToDelete } from "@/lib/sealed-files";
import { readStorage, writeStorage } from "@/lib/utils";

/**
 * Blobs of files deleted for good, taken off the Blossom servers. Only the
 * uploader's key can delete a blob, so each uploader's app cleans up after
 * their own: at once for what they delete, later for what teammates do.
 */

/** Blobs remembered as deleted, so they're never asked for twice. */
const MAX_GONE = 2000;

/** Blobs being deleted now, so two cleanups never ask for the same one. */
const deletingBlobs = new Set<string>();

// Named after the Drive, where it started; brand files share it.
function goneKey(pubkey: string): string {
  return `drive-gone:${pubkey}`;
}

function readGone(pubkey: string): string[] {
  try {
    const saved: unknown = JSON.parse(readStorage(goneKey(pubkey)) ?? "[]");
    return Array.isArray(saved)
      ? saved.filter((hash): hash is string => typeof hash === "string")
      : [];
  } catch {
    return [];
  }
}

/** Deletes these blobs of yours from the servers, unless they're gone already, and remembers which went. */
export async function forgetBlobs(
  pubkey: string,
  hashes: string[]
): Promise<void> {
  const gone = new Set(readGone(pubkey));
  const left = [...new Set(hashes)].filter(
    (hash) => !(gone.has(hash) || deletingBlobs.has(hash))
  );
  if (left.length === 0) {
    return;
  }
  for (const hash of left) {
    deletingBlobs.add(hash);
  }
  try {
    const removed = await deleteBlobs(left);
    writeStorage(
      goneKey(pubkey),
      JSON.stringify([...readGone(pubkey), ...removed].slice(-MAX_GONE))
    );
  } catch {
    // The signer said no or the servers are away: next time.
  } finally {
    for (const hash of left) {
      deletingBlobs.delete(hash);
    }
  }
}

/**
 * Deletes the blobs of files you uploaded that someone deleted for good, once
 * a relay has the deletion.
 */
export async function cleanUpBlobs(tombstones: NostrEvent[]): Promise<void> {
  const pubkey = accounts.active?.pubkey;
  if (!pubkey) {
    return;
  }
  await forgetBlobs(
    pubkey,
    tombstones
      .filter((event) => (getSeenRelays(event)?.size ?? 0) > 0)
      .flatMap((event) => blobsToDelete(event, pubkey))
  );
}
