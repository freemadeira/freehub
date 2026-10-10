import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import { mentionedPubkeys } from "@/lib/mentions";
import type { Template } from "@/lib/model";
import {
  addressOf,
  COMMENT_KIND,
  DRIVE_FILE_KIND,
  DRIVE_FOLDER_KIND,
  integer,
  isDeleted,
  isPubkey,
  latestVersions,
  PROJECT_KIND,
} from "@/lib/model";
import type { Color } from "@/lib/palette";
import { COLORS } from "@/lib/palette";
import type { Project } from "@/lib/project";

/**
 * A project's Drive. Folders and files are addressable events any member can
 * write, like doc pages: the newest version of each across the members wins.
 * The files themselves sit on the team's Blossom servers, encrypted in the
 * browser, with the key in the file's event on the private relay.
 */

/** The largest file the Drive takes: it's encrypted in memory, all at once. */
export const MAX_DRIVE_FILE_BYTES = 100 * 1024 * 1024;

/** Thumbnails are small pictures the browser makes on upload; anything bigger isn't one. */
export const MAX_THUMB_BYTES = 2 * 1024 * 1024;

/** How long trashed files and folders wait before they're deleted for good. */
export const TRASH_DAYS = 30;
export const TRASH_SECONDS = TRASH_DAYS * 24 * 60 * 60;

export const MAX_DRIVE_NAME = 255;

/** Files and folders moved or trashed in one go, each a change of its own to sign. */
export const MAX_DRIVE_BATCH = 500;

export const DEFAULT_FOLDER = "New folder";

const MAX_TYPE = 100;
const MAX_ICON = 16;

/** The only cipher files are kept in, as in NIP-17's file messages. */
const ALGORITHM = "aes-gcm";
const HEX_32 = /^[0-9a-f]{64}$/u;
const HEX_12 = /^[0-9a-f]{24}$/u;

const UNSAFE = /[\p{Cc}/\\]+/gu;
const SPACES = /\s+/gu;
const DIMENSIONS = /^(?<width>\d+)x(?<height>\d+)$/u;

/** A name fit for the Drive: one line, no slashes, not too long. Empty when nothing's left. */
export function cleanName(name: string): string {
  return name
    .replaceAll(UNSAFE, " ")
    .replaceAll(SPACES, " ")
    .trim()
    .slice(0, MAX_DRIVE_NAME);
}

/**
 * The name split before its extension: "brief.v2.pdf" is "brief.v2" and
 * ".pdf". Names starting with their only dot, like ".env", have none.
 */
export function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/** Names compare without case, as on most computers, so "Brief.pdf" and "brief.pdf" clash. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** The name with a number before its extension, like "brief (2).pdf". */
export function numberedName(name: string, number: number): string {
  const [base, extension] = splitName(name);
  return `${base} (${number})${extension}`;
}

/** A size limit as people read it, like "100 MB" or "2 GB". */
export function sizeLimit(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;
  return megabytes >= 1024 && megabytes % 1024 === 0
    ? `${megabytes / 1024} GB`
    : `${Math.round(megabytes)} MB`;
}

export const TOO_BIG = `Files can be up to ${sizeLimit(MAX_DRIVE_FILE_BYTES)}.`;

function cleanIcon(icon: string | undefined): string | undefined {
  return icon?.trim().slice(0, MAX_ICON) || undefined;
}

