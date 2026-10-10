import type { DriveView } from "@/features/drive/drive-context";
import type { Entry } from "@/features/drive/drive-state";
import type { DriveContent, DriveFile, DriveFolder, Sort } from "@/lib/drive";
import { sortFiles, sortFolders, TOP } from "@/lib/drive";
import type { DriveMarks } from "@/lib/drive-marks";

/** Recent files listed. */
const RECENT = 30;
const SEARCH_RESULTS = 50;
const DIACRITICS = /\p{Diacritic}/gu;

const NO_FOLDERS: DriveFolder[] = [];
const NO_FILES: DriveFile[] = [];

function fileEntry(file: DriveFile): Entry {
  return { file, kind: "file" };
}

function folderEntry(folder: DriveFolder): Entry {
  return { folder, kind: "folder" };
}

/** Folders, then files, each in the order picked. */
function listed(
  folders: DriveFolder[],
  files: DriveFile[],
  sort: Sort
): Entry[] {
  return [
    ...sortFolders(folders, sort).map(folderEntry),
    ...sortFiles(files, sort).map(fileEntry),
  ];
}

function trashed(content: DriveContent, sort: Sort): Entry[] {
  return [
    ...sortFolders(content.trash.folders, sort).map((folder): Entry => ({
      folder,
      kind: "folder",
      trashed: folder.trashed,
    })),
    ...sortFiles(content.trash.files, sort).map((file): Entry => ({
      file,
      kind: "file",
      trashed: file.trashed,
    })),
  ];
}

/**
 * Files the person opened lately, and ones uploaded, renamed or moved lately
 * by anyone, newest first.
 */
export function recentFiles(
  content: DriveContent,
  marks: DriveMarks
): DriveFile[] {
  const found = new Map<string, { file: DriveFile; at: number }>();
  for (const file of content.files
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENT * 2)) {
    found.set(file.id, { at: file.updatedAt, file });
  }
  for (const open of marks.opens) {
    const file = content.fileById.get(open.id);
    if (file) {
      found.set(file.id, { at: Math.max(file.updatedAt, open.at), file });
    }
  }
  return [...found.values()]
    .toSorted((a, b) => b.at - a.at)
    .slice(0, RECENT)
    .map(({ file }) => file);
}

/** A name as searches compare it: no case, no accents. */
function plain(text: string): string {
  return text.normalize("NFD").replace(DIACRITICS, "").toLowerCase();
}

/** Whether the name has every word searched for. */
function matches(name: string, words: string[]): boolean {
  const haystack = plain(name);
  return words.every((word) => haystack.includes(word));
}

export interface DriveEntries {
  entries: Entry[];
  loading: boolean;
  /** How much each folder listed holds, while browsing folders. */
  counts?: Map<string, number>;
  /** The files of the folder shown, while browsing folders. */
  folderFiles?: DriveFile[];
  /** How many a search found, once it's done. */
  results?: number;
}

/** What the Drive lists: a folder's contents, a search across it, recent or starred files, or the trash. */
export function driveEntries({
  content,
  loaded,
  folder,
  view,
  query,
  sort,
  marks,
}: {
  content: DriveContent;
  /** Whether every relay has sent what it holds. */
  loaded: boolean;
  folder?: string;
  view?: DriveView;
  /** Text searched for across the Drive; empty when not searching. */
  query: string;
  sort: Sort;
  marks: DriveMarks;
}): DriveEntries {
  const loading = !loaded;
  if (query) {
    const words = plain(query).split(/\s+/u).filter(Boolean);
    const entries = listed(
      content.tree.folders.filter((item) => matches(item.name, words)),
      content.files
        .filter((file) => matches(file.name, words))
        .slice(0, SEARCH_RESULTS),
      sort
    );
    return { entries, loading, results: loading ? undefined : entries.length };
  }
  switch (view) {
    case "recent": {
      return {
        entries: recentFiles(content, marks).map(fileEntry),
        loading,
      };
    }
    case "starred": {
      return {
        entries: listed(
          content.tree.folders.filter((item) => marks.stars.has(item.id)),
          content.files.filter((file) => marks.stars.has(file.id)),
          sort
        ),
        loading,
      };
    }
    case "trash": {
      return { entries: trashed(content, sort), loading };
    }
    default: {
      const files = content.filesIn.get(folder ?? TOP) ?? NO_FILES;
      return {
        counts: content.counts,
        entries: listed(
          content.tree.children.get(folder ?? TOP) ?? NO_FOLDERS,
          files,
          sort
        ),
        folderFiles: files,
        loading,
      };
    }
  }
}
