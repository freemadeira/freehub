import type { NostrEvent } from "applesauce-core/helpers/event";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { unixNow } from "applesauce-core/helpers/time";
import { toast } from "sonner";

import { deleteBlobs } from "@/lib/blossom";
import type {
  DriveContent,
  DriveFile,
  DriveFileFields,
  DriveFolder,
  DriveFolderFields,
  Place,
} from "@/lib/drive";
import {
  blobsToDelete,
  canMoveInto,
  cleanName,
  DEFAULT_FOLDER,
  driveTombstoneTemplate,
  everythingWithin,
  fileCommentTemplate,
  fileTemplate,
  folderTemplate,
  freeName,
  MAX_DRIVE_BATCH,
  nameTaken,
  nearestLive,
  resolveDrive,
  TOP,
  TRASH_SECONDS,
} from "@/lib/drive";
import { fetchFile } from "@/lib/drive-files";
import { driveMarks } from "@/lib/drive-marks";
import type { Comment } from "@/lib/model";
import {
  deleteCommentTemplate,
  DRIVE_FILE_KIND,
  DRIVE_FOLDER_KIND,
  newId,
} from "@/lib/model";
import { accounts, eventStore } from "@/lib/nostr";
import type { Color } from "@/lib/palette";
import type { Project } from "@/lib/project";
import { publish } from "@/lib/publish";
import {
  errorMessage,
  plural,
  readStorage,
  sleep,
  writeStorage,
} from "@/lib/utils";

/** Files and folders acted on together, like a selection. */
export interface Items {
  files: DriveFile[];
  folders: DriveFolder[];
}

/** Folders one folder dropped from the computer can hold, and how deep. */
const MAX_NEW_FOLDERS = 1000;
const MAX_DEPTH = 50;
/** Deleted blobs remembered, so they're not asked about again. */
const MAX_GONE = 2000;
/** Browsers take downloads started together better a little apart. */
const DOWNLOAD_GAP = 400;
/** Long enough for the browser to start saving, then the copy is let go. */
const SAVE_URL_MS = 60_000;

export function countItems({ files, folders }: Items): string {
  if (folders.length === 0) {
    return plural(files.length, "file");
  }
  if (files.length === 0) {
    return plural(folders.length, "folder");
  }
  return plural(files.length + folders.length, "item");
}

function me(): string | undefined {
  return accounts.active?.pubkey;
}

/**
 * The project's Drive as the store has it now, changes still at the signer
 * included: each change in a batch sees the ones before it, so names given
 * one after the other never clash.
 */
export function currentDrive(project: Project): DriveContent {
  return resolveDrive(
    project,
    eventStore.getTimeline([
      { "#a": [project.address], kinds: [DRIVE_FOLDER_KIND, DRIVE_FILE_KIND] },
    ])
  );
}

function folderFields(folder: DriveFolder): DriveFolderFields {
  return {
    color: folder.color,
    createdAt: folder.createdAt,
    creator: folder.creator,
    icon: folder.icon,
    id: folder.id,
    name: folder.name,
    parent: folder.parent,
    trashed: folder.trashed,
  };
}

function fileFields(file: DriveFile): DriveFileFields {
  return {
    blob: file.blob,
    createdAt: file.createdAt,
    creator: file.creator,
    duration: file.duration,
    folder: file.folder,
    height: file.height,
    id: file.id,
    key: file.key,
    name: file.name,
    size: file.size,
    thumb: file.thumb,
    trashed: file.trashed,
    type: file.type,
    updatedAt: file.updatedAt,
    width: file.width,
  };
}

function saveFolder(
  project: Project,
  folder: DriveFolder,
  changes: Partial<DriveFolderFields>
): Promise<boolean> {
  return publish(
    folderTemplate(project, { ...folderFields(folder), ...changes }),
    folder.event
  );
}

function saveFile(
  project: Project,
  file: DriveFile,
  changes: Partial<DriveFileFields>
): Promise<boolean> {
  return publish(
    fileTemplate(project, { ...fileFields(file), ...changes }),
    file.event
  );
}