/** A positive, finite number, or nothing. */
function measure(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

// ———————————————————————————————————————— Folders and files

/** When something went in the trash, in seconds, and who put it there. */
export interface Trashed {
  at: number;
  by: string;
}

export interface DriveFolderFields {
  id: string;
  name: string;
  /** The folder it sits in, or none at the top of the Drive. */
  parent?: string;
  color?: Color;
  /** An emoji shown on the folder, or missing for none. */
  icon?: string;
  createdAt: number;
  creator?: string;
  /** Only on what was trashed itself: what's inside goes along, unmarked, and comes back with it. */
  trashed?: Trashed;
}

export type DriveFolder = DriveFolderFields & {
  /** Address of the project the folder belongs to. */
  project: string;
  /** Who saved the newest version. */
  author: string;
  updatedAt: number;
  event: NostrEvent;
};

/** Something encrypted on the Blossom servers: its hash there, and the nonce it was sealed with. */
export interface SealedBlob {
  hash: string;
  nonce: string;
}

export interface DriveFileFields {
  id: string;
  name: string;
  /** The folder it sits in, or none at the top of the Drive. */
  folder?: string;
  /** In bytes, before it was encrypted. */
  size: number;
  /** MIME type, or empty when the browser didn't know it. */
  type: string;
  /** Pixels, for images and videos the browser could read. */
  width?: number;
  height?: number;
  /** Seconds, for videos and audio the browser could read. */
  duration?: number;
  /** The AES-GCM key of the file and its thumbnail, as hex. */
  key: string;
  blob: SealedBlob;
  /** A small picture of it, made in the browser on upload. */
  thumb?: SealedBlob;
  /** Who uploaded it: only they can delete its blobs from the servers. */
  creator: string;
  /** When it was uploaded. */
  createdAt: number;
  /** When it was uploaded, renamed or moved. */
  updatedAt: number;
  trashed?: Trashed;
}

export type DriveFile = DriveFileFields & {
  /** Address of the project the file belongs to. */
  project: string;
  /** Who saved the newest version. */
  author: string;
  event: NostrEvent;
};

/** A folder's id, or "" for the top of the Drive. */
export type Place = string;
export const TOP: Place = "";

export interface DriveTree {
  /** Every folder out of the trash. */
  folders: DriveFolder[];
  byId: Map<string, DriveFolder>;
  /** The folders in each place, by name. */
  children: Map<Place, DriveFolder[]>;
}

export const EMPTY_TREE: DriveTree = {
  byId: new Map(),
  children: new Map(),
  folders: [],
};

export interface DriveContent {
  tree: DriveTree;
  /** Every file out of the trash. */
  files: DriveFile[];
  fileById: Map<string, DriveFile>;
  /** The files in each place. */
  filesIn: Map<Place, DriveFile[]>;
  /** What each folder holds, folders and files, right inside it. */
  counts: Map<string, number>;
  /** What was put in the trash itself; what's inside a trashed folder goes with it. */
  trash: { folders: DriveFolder[]; files: DriveFile[] };
  /** Every folder and file, in the trash or not, by id. */
  allFolders: Map<string, DriveFolder>;
  allFiles: Map<string, DriveFile>;
  /** The newest versions of files deleted for good, which still name their blobs. */
  deleted: NostrEvent[];
}

export const EMPTY_DRIVE: DriveContent = {
  allFiles: new Map(),
  allFolders: new Map(),
  counts: new Map(),
  deleted: [],
  fileById: new Map(),
  files: [],
  filesIn: new Map(),
  trash: { files: [], folders: [] },
  tree: EMPTY_TREE,
};

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}

function parseTrashed(event: NostrEvent): Trashed | undefined {
  const tag = event.tags.find(([name]) => name === "trashed");
  const at = integer(tag?.[1]);
  const by = tag?.[2];
  return at !== undefined && isPubkey(by) ? { at, by } : undefined;
}

function parseSealed(
  hash: string | undefined,
  nonce: string | undefined
): SealedBlob | undefined {
  return hash && nonce && HEX_32.test(hash) && HEX_12.test(nonce)
    ? { hash, nonce }
    : undefined;
}

function parseFolder(
  event: NostrEvent,
  id: string,
  project: string
): DriveFolder {
  return {
    author: event.pubkey,
    color: COLORS.find((color) => color === getTagValue(event, "color")),
    createdAt: integer(getTagValue(event, "created")) ?? event.created_at,
    creator: [getTagValue(event, "creator")].find(isPubkey),
    event,
    icon: cleanIcon(getTagValue(event, "icon")),
    id,
    name: cleanName(getTagValue(event, "name") ?? "") || DEFAULT_FOLDER,
    parent: getTagValue(event, "parent") || undefined,
    project,
    trashed: parseTrashed(event),
    updatedAt: event.created_at,
  };
}

