import { unixNow } from "applesauce-core/helpers/time";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  authorize,
  CanceledError,
  deleteBlobs,
  newKey,
  newNonce,
  seal,
  sha256,
  uploadBlob,
} from "@/lib/blossom";
import type { SealedBlob } from "@/lib/drive";
import {
  cleanName,
  fileKind,
  fileTemplate,
  freeName,
  MAX_DRIVE_FILE_BYTES,
  MAX_THUMB_BYTES,
  TOO_BIG,
  TOP,
  typeOf,
} from "@/lib/drive";
import { createFolders, currentDrive } from "@/lib/drive-actions";
import { newId } from "@/lib/model";
import { accounts } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { publish } from "@/lib/publish";
import { measure } from "@/lib/thumbnails";
import { errorMessage, plural } from "@/lib/utils";

/**
 * Uploads to Drives, kept outside any screen so they carry on while the person
 * moves around the app. A few go at once; the rest wait their turn. Each file
 * is sealed in the browser, sent to the team's Blossom server with its
 * thumbnail, then filed in the Drive as an event.
 */

export type UploadStatus =
  | "queued"
  | "uploading"
  /** Sent; being filed in the Drive, with its thumbnail. */
  | "saving"
  | "done"
  | "failed"
  | "canceled";

/** Where uploads go: a project's Drive, at the top or in a folder. */
export interface Destination {
  project: Project;
  folder?: string;
}

export interface UploadItem extends Destination {
  id: string;
  /** The file's name; once filed, the one it got, which may be numbered. */
  name: string;
  size: number;
  type: string;
  status: UploadStatus;
  /** Bytes sent so far. */
  loaded: number;
  /** Bytes a second, smoothed. */
  speed: number;
  error?: string;
  fileId?: string;
  /** A local picture of an image, to show before it's uploaded. */
  preview?: string;
}

/** A file picked or dropped, with the folders it sat in, from the top of what was picked down. */
export interface Picked {
  file: File;
  path: string[];
}

export interface PickedSet {
  files: Picked[];
  /** Every folder picked, empty ones too, each as its path. */
  folders: string[][];
}

interface Job {
  file: File;
  controller?: AbortController;
  /** Blobs sent but not filed yet, deleted again if it doesn't get that far. */
  sent: string[];
  canceled: boolean;
  /** Still working through its steps, even if canceled meanwhile. */
  running: boolean;
  sampledAt: number;
  sampled: number;
}

const CONCURRENT = 3;
/**
 * Bytes being sealed and sent at once. Each file sits in memory twice while
 * it's sealed, so big ones go one at a time.
 */
const MAX_RUNNING_BYTES = 120 * 1024 * 1024;
/** Progress shows at most this often per file, plenty for a bar. */
const SAMPLE_MS = 150;
/** Local previews of images bigger than this cost more memory than they're worth. */
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
/** What computers leave in folders that nobody means to upload. */
const JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

let items: UploadItem[] = [];
const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function patch(id: string, change: Partial<UploadItem>): void {
  items = items.map((item) => (item.id === id ? { ...item, ...change } : item));
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): UploadItem[] {
  return items;
}

/** Every upload since the tray was last cleared, oldest first. */
export function useUploads(): UploadItem[] {
  return useSyncExternalStore(subscribe, snapshot);
}

export function isActive(item: UploadItem): boolean {
  return (
    item.status === "queued" ||
    item.status === "uploading" ||
    item.status === "saving"
  );
}

/** Blobs sent but never filed are deleted, so canceled ones don't linger on the servers. */
async function forget(job: Job): Promise<void> {
  const { sent } = job;
  job.sent = [];
  if (sent.length === 0) {
    return;
  }
  try {
    await deleteBlobs(sent);
  } catch {
    // Left on the server: nothing points at it, and nobody can read it.
  }
}

function sample(id: string, loaded: number): void {
  const job = jobs.get(id);
  const now = performance.now();
  if (!job || now - job.sampledAt < SAMPLE_MS) {
    return;
  }
  const seconds = (now - job.sampledAt) / 1000;
  const instant = (loaded - job.sampled) / seconds;
  const previous = items.find((item) => item.id === id)?.speed ?? 0;
  job.sampledAt = now;
  job.sampled = loaded;
  patch(id, {
    loaded,
    speed: previous ? previous * 0.75 + instant * 0.25 : instant,
  });
}

function stopIfCanceled(job: Job): void {
  if (job.canceled) {
    throw new CanceledError();
  }
}

/** The file's thumbnail sealed with the same key, if the browser could draw one. */
async function sealThumbnail(
  thumbnail: Blob | undefined,
  key: string
): Promise<{ data: ArrayBuffer; blob: SealedBlob } | undefined> {
  if (!thumbnail || thumbnail.size > MAX_THUMB_BYTES) {
    return undefined;
  }
  try {
    const nonce = newNonce();
    const data = await seal(await thumbnail.arrayBuffer(), key, nonce);
    return { blob: { hash: await sha256(data), nonce }, data };
  } catch {
    // Previews are a nicety: the file itself still goes in.
    return undefined;
  }
}

