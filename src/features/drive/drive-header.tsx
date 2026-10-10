import { cn } from "cn";
import {
  ChevronRightIcon,
  ClockIcon,
  EllipsisIcon,
  HardDriveIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";

import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import type { DriveView } from "@/features/drive/drive-context";
import { drivePath } from "@/features/drive/drive-context";
import { useDropInto } from "@/features/drive/drive-dnd";
import { useDrive } from "@/features/drive/drive-state";
import { FolderIcon } from "@/features/drive/file-icon";
import { EntryMenuItems } from "@/features/drive/item-menu";
import type { DriveFile, DriveFolder } from "@/lib/drive";
import { pathTo, TOP, TRASH_DAYS } from "@/lib/drive";
import { setStarred } from "@/lib/drive-actions";
import { formatBytes, plural } from "@/lib/utils";

/** A folder above the one shown, which takes what's dropped on it like the folder itself. */
function Crumb({ folder, label }: { folder?: DriveFolder; label: string }) {
  const { project, tree, canEdit, destination } = useDrive();
  const drop = useDropInto(folder?.id, {
    canEdit,
    destination: destination(folder?.id),
    label,
    project,
    tree,
  });
  return (
    <Link
      className={cn(
        "text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-sm transition-[background-color,color,box-shadow] duration-150 outline-none focus-visible:ring-3",
        drop.over && "bg-primary/15 text-foreground ring-primary ring-2"
      )}
      href={drivePath(project, folder)}
      {...drop.handlers}
    >
      {folder ? (
        <FolderIcon folder={folder} open={drop.over !== undefined} size="sm" />
      ) : (
        <HardDriveIcon aria-hidden className="size-3.5" />
      )}
      <span className="max-w-40 truncate">{label}</span>
    </Link>
  );
}

function Header({
  title,
  icon,
  detail,
  path,
  actions,
}: {
  title: string;
  icon: ReactNode;
  detail?: ReactNode;
  /** The folders above, from the top of the Drive down. */
  path?: DriveFolder[];
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      {path && (
        <nav
          aria-label="Folders above"
          className="-ml-1.5 flex min-w-0 flex-wrap items-center gap-0.5"
        >
          <Crumb label="Drive" />
          {path.map((folder) => (
            <span className="flex min-w-0 items-center gap-0.5" key={folder.id}>
              <ChevronRightIcon
                aria-hidden
                className="text-muted-foreground/60 size-3.5 shrink-0"
              />
              <Crumb folder={folder} label={folder.name} />
            </span>
          ))}
        </nav>
      )}
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-2xl font-semibold tracking-tight">
            {title}
          </h2>
          {detail && (
            <p className="text-muted-foreground truncate text-sm">{detail}</p>
          )}
        </div>
        {actions}
      </div>
    </header>
  );
}

export function SearchHeader({
  query,
  results,
}: {
  query: string;
  /** How many were found, once the search is done. */
  results?: number;
}) {
  return (
    <Header
      detail={results === undefined ? "Searching…" : plural(results, "result")}
      icon={<SearchIcon aria-hidden className="text-muted-foreground size-7" />}
      title={`“${query}”`}
    />
  );
}

const VIEWS: Record<
  DriveView,
  { title: string; icon: ReactNode; detail: string }
> = {
  recent: {
    detail: "What you opened lately, and what anyone added or changed.",
    icon: <ClockIcon aria-hidden className="text-muted-foreground size-7" />,
    title: "Recent",
  },
  starred: {
    detail: "Only you see your stars, in this browser.",
    icon: (
      <StarIcon aria-hidden className="size-7 fill-amber-400 text-amber-400" />
    ),
    title: "Starred",
  },
  trash: {
    detail: `Deleted files and folders stay here for ${TRASH_DAYS} days, then go for good.`,
    icon: <Trash2Icon aria-hidden className="text-muted-foreground size-7" />,
    title: "Trash",
  },
};

export function ViewHeader({
  view,
  onEmptyTrash,
}: {
  view: DriveView;
  /** Offered to members while the trash has something in it. */
  onEmptyTrash?: () => void;
}) {
  const { title, icon, detail } = VIEWS[view];
  return (
    <Header
      actions={
        onEmptyTrash && (
          <Button onClick={onEmptyTrash} size="sm" variant="outline">
            Empty trash
          </Button>
        )
      }
      detail={detail}
      icon={icon}
      title={title}
    />
  );
}

/** "3 folders · 12 files · 240 MB", once the files are in. */
function describe(folders: number, files: DriveFile[] | undefined) {
  if (!files) {
    return;
  }
  const size = files.reduce((sum, file) => sum + file.size, 0);
  const parts = [
    folders > 0 && plural(folders, "folder"),
    files.length > 0 && plural(files.length, "file"),
    size > 0 && formatBytes(size),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Nothing here yet";
}

function FolderActions({ folder }: { folder: DriveFolder }) {
  const { project, pubkey, starred } = useDrive();
  const on = starred(folder.id);
  return (
    <div className="flex items-center gap-0.5">
      <FluidTooltip.Group>
        <IconButton
          aria-pressed={on}
          label={on ? "Remove star" : "Star"}
          onClick={() => setStarred(pubkey, project, [folder.id], !on)}
        >
          <StarIcon className={cn(on && "fill-amber-400 text-amber-400")} />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton label={`More for ${folder.name}`}>
                <EllipsisIcon />
              </IconButton>
            }
          />
          <DropdownMenuContent align="end" className="w-52">
            <EntryMenuItems entries={[{ folder, kind: "folder" }]} />
          </DropdownMenuContent>
        </DropdownMenu>
      </FluidTooltip.Group>
    </div>
  );
}

/** The folder shown, or the top of the Drive: its name, what's above it and how much it holds. */
export function FolderHeader({
  folder,
  files,
}: {
  folder?: DriveFolder;
  /** The files in it, once loaded. */
  files?: DriveFile[];
}) {
  const { tree } = useDrive();
  const folders = tree.children.get(folder?.id ?? TOP)?.length ?? 0;
  return (
    <Header
      actions={folder && <FolderActions folder={folder} />}
      detail={describe(folders, files)}
      icon={
        folder ? (
          <FolderIcon folder={folder} size="lg" />
        ) : (
          <span className="bg-card shadow-surface flex size-11 items-center justify-center rounded-xl">
            <HardDriveIcon aria-hidden className="text-primary size-5" />
          </span>
        )
      }
      path={folder ? pathTo(tree, folder.parent) : undefined}
      title={folder?.name ?? "Drive"}
    />
  );
}