/** The file in its newest version, or nothing when it can't be read, like one without its key. */
function parseFile(
  event: NostrEvent,
  id: string,
  project: string
): DriveFile | undefined {
  const key = getTagValue(event, "decryption-key");
  const blob = parseSealed(
    getTagValue(event, "x"),
    getTagValue(event, "decryption-nonce")
  );
  const thumbTag = event.tags.find(([name]) => name === "thumbnail");
  const size = integer(getTagValue(event, "size"));
  if (
    getTagValue(event, "encryption-algorithm") !== ALGORITHM ||
    !(key && HEX_32.test(key) && blob) ||
    size === undefined ||
    size < 0
  ) {
    return undefined;
  }
  const dimensions = DIMENSIONS.exec(getTagValue(event, "dim") ?? "")?.groups;
  const createdAt = integer(getTagValue(event, "created")) ?? event.created_at;
  return {
    author: event.pubkey,
    blob,
    createdAt,
    creator: [getTagValue(event, "creator")].find(isPubkey) ?? event.pubkey,
    duration: measure(Number(getTagValue(event, "duration"))),
    event,
    folder: getTagValue(event, "folder") || undefined,
    height: measure(Number(dimensions?.height)),
    id,
    key,
    name: cleanName(getTagValue(event, "name") ?? "") || "Untitled",
    project,
    size,
    thumb: parseSealed(thumbTag?.[1], thumbTag?.[2]),
    trashed: parseTrashed(event),
    type: (getTagValue(event, "m") ?? "").slice(0, MAX_TYPE),
    updatedAt: integer(getTagValue(event, "updated")) ?? createdAt,
    width: measure(Number(dimensions?.width)),
  };
}

/** The project's own Drive events, by members, out of everything given. */
function ownEvents(
  project: Project,
  events: NostrEvent[],
  kind: number
): Map<string, NostrEvent> {
  const authors = new Set(project.members);
  const own = events.filter(
    (event) =>
      event.kind === kind &&
      authors.has(event.pubkey) &&
      addressOf(event, PROJECT_KIND) === project.address
  );
  return latestVersions(own, kind, authors);
}

/**
 * Every folder that isn't deleted, trashed or not. One whose folder is gone,
 * or that ends up inside itself after two moves made at once, sits at the top
 * instead of disappearing.
 */
function resolveAllFolders(
  project: Project,
  events: NostrEvent[]
): Map<string, DriveFolder> {
  const parsed = [...ownEvents(project, events, DRIVE_FOLDER_KIND)]
    .filter(([, event]) => !isDeleted(event))
    .map(([id, event]) => parseFolder(event, id, project.address));
  const raw = new Map(parsed.map((folder) => [folder.id, folder]));
  const placeable = (folder: DriveFolder): boolean => {
    const seen = new Set<string>();
    for (
      let id = folder.parent;
      id !== undefined && raw.has(id) && !seen.has(id);
      id = raw.get(id)?.parent
    ) {
      if (id === folder.id) {
        return false;
      }
      seen.add(id);
    }
    return folder.parent === undefined || raw.has(folder.parent);
  };
  return new Map(
    parsed.map((folder) => [
      folder.id,
      placeable(folder) ? folder : { ...folder, parent: undefined },
    ])
  );
}

/** The ids of folders out of the trash: neither trashed, nor inside one that is. */
function liveFolderIds(all: Map<string, DriveFolder>): Set<string> {
  const live = new Set<string>();
  const known = new Map<string, boolean>();
  const isLive = (folder: DriveFolder): boolean => {
    const cached = known.get(folder.id);
    if (cached !== undefined) {
      return cached;
    }
    // Placed folders never loop, so this ends.
    const parent = folder.parent ? all.get(folder.parent) : undefined;
    const result = !folder.trashed && (!parent || isLive(parent));
    known.set(folder.id, result);
    return result;
  };
  for (const folder of all.values()) {
    if (isLive(folder)) {
      live.add(folder.id);
    }
  }
  return live;
}