/** Seals a file and its thumbnail, sends both, then files it in the Drive. Canceling stops it at the next step. */
async function send(item: UploadItem, job: Job): Promise<void> {
  const creator = accounts.active?.pubkey;
  if (!creator) {
    throw new Error("You’re logged out.");
  }
  // Thumbnails are drawn while the file is sealed.
  const measuring = measure(job.file, fileKind(item));
  const key = newKey();
  const nonce = newNonce();
  const data = await seal(await job.file.arrayBuffer(), key, nonce);
  const hash = await sha256(data);
  const measured = await measuring;
  const thumb = await sealThumbnail(measured.thumbnail, key);
  stopIfCanceled(job);
  const auth = await authorize(
    "upload",
    thumb ? [hash, thumb.blob.hash] : [hash],
    `Upload ${item.name}`
  );
  stopIfCanceled(job);
  job.controller = new AbortController();
  await uploadBlob(data, hash, auth, {
    // Sealing adds a few bytes; the bar counts the file's own.
    onProgress: (loaded) => sample(item.id, Math.min(loaded, item.size)),
    signal: job.controller.signal,
  });
  job.sent.push(hash);
  patch(item.id, { loaded: item.size, status: "saving" });
  let thumbBlob: SealedBlob | undefined;
  if (thumb) {
    try {
      await uploadBlob(thumb.data, thumb.blob.hash, auth, {
        signal: job.controller.signal,
      });
      job.sent.push(thumb.blob.hash);
      thumbBlob = thumb.blob;
    } catch {
      // Previews are a nicety: the file itself still goes in.
    }
  }
  stopIfCanceled(job);
  const now = unixNow();
  const id = newId();
  const name = freeName(
    currentDrive(item.project),
    item.folder ?? TOP,
    cleanName(item.name) || "Untitled"
  );
  const filed = await publish(
    fileTemplate(item.project, {
      blob: { hash, nonce },
      createdAt: now,
      creator,
      duration: measured.duration,
      folder: item.folder,
      height: measured.height,
      id,
      key,
      name,
      size: item.size,
      thumb: thumbBlob,
      type: item.type,
      updatedAt: now,
      width: measured.width,
    })
  );
  if (!filed) {
    throw new Error("It wasn’t saved in the Drive.");
  }
  job.sent = [];
  jobs.delete(item.id);
  patch(item.id, { fileId: id, name, status: "done" });
}

async function start(id: string): Promise<void> {
  const item = items.find((each) => each.id === id);
  const job = jobs.get(id);
  if (!(item && job) || item.status !== "queued") {
    return;
  }
  job.canceled = false;
  job.running = true;
  job.sampledAt = performance.now();
  job.sampled = 0;
  patch(id, { error: undefined, loaded: 0, speed: 0, status: "uploading" });
  try {
    await send(item, job);
  } catch (error) {
    forget(job);
    if (job.canceled || error instanceof CanceledError) {
      patch(id, { status: "canceled" });
    } else {
      patch(id, { error: errorMessage(error), status: "failed" });
    }
  } finally {
    job.controller = undefined;
    job.running = false;
  }
}

let pumping = false;

/** Starts what's waiting, as far as there's room. Runs whenever any upload changes. */
function pump(): void {
  if (pumping) {
    return;
  }
  pumping = true;
  const running = items.filter(
    (item) => item.status === "uploading" || item.status === "saving"
  );
  let count = running.length;
  let bytes = running.reduce((sum, item) => sum + item.size, 0);
  for (const item of items.filter((queued) => queued.status === "queued")) {
    if (
      count >= CONCURRENT ||
      (count > 0 && bytes + item.size > MAX_RUNNING_BYTES)
    ) {
      break;
    }
    count += 1;
    bytes += item.size;
    start(item.id);
  }
  pumping = false;
}

listeners.add(pump);

/** Queues files for a Drive, each into its own folder or the destination's. */
function enqueue(
  files: { file: File; folder?: string }[],
  to: Destination
): void {
  const fitting = files.filter(
    ({ file }) => file.size <= MAX_DRIVE_FILE_BYTES && !JUNK.has(file.name)
  );
  const big = files.filter(({ file }) => file.size > MAX_DRIVE_FILE_BYTES);
  if (big.length > 0) {
    toast.error(
      big.length === 1
        ? `${big[0]?.file.name} is too big. ${TOO_BIG}`
        : `${plural(big.length, "file")} are too big. ${TOO_BIG}`
    );
  }
  const added = fitting.map(({ file, folder }): UploadItem => {
    const id = crypto.randomUUID();
    const type = typeOf(file);
    jobs.set(id, {
      canceled: false,
      file,
      running: false,
      sampled: 0,
      sampledAt: 0,
      sent: [],
    });
    return {
      ...to,
      folder: folder ?? to.folder,
      id,
      loaded: 0,
      name: file.name,
      preview:
        type.startsWith("image/") && file.size <= MAX_PREVIEW_BYTES
          ? URL.createObjectURL(file)
          : undefined,
      size: file.size,
      speed: 0,
      status: "queued",
      type,
    };
  });
  if (added.length > 0) {
    items = [...items, ...added];
    emit();
  }
}

