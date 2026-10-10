import {
  ClockIcon,
  FolderPlusIcon,
  HardDriveIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { DriveView } from "@/features/drive/drive-context";
import type { Layout } from "@/features/drive/drive-items";
import { FileIcon } from "@/features/drive/file-icon";
import type { DriveFolder } from "@/lib/drive";
import { MAX_DRIVE_FILE_BYTES, TRASH_DAYS } from "@/lib/drive";
import { formatBytes } from "@/lib/utils";

const SIZE_LIMIT = formatBytes(MAX_DRIVE_FILE_BYTES);

/** A few files fanned out, lifting a little as the pointer comes near. */
const FAN = [
  { name: "brief.pdf", rotate: -12, x: -34, y: 6 },
  { name: "photo.jpg", rotate: 0, x: 0, y: -4 },
  { name: "budget.xlsx", rotate: 12, x: 34, y: 6 },
];

/** Where a Drive or folder with nothing in it asks for files. */
function DropHere({
  folder,
  onPick,
  onNewFolder,
}: {
  folder?: DriveFolder;
  onPick: () => void;
  onNewFolder: () => void;
}) {
  return (
    <div className="border-foreground/12 bg-card/50 group/fan flex flex-col items-center gap-5 rounded-3xl border-2 border-dashed px-6 py-14 text-center">
      <div aria-hidden className="relative h-20 w-40">
        {FAN.map((item, index) => (
          <span
            className="absolute top-2 left-1/2 transition-transform duration-500 ease-out"
            key={item.name}
            style={{
              transform: `translateX(calc(-50% + ${item.x}px)) translateY(${item.y}px) rotate(${item.rotate}deg)`,
              transitionDelay: `${index * 40}ms`,
              zIndex: index === 1 ? 1 : 0,
            }}
          >
            <span className="block transition-transform duration-300 ease-out group-hover/fan:-translate-y-1.5">
              <FileIcon file={{ name: item.name, type: "" }} size="lg" />
            </span>
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-medium">
          {folder ? "This folder is empty" : "Drop files here"}
        </h3>
        <p className="text-muted-foreground max-w-sm text-sm">
          Drag files or whole folders from your computer, paste a screenshot, or
          pick them. Up to {SIZE_LIMIT} each; photos, videos and PDFs preview
          right here.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onPick}>
          <UploadIcon />
          Upload files
        </Button>
        <Button onClick={onNewFolder} variant="outline">
          <FolderPlusIcon />
          New folder
        </Button>
      </div>
    </div>
  );
}

function Nothing({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Empty className="bg-muted/50 rounded-3xl py-14">
      {icon}
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription className="max-w-sm">{description}</EmptyDescription>
    </Empty>
  );
}

export function Loading({ layout }: { layout: Layout }) {
  if (layout === "list") {
    return (
      <div aria-busy className="flex flex-col gap-1">
        {["a", "b", "c", "d", "e"].map((row) => (
          <Skeleton className="h-11 rounded-xl" key={row} />
        ))}
      </div>
    );
  }
  return (
    <div
      aria-busy
      className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-3"
    >
      {["a", "b", "c", "d"].map((tile) => (
        <Skeleton className="aspect-[4/3.9] rounded-2xl" key={tile} />
      ))}
    </div>
  );
}

const ICON = "text-muted-foreground size-8";

/** What each view says while it has nothing to list. */
const NOTHING: Record<
  DriveView | "search" | "files",
  { title: string; description: string; icon: ReactNode }
> = {
  files: {
    description: "Files added to this Drive show up here.",
    icon: <HardDriveIcon aria-hidden className={ICON} />,
    title: "No files yet",
  },
  recent: {
    description: "Files you open, and ones anyone adds, show up here.",
    icon: <ClockIcon aria-hidden className={ICON} />,
    title: "Nothing recent",
  },
  search: {
    description: "Try fewer letters, or another word from the name.",
    icon: <SearchIcon aria-hidden className={ICON} />,
    title: "Nothing found",
  },
  starred: {
    description:
      "Star files and folders you come back to, and find them all here.",
    icon: <StarIcon aria-hidden className={ICON} />,
    title: "Nothing starred yet",
  },
  trash: {
    description: `Deleted files and folders wait here for ${TRASH_DAYS} days.`,
    icon: <Trash2Icon aria-hidden className={ICON} />,
    title: "The trash is empty",
  },
};

/**
 * What shows where nothing's listed: placeholders while loading, a place to
 * drop files for those who can add them, or a word on what would be here.
 */
export function EmptyState({
  loading,
  layout,
  kind,
  folder,
  editable,
  onPick,
  onNewFolder,
}: {
  loading: boolean;
  layout: Layout;
  kind: DriveView | "search" | "files";
  folder?: DriveFolder;
  editable: boolean;
  onPick: () => void;
  onNewFolder: () => void;
}) {
  if (loading) {
    return <Loading layout={layout} />;
  }
  if (kind === "files" && editable) {
    return (
      <DropHere folder={folder} onNewFolder={onNewFolder} onPick={onPick} />
    );
  }
  const nothing = NOTHING[kind];
  return (
    <Nothing
      description={nothing.description}
      icon={nothing.icon}
      title={
        kind === "files" && folder ? "This folder is empty" : nothing.title
      }
    />
  );
}
