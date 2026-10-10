import { cn } from "cn";
import { CheckIcon, HardDriveIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Entry } from "@/features/drive/drive-state";
import { entryName, itemsOf, useDrive } from "@/features/drive/drive-state";
import { FolderIcon } from "@/features/drive/file-icon";
import type { DriveFolder } from "@/lib/drive";
import { canMoveInto, pathTo, TOP } from "@/lib/drive";
import { countItems, moveItems } from "@/lib/drive-actions";

const OPTION =
  "hover:bg-accent focus-visible:bg-accent flex h-9 w-full min-w-0 shrink-0 items-center gap-2.5 rounded-lg px-2 text-left text-sm outline-none transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40";

/** Where the entries sit now, when they all sit in the same place. */
function homeOf(entries: Entry[]): string | undefined | null {
  const homes = new Set(
    entries.map((entry) =>
      entry.kind === "folder" ? entry.folder.parent : entry.file.folder
    )
  );
  return homes.size === 1 ? [...homes][0] : null;
}

function Targets({
  entries,
  onDone,
}: {
  entries: Entry[];
  onDone: () => void;
}) {
  const { project, tree } = useDrive();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const items = itemsOf(entries);
  const home = homeOf(entries);
  const folderIds = items.folders.map((folder) => folder.id);
  const allowed = (place: string) => canMoveInto(tree, folderIds, place);

  // Folders in tree order: each followed by the ones inside it.
  const ordered: { folder: DriveFolder; depth: number }[] = [];
  const visit = (place: string, depth: number) => {
    for (const folder of tree.children.get(place) ?? []) {
      if (!allowed(folder.id)) {
        continue;
      }
      ordered.push({ depth, folder });
      visit(folder.id, depth + 1);
    }
  };
  visit(TOP, 0);
  const shown = needle
    ? ordered.filter(({ folder }) => folder.name.toLowerCase().includes(needle))
    : ordered;

  const move = async (folder?: DriveFolder) => {
    onDone();
    if (folder?.id === home) {
      return;
    }
    if (await moveItems(project, items, folder?.id)) {
      toast.success(`Moved ${countItems(items)} to ${folder?.name ?? "Drive"}`);
    }
  };

  return (
    <>
      <Input
        aria-label="Search folders"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog is for picking a folder
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search folders…"
        value={query}
      />
      <div className="-mx-1 flex max-h-80 min-h-0 flex-col gap-0.5 overflow-y-auto px-1">
        {!needle && (
          <button className={OPTION} onClick={() => move()} type="button">
            <HardDriveIcon className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate">Top of the Drive</span>
            {home === undefined && <CheckIcon className="ml-auto size-4" />}
          </button>
        )}
        {shown.map(({ folder, depth }) => (
          <button
            className={OPTION}
            key={folder.id}
            onClick={() => move(folder)}
            style={{
              paddingLeft: `${0.5 + (needle ? 0 : depth + 1) * 1.1}rem`,
            }}
            type="button"
          >
            <FolderIcon folder={folder} size="sm" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{folder.name}</span>
              {needle && pathTo(tree, folder.parent).length > 0 && (
                <span className="text-muted-foreground truncate text-xs">
                  {pathTo(tree, folder.parent)
                    .map((item) => item.name)
                    .join(" / ")}
                </span>
              )}
            </span>
            {folder.id === home && <CheckIcon className="ml-auto size-4" />}
          </button>
        ))}
        {needle && shown.length === 0 && (
          <p className={cn("text-muted-foreground px-2 py-1.5")}>
            No folders found
          </p>
        )}
      </div>
    </>
  );
}

/** Picks where files and folders move: into a folder, or to the top of the Drive. */
export function MoveDialog({
  entries,
  onOpenChange,
}: {
  /** What's moving; the dialog is open while there's something. */
  entries: Entry[] | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const [only] = entries ?? [];
  return (
    <Dialog onOpenChange={onOpenChange} open={entries !== undefined}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Move{" "}
            {only && entries?.length === 1
              ? entryName(only)
              : countItems(itemsOf(entries ?? []))}
          </DialogTitle>
          <DialogDescription>
            Pick a folder. Anything with the same name there gets a number.
          </DialogDescription>
        </DialogHeader>
        {entries && (
          <Targets entries={entries} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