function buildTree(folders: DriveFolder[]): DriveTree {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const children = new Map<Place, DriveFolder[]>();
  for (const folder of folders.toSorted((a, b) =>
    compareNames(a.name, b.name)
  )) {
    const place = folder.parent ?? TOP;
    children.set(place, [...(children.get(place) ?? []), folder]);
  }
  return { byId, children, folders };
}

/** The project's folders out of the trash, as a tree. Folder events are all it needs. */
export function resolveTree(project: Project, events: NostrEvent[]): DriveTree {
  const all = resolveAllFolders(project, events);
  const live = liveFolderIds(all);
  return buildTree([...all.values()].filter((folder) => live.has(folder.id)));
}

/** The project's Drive, resolved across every member's versions. */
export function resolveDrive(
  project: Project,
  events: NostrEvent[]
): DriveContent {
  const allFolders = resolveAllFolders(project, events);
  const live = liveFolderIds(allFolders);
  const tree = buildTree(
    [...allFolders.values()].filter((folder) => live.has(folder.id))
  );
  const deleted: NostrEvent[] = [];
  const allFiles = new Map<string, DriveFile>();
  for (const [id, event] of ownEvents(project, events, DRIVE_FILE_KIND)) {
    if (isDeleted(event)) {
      deleted.push(event);
      continue;
    }
    const file = parseFile(event, id, project.address);
    if (file) {
      // A file whose folder is gone for good shows at the top.
      allFiles.set(
        id,
        file.folder && !allFolders.has(file.folder)
          ? { ...file, folder: undefined }
          : file
      );
    }
  }
  const files = [...allFiles.values()].filter(
    (file) => !file.trashed && (!file.folder || live.has(file.folder))
  );
  const filesIn = new Map<Place, DriveFile[]>();
  const counts = new Map<string, number>();
  for (const file of files) {
    const place = file.folder ?? TOP;
    filesIn.set(place, [...(filesIn.get(place) ?? []), file]);
    if (file.folder) {
      counts.set(file.folder, (counts.get(file.folder) ?? 0) + 1);
    }
  }
  for (const folder of tree.folders) {
    if (folder.parent) {
      counts.set(folder.parent, (counts.get(folder.parent) ?? 0) + 1);
    }
  }
  return {
    allFiles,
    allFolders,
    counts,
    deleted,
    fileById: new Map(files.map((file) => [file.id, file])),
    files,
    filesIn,
    trash: {
      files: [...allFiles.values()].filter((file) => file.trashed),
      folders: [...allFolders.values()].filter((folder) => folder.trashed),
    },
    tree,
  };
}

/**
 * One file's newest version in the project, by its members, unless it was
 * deleted or put in the trash itself.
 */
export function resolveFile(
  project: Project,
  events: NostrEvent[],
  id: string
): DriveFile | undefined {
  const event = ownEvents(
    project,
    events.filter((item) => getTagValue(item, "d") === id),
    DRIVE_FILE_KIND
  ).get(id);
  const file =
    event && !isDeleted(event)
      ? parseFile(event, id, project.address)
      : undefined;
  return file?.trashed ? undefined : file;
}

/** The folders from the top of the Drive down to this one, itself last. */
export function pathTo(
  tree: DriveTree,
  folderId: string | undefined
): DriveFolder[] {
  const chain: DriveFolder[] = [];
  const seen = new Set<string>();
  for (
    let folder = folderId ? tree.byId.get(folderId) : undefined;
    folder && !seen.has(folder.id);
    folder = folder.parent ? tree.byId.get(folder.parent) : undefined
  ) {
    seen.add(folder.id);
    chain.unshift(folder);
  }
  return chain;
}

/** Every folder inside this one, at any depth. */
export function foldersWithin(
  tree: DriveTree,
  folderId: string
): DriveFolder[] {
  return (tree.children.get(folderId) ?? []).flatMap((child) => [
    child,
    ...foldersWithin(tree, child.id),
  ]);
}

/** Whether these folders may go into `target`: never into themselves or what's inside them. */
export function canMoveInto(
  tree: DriveTree,
  folderIds: readonly string[],
  target: Place
): boolean {
  return folderIds.every(
    (id) =>
      id !== target &&
      !foldersWithin(tree, id).some((folder) => folder.id === target)
  );
}