async function allSaved(saves: Promise<boolean>[]): Promise<boolean> {
  const saved = await Promise.all(saves);
  return saved.every(Boolean);
}

function tooMany(items: Items): boolean {
  if (items.files.length + items.folders.length > MAX_DRIVE_BATCH) {
    toast.error(`Up to ${MAX_DRIVE_BATCH} at a time.`);
    return true;
  }
  return false;
}

// ———————————————————————————————————————— Folders

/** Starts a folder, under the name given or "New folder", numbered if it's taken. Its id is known at once. */
export function createFolder(
  project: Project,
  parent?: string,
  fields: { name?: string; color?: Color; icon?: string } = {}
): { id: string; name: string; saved: Promise<boolean> } {
  const id = newId();
  const name = freeName(
    currentDrive(project),
    parent ?? TOP,
    cleanName(fields.name ?? "") || DEFAULT_FOLDER
  );
  const saved = publish(
    folderTemplate(project, {
      color: fields.color,
      createdAt: unixNow(),
      creator: me(),
      icon: fields.icon,
      id,
      name,
      parent,
    })
  );
  return { id, name, saved };
}

/**
 * Makes the folders of a folder dropped from the computer, each path a list
 * of names from the top of what was dropped down. Resolves with each path's
 * folder, in the same order, once all are saved: what's dropped keeps its shape.
 */
export async function createFolders(
  project: Project,
  parent: string | undefined,
  paths: string[][]
): Promise<(string | undefined)[] | undefined> {
  if (paths.length > MAX_NEW_FOLDERS) {
    toast.error(`A dropped folder can hold up to ${MAX_NEW_FOLDERS} folders.`);
    return undefined;
  }
  const made = new Map<string, string>();
  const saves: Promise<boolean>[] = [];
  const make = (path: string[]): string | undefined => {
    if (path.length === 0) {
      return parent;
    }
    const joined = path.join("/");
    const known = made.get(joined);
    if (known) {
      return known;
    }
    const above = make(path.slice(0, -1));
    const folder = createFolder(project, above, {
      name: path.at(-1) ?? DEFAULT_FOLDER,
    });
    made.set(joined, folder.id);
    saves.push(folder.saved);
    return folder.id;
  };
  const folders = paths.map((path) =>
    make(
      path.slice(0, MAX_DEPTH).map((name) => cleanName(name) || DEFAULT_FOLDER)
    )
  );
  return (await allSaved(saves)) ? folders : undefined;
}

/** Renames a folder, or changes its color or emoji; null takes either away. */
export function updateFolder(
  project: Project,
  folder: DriveFolder,
  changes: { name?: string; color?: Color | null; icon?: string | null }
): Promise<boolean> {
  const current = currentDrive(project);
  const latest = current.allFolders.get(folder.id) ?? folder;
  const fields: Partial<DriveFolderFields> = {};
  if (changes.name !== undefined) {
    const name = cleanName(changes.name);
    if (!name) {
      toast.error("Give the folder a name.");
      return Promise.resolve(false);
    }
    if (nameTaken(current, latest.parent ?? TOP, name, latest.id)) {
      toast.error(`There’s already something called “${name}” here.`);
      return Promise.resolve(false);
    }
    fields.name = name;
  }
  if (changes.color !== undefined) {
    fields.color = changes.color ?? undefined;
  }
  if (changes.icon !== undefined) {
    fields.icon = changes.icon?.trim() || undefined;
  }
  return saveFolder(project, latest, fields);
}

// ———————————————————————————————————————— Files and folders

export function renameFile(
  project: Project,
  file: DriveFile,
  name: string
): Promise<boolean> {
  const current = currentDrive(project);
  const latest = current.allFiles.get(file.id) ?? file;
  const next = cleanName(name);
  if (!next) {
    toast.error("Give the file a name.");
    return Promise.resolve(false);
  }
  if (next === latest.name) {
    return Promise.resolve(true);
  }
  if (nameTaken(current, latest.folder ?? TOP, next, latest.id)) {
    toast.error(`There’s already something called “${next}” here.`);
    return Promise.resolve(false);
  }
  return saveFile(project, latest, { name: next, updatedAt: unixNow() });
}

