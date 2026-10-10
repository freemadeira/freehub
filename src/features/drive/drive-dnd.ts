import type { DragEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import type { Entry } from "@/features/drive/drive-state";
import { entryName, itemsOf } from "@/features/drive/drive-state";
import type { DriveTree } from "@/lib/drive";
import { canMoveInto, TOP } from "@/lib/drive";
import { countItems, moveItems } from "@/lib/drive-actions";
import type { Destination } from "@/lib/drive-upload";
import { uploadDropped } from "@/lib/drive-upload";
import type { Project } from "@/lib/project";

/** Marks drags of the Drive's own files and folders, as opposed to files from the computer. */
const DRIVE_DRAG = "application/x-freehub-drive";

/** What's being dragged around the Drive, if anything; drop targets can't read a drag's data until the drop. */
let dragging: { project: string; entries: Entry[] } | undefined;

/** Starts dragging entries, shown as a pill with what's moving. */
export function startItemDrag(
  event: DragEvent,
  project: Project,
  entries: Entry[]
): void {
  dragging = { entries, project: project.address };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(DRIVE_DRAG, project.address);
  const [only] = entries;
  const ghost = document.createElement("div");
  ghost.textContent =
    only && entries.length === 1
      ? entryName(only)
      : countItems(itemsOf(entries));
  ghost.className =
    "bg-primary text-primary-foreground shadow-raised fixed -top-96 left-0 max-w-64 truncate rounded-full px-3 py-1.5 text-sm font-medium";
  document.body.append(ghost);
  event.dataTransfer.setDragImage(ghost, 18, 18);
  // The browser takes its picture of the pill as the drag starts; then it can go.
  setTimeout(() => ghost.remove(), 0);
}

export function endItemDrag(): void {
  dragging = undefined;
}

/** The folder an entry sits in, or undefined at the top of the Drive. */
function homeOf(entry: Entry): string | undefined {
  return entry.kind === "folder" ? entry.folder.parent : entry.file.folder;
}

/** Moves the entries into the folder, saying so once they're there. */
async function moveInto(
  project: Project,
  entries: Entry[],
  folder: string | undefined,
  label: string
): Promise<void> {
  const items = itemsOf(entries);
  if (await moveItems(project, items, folder)) {
    toast.success(`Moved ${countItems(items)} to ${label}`);
  }
}

/** Whether files are being dragged in from the computer. */
export function carriesFiles(event: DragEvent): boolean {
  return !dragging && event.dataTransfer.types.includes("Files");
}

interface DropOptions {
  project: Project;
  tree: DriveTree;
  canEdit: boolean;
  /** Where uploads dropped here go. */
  destination: Destination;
  /** What the target is called, for the toast once something moves there. */
  label: string;
}

/**
 * Makes an element take what's dropped on it into a folder, or the top of
 * the Drive: the Drive's own files and folders move there, files from the
 * computer upload there.
 */
export function useDropInto(
  folder: string | undefined,
  { project, tree, canEdit, destination, label }: DropOptions
) {
  const [over, setOver] = useState<"move" | "upload">();

  const accepts = (event: DragEvent): "move" | "upload" | undefined => {
    if (!canEdit) {
      return undefined;
    }
    if (!dragging) {
      return event.dataTransfer.types.includes("Files") ? "upload" : undefined;
    }
    const { entries } = dragging;
    const { folders } = itemsOf(entries);
    if (
      dragging.project !== project.address ||
      !canMoveInto(
        tree,
        folders.map((item) => item.id),
        folder ?? TOP
      ) ||
      entries.every((entry) => homeOf(entry) === folder)
    ) {
      return undefined;
    }
    return "move";
  };

  const handlers = {
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setOver(undefined);
      }
    },
    onDragOver: (event: DragEvent) => {
      const kind = accepts(event);
      if (!kind) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = kind === "move" ? "move" : "copy";
      if (over !== kind) {
        setOver(kind);
      }
    },
    onDrop: (event: DragEvent) => {
      const kind = accepts(event);
      setOver(undefined);
      if (!kind) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (kind === "move" && dragging) {
        const { entries } = dragging;
        endItemDrag();
        moveInto(project, entries, folder, label);
        return;
      }
      uploadDropped(event.dataTransfer, destination);
    },
  };
  return { handlers, over };
}
