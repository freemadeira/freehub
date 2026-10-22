import { getConfig } from "@/config";
import { abortSigning, accounts } from "@/lib/nostr";
import { blossomAuthHeader, blossomAuthTemplate, sha256 } from "@/lib/sealing";
import { TimeoutError, withTimeout } from "@/lib/utils";

/**
 * Files on the team's Blossom servers (BUD-01, 02 and 11), sealed with
 * AES-GCM in the browser first (see sealing.ts): the servers hand any blob to
 * whoever asks for its hash, so they only ever hold what they can't read.
 */

const SIGN_TIMEOUT = 60_000;
/** An upload of the largest file can take a while on a slow connection. */
const AUTH_SECONDS = 60 * 60;
/** Hashes per delete request: each goes in the auth header, which servers cap. */
const DELETE_BATCH = 20;

export class CanceledError extends Error {
  override name = "CanceledError";
}

/** Whether the team has somewhere to keep files. Without it, there's no Drive. */
export function hasBlossom(): boolean {
  return getConfig().blossom.length > 0;
}

/**
 * The Authorization header for uploading or deleting these blobs. One event
 * names them all, so a file and its thumbnail take one signature.
 */
export async function authorize(
  verb: "upload" | "delete",
  hashes: string[],
  content: string
): Promise<string> {
  const account = accounts.active;
  if (!account) {
    throw new Error("You’re logged out.");
  }
  try {
    const signed = await withTimeout(
      account.signEvent(
        blossomAuthTemplate(verb, hashes, content, AUTH_SECONDS)
      ),
      SIGN_TIMEOUT,
      "Your signer didn’t answer."
    );
    return blossomAuthHeader(signed);
  } catch (error) {
    if (error instanceof TimeoutError) {
      abortSigning(error);
      throw error;
    }
    throw new Error("Your signer refused it.", { cause: error });
  }
}

function reason(response: { status: number; header: string | null }): string {
  if (response.status === 413) {
    return "The file server takes nothing this big.";
  }
  if (response.status === 401 || response.status === 403) {
    return response.header ?? "The file server didn’t let you in.";
  }
  return response.header ?? "The upload didn’t go through. Try again.";
}

/**
 * Sends a blob to the team's first Blossom server, telling how far it got as
 * it goes. Only XMLHttpRequest reports upload progress.
 */
export function uploadBlob(
  data: Blob | ArrayBuffer,
  hash: string,
  auth: string,
  {
    onProgress,
    signal,
  }: { onProgress?: (loaded: number) => void; signal?: AbortSignal } = {}
): Promise<void> {
  const [server] = getConfig().blossom;
  if (!server) {
    return Promise.reject(new Error("There’s no file server to upload to."));
  }
  // oxlint-disable-next-line promise/avoid-new -- only XMLHttpRequest reports upload progress, and only through events
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${server}/upload`);
    xhr.setRequestHeader("Authorization", auth);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-SHA-256", hash);
    xhr.upload.addEventListener("progress", (event) =>
      onProgress?.(event.loaded)
    );
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(
          new Error(
            reason({
              header: xhr.getResponseHeader("X-Reason"),
              status: xhr.status,
            })
          )
        );
      }
    });
    xhr.addEventListener("error", () =>
      reject(new Error("The connection dropped. Try again."))
    );
    xhr.addEventListener("abort", () => reject(new CanceledError()));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    if (signal?.aborted) {
      xhr.abort();
      return;
    }
    xhr.send(data);
  });
}

type Progress = (loaded: number, total?: number) => void;

/** The response's body, telling how much of it has come in as it does. */
async function readBody(
  response: Response,
  onProgress?: Progress
): Promise<ArrayBuffer> {
  const total = Number(response.headers.get("Content-Length")) || undefined;
  if (!(response.body && onProgress)) {
    return await response.arrayBuffer();
  }
  let loaded = 0;
  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        onProgress(loaded, total);
        controller.enqueue(chunk);
      },
    })
  );
  return await new Response(counted).arrayBuffer();
}

/** The blob from the first of these servers that has it, or why none could hand it over. */
async function downloadFrom(
  servers: readonly string[],
  hash: string,
  options: { onProgress?: Progress; signal?: AbortSignal },
  failure?: Error
): Promise<ArrayBuffer> {
  const [server, ...rest] = servers;
  if (!server) {
    throw failure ?? new Error("This file isn’t on the file servers anymore.");
  }
  let next = failure;
  try {
    const response = await fetch(`${server}/${hash}`, {
      signal: options.signal,
    });
    if (response.ok) {
      const data = await readBody(response, options.onProgress);
      if ((await sha256(data)) === hash) {
        return data;
      }
      next = new Error("The file server sent something else.");
    } else if (response.status !== 404) {
      next = new Error("The file server didn’t answer. Try again.");
    }
  } catch (error) {
    if (options.signal?.aborted) {
      throw new CanceledError();
    }
    next = error instanceof Error ? error : new Error(String(error));
  }
  return await downloadFrom(rest, hash, options, next);
}

/**
 * A blob from whichever team server has it, checked against its hash, so a
 * server can't hand over something else.
 */
export function downloadBlob(
  hash: string,
  options: { onProgress?: Progress; signal?: AbortSignal } = {}
): Promise<ArrayBuffer> {
  return downloadFrom(getConfig().blossom, hash, options);
}

/** Whether every team server let go of the blob, or never had it. */
async function deleteEverywhere(hash: string, auth: string): Promise<boolean> {
  const results = await Promise.all(
    getConfig().blossom.map(async (server) => {
      try {
        const response = await fetch(`${server}/${hash}`, {
          headers: { Authorization: auth },
          method: "DELETE",
        });
        // Not there, or not yours to delete: either way, nothing left to do.
        return response.ok || [403, 404].includes(response.status);
      } catch {
        return false;
      }
    })
  );
  return results.every(Boolean);
}

/**
 * Deletes your blobs from every team server. Resolves with the ones gone,
 * including those no server had; the rest can be tried again later.
 */
export async function deleteBlobs(hashes: string[]): Promise<string[]> {
  const batches: string[][] = [];
  for (let start = 0; start < hashes.length; start += DELETE_BATCH) {
    batches.push(hashes.slice(start, start + DELETE_BATCH));
  }
  const done = await Promise.all(
    batches.map(async (batch) => {
      const auth = await authorize("delete", batch, "Delete files");
      const gone = await Promise.all(
        batch.map((hash) => deleteEverywhere(hash, auth))
      );
      return batch.filter((_, index) => gone[index]);
    })
  );
  return done.flat();
}