/** Whether anything out of the trash in the place goes by the name, besides `except`. */
export function nameTaken(
  content: DriveContent,
  place: Place,
  name: string,
  except?: string
): boolean {
  const key = nameKey(name);
  const clashes = (item: { id: string; name: string }) =>
    item.id !== except && nameKey(item.name) === key;
  return (
    (content.filesIn.get(place) ?? []).some(clashes) ||
    (content.tree.children.get(place) ?? []).some(clashes)
  );
}

/** The name, or the first numbered one free in the place, like "brief (2).pdf". */
export function freeName(
  content: DriveContent,
  place: Place,
  name: string,
  except?: string
): string {
  let candidate = name;
  for (
    let number = 1;
    nameTaken(content, place, candidate, except);
    number += 1
  ) {
    candidate = numberedName(name, number);
  }
  return candidate;
}

/** The folder, or the nearest one above it out of the trash; the top of the Drive at worst. */
export function nearestLive(
  content: DriveContent,
  folderId: string | undefined
): string | undefined {
  const seen = new Set<string>();
  for (
    let id = folderId;
    id !== undefined && !seen.has(id);
    id = content.allFolders.get(id)?.parent
  ) {
    if (content.tree.byId.has(id)) {
      return id;
    }
    seen.add(id);
  }
  return undefined;
}

