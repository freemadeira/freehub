import { createContext, use } from "react";

import type {
  DriveContent,
  DriveFile,
  DriveFolder,
  DriveTree,
  Trashed,
} from "@/lib/drive";
import type { Items } from "@/lib/drive-actions";
import type { Destination } from "@/lib/drive-upload";
import type { Project } from "@/lib/project";

/** Something listed in the Drive: a folder or a file, trashed ones with when and by whom. */
export type Entry =
  | { kind: "folder"; folder: DriveFolder; trashed?: Trashed }
  | { kind: "file"; file: DriveFile; trashed?: Trashed };

export function entryId(entry: Entry): string {
  return entry.kind === "folder" ? entry.folder.id : entry.file.id;
}

export function entryName(entry: Entry): string {
  return entry.kind === "folder" ? entry.folder.name : entry.file.name;
}

/** The entries as files and folders apart, as the actions take them. */
export function itemsOf(entries: readonly Entry[]): Items {
  return {
    files: entries.flatMap((entry) =>
      entry.kind === "file" ? [entry.file] : []
    ),
    folders: entries.flatMap((entry) =>
      entry.kind === "folder" ? [entry.folder] : []
    ),
  };
}

/** What the listing does to its entries, which the page carries out. */
export interface DriveActions {
  open: (entry: Entry) => void;
  rename: (entry: Entry) => void;
  move: (entries: Entry[]) => void;
  style: (folder: DriveFolder) => void;
  star: (entries: Entry[], starred: boolean) => void;
  trash: (entries: Entry[]) => void;
  download: (files: DriveFile[]) => void;
  copyLink: (entry: Entry) => void;
  restore: (entries: Entry[]) => void;
  purge: (entries: Entry[]) => void;
  newFolder: () => void;
  pickFiles: () => void;
}

export interface DriveContextValue {
  project: Project;
  content: DriveContent;
  /** The folders out of the trash, as `content` has them. */
  tree: DriveTree;
  /** The signed-in person. */
  pubkey: string;
  /** Whether the person may add to the Drive and change what's in it: any member can, viewers can't. */
  canEdit: boolean;
  starred: (id: string) => boolean;
  /** Where uploads into the folder go. */
  destination: (folder?: string) => Destination;
  actions: DriveActions;
}

export const DriveContext = createContext<DriveContextValue | null>(null);

export function useDrive(): DriveContextValue {
  const value = use(DriveContext);
  if (!value) {
    throw new Error("useDrive needs a DriveContext provider.");
  }
  return value;
}
