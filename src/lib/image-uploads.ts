import { useSyncExternalStore } from "react";

import { CanceledError } from "@/lib/blossom";
import { newId } from "@/lib/model";
import { errorMessage } from "@/lib/utils";

/**
 * Pictures being uploaded into a text, kept outside its editor so each one's
 * progress shows wherever its place in the text is drawn.
 */
export interface ImageUpload {
  id: string;
  /** The picture from the device, shown until it's on the server. */
  preview: string;
  /** How far it got, from 0 to 1. */
  progress: number;
  /** Why it didn't go through, if it didn't. */
  error?: string;
  /** Whether to ask for its alt text when it shows. */
  ask: boolean;
}

/** Sends a picture where it goes, telling how far it got; resolves with the address it's shown from. */
export type ImageSender = (
  file: File,
  options: { onProgress: (progress: number) => void; signal: AbortSignal }
) => Promise<string>;

interface Job {
  file: File;
  send: ImageSender;
  onDone: (src: string, id: string) => void;
  controller: AbortController;
}

const uploads = new Map<string, ImageUpload>();
const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function patch(id: string, change: Partial<ImageUpload>): void {
  const upload = uploads.get(id);
  if (upload) {
    uploads.set(id, { ...upload, ...change });
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function forget(id: string): void {
  const upload = uploads.get(id);
  if (upload) {
    URL.revokeObjectURL(upload.preview);
  }
  uploads.delete(id);
  jobs.delete(id);
  emit();
}

async function run(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) {
    return;
  }
  patch(id, { error: undefined, progress: 0 });
  try {
    const src = await job.send(job.file, {
      onProgress: (progress) => patch(id, { progress }),
      signal: job.controller.signal,
    });
    // Taken out of the text while it went up.
    if (job.controller.signal.aborted) {
      return;
    }
    job.onDone(src, id);
    forget(id);
  } catch (error) {
    if (!(error instanceof CanceledError)) {
      patch(id, { error: errorMessage(error) });
    }
  }
}

/**
 * Starts sending a picture with `send`. Its place in the text names it by
 * the id returned; `onDone` gets the address it's shown from once it's up.
 */
export function startImageUpload(
  file: File,
  send: ImageSender,
  { ask }: { ask: boolean },
  onDone: (src: string, id: string) => void
): string {
  const id = newId();
  uploads.set(id, {
    ask,
    id,
    preview: URL.createObjectURL(file),
    progress: 0,
  });
  jobs.set(id, { controller: new AbortController(), file, onDone, send });
  emit();
  run(id);
  return id;
}

export function retryImageUpload(id: string): void {
  const job = jobs.get(id);
  if (job) {
    job.controller = new AbortController();
    run(id);
  }
}

/** Stops an upload and lets go of it, as when its place in the text is removed. */
export function cancelImageUpload(id: string): void {
  jobs.get(id)?.controller.abort();
  forget(id);
}

/** Its alt text was asked for: don't ask again when it shows anew. */
export function markAsked(id: string): void {
  patch(id, { ask: false });
}

/** One upload, while it's going or failed. */
export function useImageUpload(
  id: string | null | undefined
): ImageUpload | undefined {
  return useSyncExternalStore(subscribe, () =>
    id ? uploads.get(id) : undefined
  );
}

/** How many pictures are still on their way up, failed ones included. */
export function useUploadsWaiting(): number {
  return useSyncExternalStore(subscribe, () => uploads.size);
}