/**
 * Moves files and folders into a folder, or to the top of the Drive. Any
 * whose name is taken there gets the first numbered one free.
 */
export function moveItems(
  project: Project,
  items: Items,
  to: string | undefined
): Promise<boolean> {
  if (tooMany(items)) {
    return Promise.resolve(false);
  }
  const target: Place = to ?? TOP;
  const start = currentDrive(project);
  if (
    !canMoveInto(
      start.tree,
      items.folders.map((folder) => folder.id),
      target
    )
  ) {
    toast.error("A folder can’t go inside itself.");
    return Promise.resolve(false);
  }
  const saves: Promise<boolean>[] = [];
  for (const { id } of items.folders) {
    const current = currentDrive(project);
    const folder = current.tree.byId.get(id);
    if (folder && folder.parent !== to) {
      saves.push(
        saveFolder(project, folder, {
          name: freeName(current, target, folder.name, id),
          parent: to,
        })
      );
    }
  }
  const now = unixNow();
  for (const { id } of items.files) {
    const current = currentDrive(project);
    const file = current.fileById.get(id);
    if (file && file.folder !== to) {
      saves.push(
        saveFile(project, file, {
          folder: to,
          name: freeName(current, target, file.name, id),
          updatedAt: now,
        })
      );
    }
  }
  return allSaved(saves);
}

/**
 * Takes files and folders out of the trash, back where they were or, if that
 * folder is in the trash too, the nearest one above it that isn't.
 */
export function restoreItems(project: Project, items: Items): Promise<boolean> {
  if (tooMany(items)) {
    return Promise.resolve(false);
  }
  const saves: Promise<boolean>[] = [];
  for (const { id } of items.folders) {
    const current = currentDrive(project);
    const folder = current.allFolders.get(id);
    if (folder?.trashed) {
      const home = nearestLive(current, folder.parent);
      saves.push(
        saveFolder(project, folder, {
          name: freeName(current, home ?? TOP, folder.name, id),
          parent: home,
          trashed: undefined,
        })
      );
    }
  }
  for (const { id } of items.files) {
    const current = currentDrive(project);
    const file = current.allFiles.get(id);
    if (file?.trashed) {
      const home = nearestLive(current, file.folder);
      saves.push(
        saveFile(project, file, {
          folder: home,
          name: freeName(current, home ?? TOP, file.name, id),
          trashed: undefined,
          updatedAt: unixNow(),
        })
      );
    }
  }
  return allSaved(saves);
}

/** Puts files and folders in the trash for 30 days, with a toast to take it back. */
export async function trashItems(
  project: Project,
  items: Items
): Promise<void> {
  const by = me();
  if (!by || tooMany(items)) {
    return;
  }
  const trashed = { at: unixNow(), by };
  const current = currentDrive(project);
  const saves: Promise<boolean>[] = [];
  for (const { id } of items.folders) {
    const folder = current.allFolders.get(id);
    if (folder && !folder.trashed) {
      saves.push(saveFolder(project, folder, { trashed }));
    }
  }
  for (const { id } of items.files) {
    const file = current.allFiles.get(id);
    if (file && !file.trashed) {
      saves.push(saveFile(project, file, { trashed }));
    }
  }
  if (await allSaved(saves)) {
    toast.success(`${countItems(items)} moved to the trash`, {
      action: { label: "Undo", onClick: () => restoreItems(project, items) },
    });
  }
}

// ———————————————————————————————————————— Blobs

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

/** Blobs being deleted now, so two cleanups never ask for the same one. */
const deletingBlobs = new Set<string>();

function blobHashes(file: DriveFile): string[] {
  return file.thumb ? [file.blob.hash, file.thumb.hash] : [file.blob.hash];
}