/** Uploads files to a Drive. */
export function uploadFiles(files: File[], to: Destination): void {
  enqueue(
    files.map((file) => ({ file })),
    to
  );
}

/**
 * Uploads what was picked or dropped, folders and all: the folders are made
 * first, in the shape they had, and each file goes into its own.
 */
export async function uploadPicked(
  picked: PickedSet,
  to: Destination
): Promise<void> {
  if (picked.folders.length === 0) {
    uploadFiles(
      picked.files.map(({ file }) => file),
      to
    );
    return;
  }
  const made = await createFolders(to.project, to.folder, picked.folders);
  if (!made) {
    return;
  }
  const byPath = new Map(
    picked.folders.map((path, index) => [path.join("/"), made[index]])
  );
  enqueue(
    picked.files.map(({ file, path }) => ({
      file,
      folder: byPath.get(path.join("/")) ?? to.folder,
    })),
    to
  );
}

export function cancel(id: string): void {
  const item = items.find((each) => each.id === id);
  const job = jobs.get(id);
  if (!(item && job && isActive(item))) {
    return;
  }
  job.canceled = true;
  job.controller?.abort();
  // Shown at once; whatever step it's on stops at the next chance, and deletes what it sent.
  patch(id, { status: "canceled" });
}

export function cancelAll(): void {
  for (const item of items.filter(isActive)) {
    cancel(item.id);
  }
}

export function retry(id: string): void {
  const item = items.find((each) => each.id === id);
  const job = jobs.get(id);
  if (
    !(item && job) ||
    job.running ||
    (item.status !== "failed" && item.status !== "canceled")
  ) {
    return;
  }
  patch(id, { error: undefined, loaded: 0, speed: 0, status: "queued" });
}

/** Takes what's finished, failed or canceled off the tray, keeping what's still going. */
export function clearFinished(): void {
  for (const item of items.filter((each) => !isActive(each))) {
    if (item.preview) {
      URL.revokeObjectURL(item.preview);
    }
    jobs.delete(item.id);
  }
  items = items.filter(isActive);
  emit();
}

// Closing the tab would cut uploads off halfway, so the browser asks first.
globalThis.addEventListener("beforeunload", (event) => {
  if (items.some(isActive)) {
    event.preventDefault();
  }
});

// ———————————————————————————————————————— Reading what was picked

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

function isDirectoryEntry(
  entry: FileSystemEntry
): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  // oxlint-disable-next-line promise/avoid-new -- the File System API only takes callbacks
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function batchOf(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  // oxlint-disable-next-line promise/avoid-new -- the File System API only takes callbacks
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

/** Everything in a folder: it hands its entries over a hundred or so at a time, until none are left. */
async function entriesOf(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  const batch = await batchOf(reader);
  return batch.length === 0 ? [] : [...batch, ...(await entriesOf(reader))];
}

async function walk(
  entry: FileSystemEntry,
  path: string[],
  into: PickedSet
): Promise<void> {
  if (isFileEntry(entry)) {
    into.files.push({ file: await fileOf(entry), path });
    return;
  }
  if (!isDirectoryEntry(entry)) {
    return;
  }
  const inside = [...path, entry.name];
  into.folders.push(inside);
  const children = await entriesOf(entry.createReader());
  await Promise.all(children.map((child) => walk(child, inside, into)));
}

async function walkAll(entries: FileSystemEntry[]): Promise<PickedSet> {
  const into: PickedSet = { files: [], folders: [] };
  await Promise.all(entries.map((entry) => walk(entry, [], into)));
  return into;
}

/**
 * What was dropped from the computer, folders and all. Its items must be
 * taken while the drop is handled, so call this right in the handler.
 */
export function readDrop(transfer: DataTransfer): Promise<PickedSet> {
  const plain = [...transfer.files].map((file) => ({ file, path: [] }));
  const entries = [...transfer.items].flatMap((item) => {
    const entry = item.kind === "file" ? item.webkitGetAsEntry() : null;
    return entry ? [entry] : [];
  });
  return entries.some(isDirectoryEntry)
    ? walkAll(entries)
    : Promise.resolve({ files: plain, folders: [] });
}

/** Files picked with a folder picker, which tells each one's path within it. */
export function readPickedFolder(files: File[]): PickedSet {
  const folders = new Map<string, string[]>();
  const picked = files.map((file) => {
    const path = file.webkitRelativePath.split("/").slice(0, -1);
    for (let depth = 1; depth <= path.length; depth += 1) {
      const prefix = path.slice(0, depth);
      folders.set(prefix.join("/"), prefix);
    }
    return { file, path };
  });
  return { files: picked, folders: [...folders.values()] };
}

/** Uploads what was dropped into a Drive, folders and all. Call it right in the drop handler. */
export async function uploadDropped(
  transfer: DataTransfer,
  to: Destination
): Promise<void> {
  await uploadPicked(await readDrop(transfer), to);
}
