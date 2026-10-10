import {
  CornerUpRightIcon,
  DownloadIcon,
  EyeIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  InfoIcon,
  LinkIcon,
  PaletteIcon,
  PencilIcon,
  RotateCcwIcon,
  StarIcon,
  StarOffIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { Entry } from "@/features/drive/drive-state";
import { entryId, useDrive } from "@/features/drive/drive-state";
import { previewOf } from "@/lib/drive";

/** What trashed entries offer: coming back, or going for good. */
function TrashedItems({ entries }: { entries: Entry[] }) {
  const { actions, canEdit } = useDrive();
  if (!canEdit) {
    return (
      <DropdownMenuItem disabled>You can only view this Drive</DropdownMenuItem>
    );
  }
  return (
    <>
      <DropdownMenuItem onClick={() => actions.restore(entries)}>
        <RotateCcwIcon />
        Restore
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => actions.purge(entries)}
        variant="destructive"
      >
        <Trash2Icon />
        Delete forever
      </DropdownMenuItem>
    </>
  );
}

/** Opening one entry: a folder to go into, a file to preview, or to see the details of. */
function OpenItem({ entry }: { entry: Entry }) {
  const { actions } = useDrive();
  if (entry.kind === "folder") {
    return (
      <DropdownMenuItem onClick={() => actions.open(entry)}>
        <FolderOpenIcon />
        Open
      </DropdownMenuItem>
    );
  }
  const previews = previewOf(entry.file) !== undefined;
  return (
    <DropdownMenuItem onClick={() => actions.open(entry)}>
      {previews ? <EyeIcon /> : <InfoIcon />}
      {previews ? "Preview" : "Details"}
    </DropdownMenuItem>
  );
}

/** Changing entries, for those who can edit: renaming one, styling a folder, moving any. */
function EditItems({ entries }: { entries: Entry[] }) {
  const { actions } = useDrive();
  const [only] = entries;
  const single = entries.length === 1 ? only : undefined;
  return (
    <>
      <DropdownMenuSeparator />
      {single && (
        <DropdownMenuItem onClick={() => actions.rename(single)}>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
      )}
      {single?.kind === "folder" && (
        <DropdownMenuItem onClick={() => actions.style(single.folder)}>
          <PaletteIcon />
          Color and emoji…
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => actions.move(entries)}>
        <CornerUpRightIcon />
        Move to…
      </DropdownMenuItem>
    </>
  );
}

/**
 * What can be done to entries, for their ⋯ menu and right-click: one entry or
 * several at once. Trashed ones can only come back or go for good.
 */
export function EntryMenuItems({ entries }: { entries: Entry[] }) {
  const drive = useDrive();
  const { actions } = drive;
  const [only] = entries;
  if (!only) {
    return null;
  }
  if (only.trashed) {
    return <TrashedItems entries={entries} />;
  }
  const single = entries.length === 1 ? only : undefined;
  const files = entries.flatMap((entry) =>
    entry.kind === "file" ? [entry.file] : []
  );
  const allStarred = entries.every((entry) => drive.starred(entryId(entry)));
  return (
    <>
      {single && <OpenItem entry={single} />}
      {files.length === entries.length && (
        <DropdownMenuItem onClick={() => actions.download(files)}>
          <DownloadIcon />
          Download
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => actions.star(entries, !allStarred)}>
        {allStarred ? <StarOffIcon /> : <StarIcon />}
        {allStarred ? "Remove star" : "Star"}
      </DropdownMenuItem>
      {single && (
        <DropdownMenuItem onClick={() => actions.copyLink(single)}>
          <LinkIcon />
          Copy link
        </DropdownMenuItem>
      )}
      {drive.canEdit && <EditItems entries={entries} />}
      {drive.canEdit && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => actions.trash(entries)}
            variant="destructive"
          >
            <Trash2Icon />
            Move to trash
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

/** What right-clicking the empty space of a folder offers. */
export function BackgroundMenuItems() {
  const { actions, canEdit } = useDrive();
  if (!canEdit) {
    return (
      <DropdownMenuItem disabled>You can only view this Drive</DropdownMenuItem>
    );
  }
  return (
    <>
      <DropdownMenuItem onClick={() => actions.newFolder()}>
        <FolderPlusIcon />
        New folder
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => actions.pickFiles()}>
        <UploadIcon />
        Upload files
      </DropdownMenuItem>
    </>
  );
}