/** Deletes these blobs of yours from the servers, unless they're gone already, and remembers which went. */
async function forgetBlobs(pubkey: string, hashes: string[]): Promise<void> {
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
 * a relay has the deletion. Only the uploader's key can delete a blob, so each
 * uploader's app cleans up after their own.
 */
export async function cleanUpBlobs(tombstones: NostrEvent[]): Promise<void> {
  const pubkey = me();
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

/** Deletes trashed files and folders for good, with everything inside the folders. */
export async function purgeItems(
  project: Project,
  items: Items
): Promise<boolean> {
  const current = currentDrive(project);
  const gone = new Map<string, DriveFolder | DriveFile>();
  for (const { id } of items.folders) {
    const folder = current.allFolders.get(id);
    if (folder) {
      gone.set(folder.id, folder);
      const inside = everythingWithin(current, folder.id);
      for (const item of [...inside.folders, ...inside.files]) {
        gone.set(item.id, item);
      }
    }
  }
  for (const { id } of items.files) {
    const file = current.allFiles.get(id);
    if (file) {
      gone.set(file.id, file);
    }
  }
  const deleting = [...gone.values()];
  const saved = await Promise.all(
    deleting.map((item) =>
      publish(driveTombstoneTemplate(project, item), item.event)
    )
  );
  const pubkey = me();
  if (pubkey) {
    // A relay has the deletion, so your blobs can go now; others' wait for their uploaders' apps.
    await forgetBlobs(
      pubkey,
      deleting.flatMap((item, index) =>
        saved[index] && "blob" in item && item.creator === pubkey
          ? blobHashes(item)
          : []
      )
    );
  }
  return saved.every(Boolean);
}

/** Deletes everything in the Drive's trash for good. */
export function emptyTrash(project: Project): Promise<boolean> {
  const { trash } = currentDrive(project);
  return purgeItems(project, trash);
}

const purgedExpired = new Set<string>();

/**
 * Deletes what's been in the trash for 30 days. Any member's app does it when
 * they open the Drive, once a session; two doing it at once agree.
 */
export function purgeExpired(project: Project): void {
  if (purgedExpired.has(project.address)) {
    return;
  }
  purgedExpired.add(project.address);
  const before = unixNow() - TRASH_SECONDS;
  const { trash } = currentDrive(project);
  const expired: Items = {
    files: trash.files.filter((file) => (file.trashed?.at ?? 0) < before),
    folders: trash.folders.filter(
      (folder) => (folder.trashed?.at ?? 0) < before
    ),
  };
  if (expired.files.length + expired.folders.length > 0) {
    purgeItems(project, expired);
  }
}

// ———————————————————————————————————————— Per person

export function setStarred(
  pubkey: string,
  project: Project,
  ids: string[],
  starred: boolean
): void {
  driveMarks(pubkey, project.address).setStarred(ids, starred);
}

/** Notes the person opened the file, for their recent files. */
export function markOpened(
  pubkey: string,
  project: string,
  fileId: string
): void {
  driveMarks(pubkey, project).opened(fileId);
}

// ———————————————————————————————————————— Downloads

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), SAVE_URL_MS);
}

/** Saves the file, opened, under the name it has now. */
export async function downloadFile(file: DriveFile): Promise<void> {
  try {
    save(await fetchFile(file), file.name);
  } catch (error) {
    toast.error(`“${file.name}” couldn’t be downloaded.`, {
      description: errorMessage(error),
    });
  }
}

/** Saves several files, one after the other, so the browser takes each. */
export async function downloadFiles(files: DriveFile[]): Promise<void> {
  const [first, ...rest] = files;
  if (!first) {
    return;
  }
  await downloadFile(first);
  if (rest.length > 0) {
    await sleep(DOWNLOAD_GAP);
    await downloadFiles(rest);
  }
}

// ———————————————————————————————————————— Comments

export function addFileComment(
  file: DriveFile,
  content: string
): Promise<boolean> {
  return publish(fileCommentTemplate(file, content));
}

export function deleteFileComment(comment: Comment): Promise<boolean> {
  return publish(deleteCommentTemplate(comment));
}