/** Every folder and file inside the folder, at any depth, trashed or not. */
export function everythingWithin(
  content: DriveContent,
  folderId: string
): { folders: DriveFolder[]; files: DriveFile[] } {
  const ids = new Set([folderId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const folder of content.allFolders.values()) {
      if (folder.parent && ids.has(folder.parent) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  ids.delete(folderId);
  return {
    files: [...content.allFiles.values()].filter(
      (file) =>
        file.folder !== undefined &&
        (file.folder === folderId || ids.has(file.folder))
    ),
    folders: [...ids].flatMap((id) => content.allFolders.get(id) ?? []),
  };
}

// ———————————————————————————————————————— Events

function trashTag(trashed: Trashed | undefined): string[][] {
  return trashed ? [["trashed", String(trashed.at), trashed.by]] : [];
}

export function folderTemplate(
  project: Pick<Project, "address">,
  folder: DriveFolderFields
): Template {
  const tags = [
    ["d", folder.id],
    ["a", project.address],
    ["name", folder.name],
    ["created", String(folder.createdAt)],
  ];
  if (folder.parent) {
    tags.push(["parent", folder.parent]);
  }
  if (folder.color) {
    tags.push(["color", folder.color]);
  }
  if (folder.icon) {
    tags.push(["icon", folder.icon]);
  }
  if (folder.creator) {
    tags.push(["creator", folder.creator]);
  }
  tags.push(...trashTag(folder.trashed), ["alt", `Folder: ${folder.name}`]);
  return { content: "", kind: DRIVE_FOLDER_KIND, tags };
}

/**
 * A version of the file. The encryption tags follow NIP-17's file messages:
 * `x` is the hash of the encrypted file, as the Blossom servers have it.
 */
export function fileTemplate(
  project: Pick<Project, "address">,
  file: DriveFileFields
): Template {
  const tags = [
    ["d", file.id],
    ["a", project.address],
    ["name", file.name],
    ["size", String(file.size)],
    ["encryption-algorithm", ALGORITHM],
    ["decryption-key", file.key],
    ["decryption-nonce", file.blob.nonce],
    ["x", file.blob.hash],
    ["creator", file.creator],
    ["created", String(file.createdAt)],
    ["updated", String(file.updatedAt)],
  ];
  if (file.folder) {
    tags.push(["folder", file.folder]);
  }
  if (file.type) {
    tags.push(["m", file.type]);
  }
  if (file.thumb) {
    tags.push(["thumbnail", file.thumb.hash, file.thumb.nonce]);
  }
  if (file.width && file.height) {
    tags.push(["dim", `${Math.round(file.width)}x${Math.round(file.height)}`]);
  }
  if (file.duration) {
    tags.push(["duration", String(file.duration)]);
  }
  tags.push(...trashTag(file.trashed), ["alt", `File: ${file.name}`]);
  return { content: "", kind: DRIVE_FILE_KIND, tags };
}

/**
 * Deletes the folder or file for good. A file's tombstone still names its
 * blobs and who uploaded them, so their client can delete them from the servers.
 */
export function driveTombstoneTemplate(
  project: Pick<Project, "address">,
  item: DriveFolder | DriveFile
): Template {
  const tags = [["d", item.id], ["a", project.address], ["deleted"]];
  if ("blob" in item) {
    tags.push(["creator", item.creator], ["x", item.blob.hash]);
    if (item.thumb) {
      tags.push(["x", item.thumb.hash]);
    }
  }
  return { content: "", kind: item.event.kind, tags };
}

/** The blobs a deleted file's tombstone names, if `pubkey` uploaded them. */
export function blobsToDelete(tombstone: NostrEvent, pubkey: string): string[] {
  return getTagValue(tombstone, "creator") === pubkey
    ? tombstone.tags.flatMap(([name, hash]) =>
        name === "x" && hash && HEX_32.test(hash) ? [hash] : []
      )
    : [];
}

/** Where comments on the file may point: its address under every member. */
export function fileCommentAddresses(
  project: Pick<Project, "members">,
  file: Pick<DriveFile, "id">
): string[] {
  return project.members.map(
    (member) => `${DRIVE_FILE_KIND}:${member}:${file.id}`
  );
}

/** A NIP-22 comment on a file, with a `p` tag for everyone it mentions. */
export function fileCommentTemplate(
  file: DriveFile,
  content: string
): Template {
  const address = `${DRIVE_FILE_KIND}:${file.author}:${file.id}`;
  const mentioned = mentionedPubkeys(content).filter(
    (pubkey) => pubkey !== file.author
  );
  return {
    content,
    kind: COMMENT_KIND,
    tags: [
      ["A", address],
      ["K", String(DRIVE_FILE_KIND)],
      ["P", file.author],
      ["a", address],
      ["k", String(DRIVE_FILE_KIND)],
      ["p", file.author],
      ...mentioned.map((pubkey) => ["p", pubkey]),
    ],
  };
}

// ———————————————————————————————————————— Kinds of files

export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "doc"
  | "sheet"
  | "slides"
  | "archive"
  | "code"
  | "text"
  | "design"
  | "file";

const BY_EXTENSION: Record<string, FileKind> = {};
for (const [kind, list] of [
  ["image", "png jpg jpeg gif webp avif svg heic heif bmp ico tif tiff"],
  ["video", "mp4 mov webm mkv avi m4v mpg mpeg ogv 3gp"],
  ["audio", "mp3 wav ogg oga m4a flac aac opus aiff"],
  ["pdf", "pdf"],
  ["doc", "doc docx odt rtf pages"],
  ["sheet", "xls xlsx xlsm ods csv tsv numbers"],
  ["slides", "ppt pptx odp key"],
  ["archive", "zip rar 7z tar gz tgz bz2 xz"],
  [
    "code",
    "js jsx mjs cjs ts tsx json html htm css scss less py rb go rs java kt swift c h cpp hpp cs php sh bash zsh ps1 yml yaml toml xml sql vue svelte graphql",
  ],
  ["text", "txt md markdown log ini cfg conf env"],
  ["design", "fig sketch psd ai xd indd"],
] as const) {
  for (const extension of list.split(" ")) {
    BY_EXTENSION[extension] = kind;
  }
}

/** The extension in lowercase, without its dot; empty when there's none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** What kind of file it is, for its icon and preview: by extension, then by MIME type. */
export function fileKind(file: { name: string; type: string }): FileKind {
  const byName = BY_EXTENSION[extensionOf(file.name)];
  if (byName) {
    return byName;
  }
  const { type } = file;
  for (const kind of ["image", "video", "audio"] as const) {
    if (type.startsWith(`${kind}/`)) {
      return kind;
    }
  }
  if (type === "application/pdf") {
    return "pdf";
  }
  if (/zip|compressed|tar|rar/u.test(type)) {
    return "archive";
  }
  if (/json|javascript|xml/u.test(type)) {
    return "code";
  }
  return type.startsWith("text/") ? "text" : "file";
}

/** What people call the kind, for lists and details. */
export const KIND_LABELS: Record<FileKind, string> = {
  archive: "Archive",
  audio: "Audio",
  code: "Code",
  design: "Design",
  doc: "Document",
  file: "File",
  image: "Image",
  pdf: "PDF",
  sheet: "Spreadsheet",
  slides: "Presentation",
  text: "Text",
  video: "Video",
};

const TYPES: Record<string, string> = {
  aac: "audio/aac",
  avif: "image/avif",
  csv: "text/csv",
  flac: "audio/flac",
  heic: "image/heic",
  heif: "image/heif",
  json: "application/json",
  m4a: "audio/mp4",
  m4v: "video/mp4",
  md: "text/markdown",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  opus: "audio/opus",
  pdf: "application/pdf",
  svg: "image/svg+xml",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  yaml: "text/yaml",
  yml: "text/yaml",
};

/**
 * The file's MIME type, guessed from its extension when the browser didn't
 * know it, so videos and PDFs open in place once decrypted.
 */
export function mimeOf(file: { name: string; type: string }): string {
  return (file.type || TYPES[extensionOf(file.name)] || "").slice(0, MAX_TYPE);
}

export function typeOf(file: File): string {
  return mimeOf(file);
}

/** How the app shows a file, if it can. */
export type Preview = "image" | "video" | "audio" | "pdf" | "text" | "table";

/** Texts read in place up to this size; bigger ones are only downloaded. */
export const MAX_TEXT_PREVIEW = 2 * 1024 * 1024;

export function previewOf(file: DriveFile): Preview | undefined {
  const kind = fileKind(file);
  const extension = extensionOf(file.name);
  if (kind === "image" || kind === "video" || kind === "audio") {
    return kind;
  }
  if (kind === "pdf") {
    return "pdf";
  }
  if (file.size > MAX_TEXT_PREVIEW) {
    return undefined;
  }
  if (extension === "csv" || extension === "tsv") {
    return "table";
  }
  return kind === "code" || kind === "text" ? "text" : undefined;
}

/** "0:42", "12:05" or "1:02:03". */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

// ———————————————————————————————————————— Order

export const SORTS = [
  { label: "Name", value: "name" },
  { label: "Last changed", value: "updated" },
  { label: "Size", value: "size" },
  { label: "Kind", value: "kind" },
] as const;

export type SortKey = (typeof SORTS)[number]["value"];

export interface Sort {
  key: SortKey;
  /** Smallest, oldest or A first. */
  ascending: boolean;
}

export const DEFAULT_SORT: Sort = { ascending: true, key: "name" };

/** Files in the order picked; ties fall back to their names. */
export function sortFiles<T extends DriveFile>(files: T[], sort: Sort): T[] {
  const direction = sort.ascending ? 1 : -1;
  const by = (a: DriveFile, b: DriveFile): number => {
    if (sort.key === "updated") {
      return a.updatedAt - b.updatedAt;
    }
    if (sort.key === "size") {
      return a.size - b.size;
    }
    if (sort.key === "kind") {
      return compareNames(KIND_LABELS[fileKind(a)], KIND_LABELS[fileKind(b)]);
    }
    return 0;
  };
  return files.toSorted(
    (a, b) => direction * (by(a, b) || compareNames(a.name, b.name))
  );
}

/** Folders by name, or by when they changed; by size or kind they're all alike, so A first. */
export function sortFolders<T extends DriveFolder>(
  folders: T[],
  sort: Sort
): T[] {
  const ordered = sort.key === "name" || sort.key === "updated";
  const direction = ordered && !sort.ascending ? -1 : 1;
  return folders.toSorted(
    (a, b) =>
      direction *
      ((sort.key === "updated" ? a.updatedAt - b.updatedAt : 0) ||
        compareNames(a.name, b.name))
  );
}
