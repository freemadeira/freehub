import { cn } from "cn";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  EllipsisIcon,
  PlayIcon,
  StarIcon,
} from "lucide-react";
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import {
  endItemDrag,
  startItemDrag,
  useDropInto,
} from "@/features/drive/drive-dnd";
import type { Entry } from "@/features/drive/drive-state";
import { entryId, entryName, useDrive } from "@/features/drive/drive-state";
import { FileIcon, FolderIcon, kindTint } from "@/features/drive/file-icon";
import {
  BackgroundMenuItems,
  EntryMenuItems,
} from "@/features/drive/item-menu";
import { useProfile } from "@/hooks/use-profile";
import type { DriveFile, Sort, SortKey } from "@/lib/drive";
import {
  fileKind,
  formatDuration,
  splitName,
  TRASH_SECONDS,
} from "@/lib/drive";
import { renameFile, updateFolder } from "@/lib/drive-actions";
import { fileSource, thumbSource, useOpened } from "@/lib/drive-files";
import { formatBytes, plural } from "@/lib/utils";

export type Layout = "grid" | "list";

const TOUCH =
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

function ago(at: number): string {
  return Date.now() - at < 60_000
    ? "Just now"
    : formatDistanceToNowStrict(at, { addSuffix: true });
}

/** When something happened, from its time in seconds. */
function Ago({ at }: { at: number }) {
  const ms = at * 1000;
  return (
    <time dateTime={new Date(ms).toISOString()} title={format(ms, "PPpp")}>
      {ago(ms)}
    </time>
  );
}

/** How long until the trash deletes it for good, from when it went in, in seconds. */
function purgeIn(at: number): string {
  const days = Math.max(
    0,
    Math.ceil(((at + TRASH_SECONDS) * 1000 - Date.now()) / 86_400_000)
  );
  return days <= 1 ? "Deleted for good within a day" : `${days} days left`;
}

// ———————————————————————————————————————— Pictures

/** Images this small show as they are when they have no thumbnail. */
const MAX_OWN_PICTURE = 1024 * 1024;

/** Whether the element has come near the screen: pictures are fetched and opened only then. */
function useNearScreen(): [(node: HTMLElement | null) => void, boolean] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!node || near) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNear(true);
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, near]);
  return [setNode, near];
}

/** The picture of a file on its tile: its thumbnail, the image itself, or its icon on its kind's tint. */
export function FileVisual({
  file,
  className,
  compact = false,
}: {
  file: DriveFile;
  className?: string;
  /** A small square, as in list rows. */
  compact?: boolean;
}) {
  const kind = fileKind(file);
  const [ref, near] = useNearScreen();
  const picture =
    thumbSource(file) ??
    (kind === "image" && file.size <= MAX_OWN_PICTURE
      ? fileSource(file)
      : undefined);
  const { url, error } = useOpened(near ? picture : undefined);
  // Some images, like HEIC photos, won't show in every browser.
  const [broken, setBroken] = useState(false);
  if (picture && !broken && !error) {
    const page = kind === "pdf" && !compact;
    return (
      <span
        className={cn(
          "bg-muted relative block overflow-hidden",
          page && kindTint(file),
          className
        )}
        ref={ref}
      >
        {url && (
          <img
            alt=""
            className={cn(
              "animate-in fade-in-0 object-cover duration-200",
              // A PDF's first page peeks up from the bottom, like a sheet of paper.
              page
                ? "shadow-surface absolute inset-x-[12%] top-[10%] h-full w-[76%] rounded-t-md bg-white object-top"
                : "size-full"
            )}
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
            src={url}
          />
        )}
        {kind === "video" && !compact && (
          <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[0.6875rem] font-medium text-white tabular-nums backdrop-blur-sm">
            <PlayIcon aria-hidden className="size-2.5 fill-current" />
            {file.duration ? formatDuration(file.duration) : "Video"}
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "relative flex items-center justify-center",
        kindTint(file),
        className
      )}
      ref={ref}
    >
      <FileIcon file={file} size={compact ? "sm" : "lg"} />
      {!compact && file.duration && (
        <span className="text-muted-foreground absolute right-2 bottom-2 text-[0.6875rem] font-medium tabular-nums">
          {formatDuration(file.duration)}
        </span>
      )}
    </span>
  );
}

// ———————————————————————————————————————— Renaming

/** The entry's name as a field, its extension left out of the selection like on a desktop. */
function RenameField({
  entry,
  onDone,
  className,
}: {
  entry: Entry;
  onDone: () => void;
  className?: string;
}) {
  const { project } = useDrive();
  const name = entryName(entry);
  const [value, setValue] = useState(name);
  const field = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    const input = field.current;
    if (!input) {
      return;
    }
    input.focus();
    const end = entry.kind === "file" ? splitName(name)[0].length : name.length;
    input.setSelectionRange(0, end);
  }, [entry.kind, name]);

  const commit = () => {
    if (finished.current) {
      return;
    }
    finished.current = true;
    const next = value.trim();
    if (next && next !== name) {
      if (entry.kind === "file") {
        renameFile(project, entry.file, next);
      } else {
        updateFolder(project, entry.folder, { name: next });
      }
    }
    onDone();
  };

  return (
    <input
      aria-label={`Rename ${name}`}
      className={cn(
        "bg-card ring-primary min-w-0 flex-1 rounded-md px-1.5 py-0.5 text-sm font-medium ring-2 outline-none",
        className
      )}
      onBlur={commit}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          finished.current = true;
          onDone();
        }
      }}
      ref={field}
      spellCheck={false}
      value={value}
    />
  );
}

// ———————————————————————————————————————— Tiles and rows

/** An entry's name. Double-clicking it renames, as on a desktop; anywhere else on the tile opens. */
function Name({ entry, className }: { entry: Entry; className?: string }) {
  const { actions, canEdit } = useDrive();
  const name = entryName(entry);
  const renamable = canEdit && !entry.trashed;
  return (
    <span
      className={cn(
        "text-sm font-medium",
        renamable && "cursor-text",
        className
      )}
      onDoubleClick={(event) => {
        if (renamable) {
          event.stopPropagation();
          actions.rename(entry);
        }
      }}
      title={name}
    >
      {name}
    </span>
  );
}

/** The keys held while picking: ⌘ or Ctrl adds, Shift takes a range. */
type Modifiers = Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey">;

interface ItemProps {
  entry: Entry;
  selected: boolean;
  /** The one that takes focus as the listing is tabbed into. */
  focusable: boolean;
  renaming: boolean;
  onRenameEnd: () => void;
  onSelect: (entry: Entry, modifiers: Modifiers) => void;
  onOpen: (entry: Entry) => void;
  /** What a drag that starts here carries: the selection, if this is in it. */
  dragEntries: (entry: Entry) => Entry[];
  /** For files elsewhere than the folder shown, like in search: where they are. */
  showLocation: boolean;
  /** Folders' contents, counted up to a cap. */
  count?: number;
  /** Just uploaded, so it eases in. */
  fresh: boolean;
}

/** What tiles and rows share: selecting, opening, dragging, and dropping into folders. */
function useItem(props: ItemProps) {
  const drive = useDrive();
  const { entry, onSelect, onOpen, dragEntries, renaming } = props;
  const folderId = entry.kind === "folder" ? entry.folder.id : undefined;
  const drop = useDropInto(folderId, {
    canEdit: drive.canEdit && entry.kind === "folder" && !entry.trashed,
    destination: drive.destination(folderId),
    label: entryName(entry),
    project: drive.project,
    tree: drive.tree,
  });
  const draggable = drive.canEdit && !entry.trashed && !renaming;
  return {
    attributes: {
      "aria-selected": props.selected,
      "data-entry": entryId(entry),
      draggable,
      onClick: (event: MouseEvent) => {
        event.stopPropagation();
        onSelect(entry, event);
      },
      onDoubleClick: () => onOpen(entry),
      onDragEnd: endItemDrag,
      onDragStart: (event: DragEvent) =>
        startItemDrag(event, drive.project, dragEntries(entry)),
      role: "option" as const,
      tabIndex: props.focusable ? 0 : -1,
      ...(entry.kind === "folder" ? drop.handlers : {}),
    },
    drive,
    over: drop.over,
  };
}

/** A round check in a tile's corner: how touch screens pick several, and a mark of what's picked. */
function SelectMark({
  selected,
  entry,
  onSelect,
  className,
}: {
  selected: boolean;
  entry: Entry;
  onSelect: ItemProps["onSelect"];
  className?: string;
}) {
  return (
    <button
      aria-label={`${selected ? "Unselect" : "Select"} ${entryName(entry)}`}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full ring-1 transition-[opacity,background-color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-3",
        selected
          ? "bg-primary text-primary-foreground ring-primary"
          : "bg-card/90 ring-foreground/25 text-transparent opacity-0 backdrop-blur-sm group-hover/item:opacity-100 group-has-[[aria-selected=true]]/listing:opacity-100 pointer-coarse:opacity-100",
        className
      )}
      onClick={(event) => {
        event.stopPropagation();
        // Like holding ⌘: adds to what's picked instead of replacing it.
        onSelect(entry, {
          ctrlKey: false,
          metaKey: true,
          shiftKey: event.shiftKey,
        });
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      tabIndex={-1}
      type="button"
    >
      <CheckIcon aria-hidden className="size-3" strokeWidth={3} />
    </button>
  );
}

function MoreButton({
  entry,
  className,
}: {
  entry: Entry;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`More for ${entryName(entry)}`}
        className={cn(
          "text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-ring/50 aria-expanded:bg-foreground/5 flex size-7 shrink-0 items-center justify-center rounded-lg opacity-0 transition-[opacity,background-color,color] duration-150 outline-none group-hover/item:opacity-100 group-focus-visible/item:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 aria-expanded:opacity-100 pointer-coarse:opacity-100",
          className
        )}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <EllipsisIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <EntryMenuItems entries={[entry]} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Star({ id }: { id: string }) {
  const { starred } = useDrive();
  if (!starred(id)) {
    return null;
  }
  return (
    <StarIcon
      aria-label="Starred"
      className="size-3.5 shrink-0 fill-amber-400 text-amber-400"
    />
  );
}

function folderCount(count: number | undefined): string | undefined {
  if (count === undefined) {
    return undefined;
  }
  if (count === 0) {
    return "Empty";
  }
  return plural(count, "item");
}

function Location({ folderId }: { folderId?: string }) {
  const { tree } = useDrive();
  const folder = folderId ? tree.byId.get(folderId) : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <FolderIcon folder={folder} size="sm" />
      <span className="truncate">{folder?.name ?? "Drive"}</span>
    </span>
  );
}

const TILE =
  "group/item focus-visible:ring-ring/50 relative flex min-w-0 cursor-default rounded-2xl outline-none transition-[background-color,box-shadow,scale,opacity] duration-150 ease-out select-none focus-visible:ring-3";
const PICKED = "bg-primary/6 ring-primary/70 ring-2 dark:bg-primary/12";
const FRESH = "animate-in fade-in-0 zoom-in-95 duration-300 ease-out";

function FolderTile(props: ItemProps) {
  const { entry, selected, renaming, onRenameEnd, onSelect } = props;
  const { attributes, over } = useItem(props);
  if (entry.kind !== "folder") {
    return null;
  }
  const { folder } = entry;
  return (
    <div
      {...attributes}
      className={cn(
        TILE,
        "bg-card shadow-surface hover:shadow-raised items-center gap-3 p-3 pr-1.5",
        selected && PICKED,
        over && "bg-primary/10 ring-primary scale-[1.02] ring-2",
        props.fresh && FRESH
      )}
    >
      <span className="relative">
        <FolderIcon folder={folder} open={over !== undefined} size="lg" />
        <SelectMark
          className="absolute -top-1.5 -left-1.5"
          entry={entry}
          onSelect={onSelect}
          selected={selected}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          {renaming ? (
            <RenameField entry={entry} onDone={onRenameEnd} />
          ) : (
            <Name className="truncate" entry={entry} />
          )}
          <Star id={folder.id} />
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {entry.trashed
            ? purgeIn(entry.trashed.at)
            : (folderCount(props.count) ?? <Ago at={folder.updatedAt} />)}
        </span>
      </span>
      <MoreButton entry={entry} />
    </div>
  );
}

function FileTile(props: ItemProps) {
  const { entry, selected, renaming, onRenameEnd, onSelect } = props;
  const { attributes } = useItem(props);
  if (entry.kind !== "file") {
    return null;
  }
  const { file } = entry;
  return (
    <div
      {...attributes}
      className={cn(
        TILE,
        "bg-card shadow-surface hover:shadow-raised flex-col p-1.5",
        selected && PICKED,
        props.fresh && FRESH
      )}
    >
      <span className="relative">
        <FileVisual
          className="image-outline aspect-4/3 w-full rounded-xl"
          file={file}
        />
        <SelectMark
          className="absolute top-2 left-2"
          entry={entry}
          onSelect={onSelect}
          selected={selected}
        />
      </span>
      <span className="flex min-w-0 items-center gap-1.5 pt-2 pl-1.5">
        <FileIcon file={file} size="sm" />
        {renaming ? (
          <RenameField entry={entry} onDone={onRenameEnd} />
        ) : (
          <Name className="min-w-0 flex-1 truncate" entry={entry} />
        )}
        <Star id={file.id} />
        <MoreButton entry={entry} />
      </span>
      <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 px-1.5 pb-1 text-xs">
        {props.showLocation ? (
          <Location folderId={file.folder} />
        ) : (
          <span className="truncate">
            {formatBytes(file.size)} ·{" "}
            {entry.trashed ? (
              purgeIn(entry.trashed.at)
            ) : (
              <Ago at={file.updatedAt} />
            )}
          </span>
        )}
        <UserAvatar
          aria-hidden
          className="ml-auto shrink-0"
          size="xs"
          pubkey={entry.trashed?.by ?? file.creator}
        />
      </span>
    </div>
  );
}

function Person({ pubkey }: { pubkey: string }) {
  const { name } = useProfile(pubkey);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar aria-hidden pubkey={pubkey} size="xs" />
      <span className="truncate">{name}</span>
    </span>
  );
}

const ROW_COLUMNS =
  "grid-cols-[minmax(0,1fr)_2rem] sm:grid-cols-[minmax(0,1fr)_9rem_8rem_5rem_2rem] lg:grid-cols-[minmax(0,1fr)_11rem_9rem_6rem_2rem]";

function Row(props: ItemProps) {
  const { entry, selected, renaming, onRenameEnd, onSelect } = props;
  const { attributes, over } = useItem(props);
  const updatedAt =
    entry.kind === "folder" ? entry.folder.updatedAt : entry.file.updatedAt;
  const person =
    entry.trashed?.by ??
    (entry.kind === "folder"
      ? (entry.folder.creator ?? entry.folder.author)
      : entry.file.creator);
  let size: ReactNode = folderCount(props.count) ?? "—";
  if (entry.kind === "file") {
    size = formatBytes(entry.file.size);
  }
  return (
    <div
      {...attributes}
      className={cn(
        TILE,
        "hover:bg-foreground/4 grid items-center gap-3 rounded-xl py-1.5 pr-1 pl-2",
        ROW_COLUMNS,
        selected && PICKED,
        over && "bg-primary/10 ring-primary ring-2",
        props.fresh && FRESH
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <SelectMark entry={entry} onSelect={onSelect} selected={selected} />
        {entry.kind === "folder" ? (
          <span className="flex size-8 shrink-0 items-center justify-center">
            <FolderIcon folder={entry.folder} open={over !== undefined} />
          </span>
        ) : (
          <FileVisual
            className="image-outline size-8 shrink-0 rounded-lg"
            compact
            file={entry.file}
          />
        )}
        {renaming ? (
          <RenameField entry={entry} onDone={onRenameEnd} />
        ) : (
          <span className="flex min-w-0 flex-col">
            <Name className="truncate" entry={entry} />
            {props.showLocation && entry.kind === "file" && (
              <span className="text-muted-foreground text-xs">
                <Location folderId={entry.file.folder} />
              </span>
            )}
          </span>
        )}
        <Star id={entryId(entry)} />
      </span>
      <span className="text-muted-foreground hidden min-w-0 text-sm sm:block">
        <Person pubkey={person} />
      </span>
      <span className="text-muted-foreground hidden truncate text-sm sm:block">
        {entry.trashed ? purgeIn(entry.trashed.at) : <Ago at={updatedAt} />}
      </span>
      <span className="text-muted-foreground hidden text-right text-sm tabular-nums sm:block">
        {size}
      </span>
      <MoreButton entry={entry} />
    </div>
  );
}

function SortHeader({
  sort,
  onSortChange,
  trash,
}: {
  sort: Sort;
  onSortChange: (sort: Sort) => void;
  trash: boolean;
}) {
  const column = (key: SortKey, label: string, className?: string) => {
    const active = sort.key === key;
    const Arrow = sort.ascending ? ArrowUpIcon : ArrowDownIcon;
    return (
      <button
        className={cn(
          "hover:text-foreground focus-visible:ring-ring/50 flex items-center gap-1 rounded-md outline-none focus-visible:ring-3",
          active && "text-foreground",
          className
        )}
        onClick={() =>
          onSortChange({
            ascending: active ? !sort.ascending : key === "name",
            key,
          })
        }
        type="button"
      >
        {label}
        {active && <Arrow aria-hidden className="size-3" />}
      </button>
    );
  };
  return (
    <div
      className={cn(
        "text-muted-foreground grid items-center gap-3 px-2 pb-1 text-xs font-medium",
        ROW_COLUMNS
      )}
    >
      {column("name", "Name", "pl-8")}
      <span className="hidden sm:block">
        {trash ? "Deleted by" : "Added by"}
      </span>
      {column("updated", trash ? "Time left" : "Changed", "hidden sm:flex")}
      {column("size", "Size", "hidden justify-self-end sm:flex")}
      <span />
    </div>
  );
}

// ———————————————————————————————————————— The listing

/** The entry nearest the one given in the direction of the key, by where they sit on screen. */
function neighbour(
  container: HTMLElement,
  fromId: string | undefined,
  key: string
): string | undefined {
  const nodes = [...container.querySelectorAll<HTMLElement>("[data-entry]")];
  const index = nodes.findIndex((node) => node.dataset.entry === fromId);
  const at = (position: number) => nodes[position]?.dataset.entry;
  if (index === -1 || key === "Home") {
    return at(0);
  }
  if (key === "End") {
    return at(nodes.length - 1);
  }
  if (key === "ArrowLeft") {
    return at(index - 1);
  }
  if (key === "ArrowRight") {
    return at(index + 1);
  }
  const from = nodes[index]?.getBoundingClientRect();
  if (!from) {
    return undefined;
  }
  const down = key === "ArrowDown";
  const rects = nodes.map((node) => node.getBoundingClientRect());
  const candidates = nodes
    .map((node, position) => ({ node, rect: rects[position] }))
    .filter(({ rect }) =>
      rect && down
        ? rect.top >= from.bottom - 2
        : rect && rect.bottom <= from.top + 2
    );
  const tops = candidates.map(({ rect }) => rect?.top ?? 0);
  const rowTop = down ? Math.min(...tops) : Math.max(...tops);
  const middle = from.left + from.width / 2;
  return candidates
    .filter(({ rect }) => Math.abs((rect?.top ?? 0) - rowTop) < 4)
    .toSorted(
      (a, b) =>
        Math.abs((a.rect?.left ?? 0) + (a.rect?.width ?? 0) / 2 - middle) -
        Math.abs((b.rect?.left ?? 0) + (b.rect?.width ?? 0) / 2 - middle)
    )[0]?.node.dataset.entry;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-muted-foreground px-1 text-xs font-medium tracking-wide uppercase">
      {children}
    </h3>
  );
}

const NAV_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
]);

export interface ListingProps {
  /** Folders first, then files, in the order shown. */
  entries: Entry[];
  layout: Layout;
  selection: ReadonlySet<string>;
  onSelectionChange: (next: Set<string>) => void;
  renaming?: string;
  onRename: (id: string) => void;
  onRenameEnd: () => void;
  counts?: ReadonlyMap<string, number>;
  showLocation?: boolean;
  sort: Sort;
  onSortChange: (sort: Sort) => void;
  /** Shown in place of the entries when there are none. */
  empty?: ReactNode;
}

/**
 * Folders and files as tiles or rows, picked like on a desktop: click, ⌘ or
 * Ctrl to add, Shift for a range, arrows to move, Enter to open, F2 to
 * rename, Delete to trash. Right-click for what can be done.
 */
export function Listing({
  entries,
  layout,
  selection,
  onSelectionChange,
  renaming,
  onRename,
  onRenameEnd,
  counts,
  showLocation = false,
  sort,
  onSortChange,
  empty,
}: ListingProps) {
  const drive = useDrive();
  const { actions } = drive;
  const container = useRef<HTMLDivElement>(null);
  // The entry a Shift-click range starts from; empty before any is picked.
  const anchor = useRef("");
  const [focused, setFocused] = useState<string>();
  const [menuFor, setMenuFor] = useState<Entry[]>();
  // oxlint-disable-next-line react/hook-use-state -- read once, never set
  const [mounted] = useState(() => Date.now());
  const ids = entries.map(entryId);
  const byId = new Map(entries.map((entry) => [entryId(entry), entry]));
  const picked = entries.filter((entry) => selection.has(entryId(entry)));
  const focusId = focused && byId.has(focused) ? focused : ids[0];
  const trash = entries.some((entry) => entry.trashed);

  const focus = (id: string | undefined) => {
    if (!id) {
      return;
    }
    setFocused(id);
    const node = container.current?.querySelector<HTMLElement>(
      `[data-entry="${id}"]`
    );
    node?.focus({ preventScroll: true });
    node?.scrollIntoView({ block: "nearest" });
  };

  const select = (entry: Entry, event: Modifiers) => {
    const id = entryId(entry);
    setFocused(id);
    if (TOUCH && selection.size === 0 && !event.metaKey) {
      actions.open(entry);
      return;
    }
    if (event.shiftKey && anchor.current && byId.has(anchor.current)) {
      const from = ids.indexOf(anchor.current);
      const to = ids.indexOf(id);
      const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
      onSelectionChange(
        new Set([
          ...(event.metaKey || event.ctrlKey ? selection : []),
          ...range,
        ])
      );
      return;
    }
    anchor.current = id;
    if (event.metaKey || event.ctrlKey || TOUCH) {
      const next = new Set(selection);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      onSelectionChange(next);
      return;
    }
    onSelectionChange(new Set([id]));
  };

  const dragEntries = (entry: Entry): Entry[] => {
    const id = entryId(entry);
    if (selection.has(id)) {
      return picked;
    }
    onSelectionChange(new Set([id]));
    return [entry];
  };

  const moveFocus = (event: KeyboardEvent) => {
    const next = container.current
      ? neighbour(container.current, focusId, event.key)
      : undefined;
    const nextEntry = next ? byId.get(next) : undefined;
    if (!(next && nextEntry)) {
      return;
    }
    focus(next);
    // With ⌘ or Ctrl held, focus moves on its own, to pick with Space.
    if (!(event.metaKey || event.ctrlKey)) {
      select(nextEntry, {
        ctrlKey: false,
        metaKey: false,
        shiftKey: event.shiftKey,
      });
    }
  };

  const trashPicked = () => {
    if (picked.length === 0 || trash || !drive.canEdit) {
      return false;
    }
    actions.trash(picked);
    return true;
  };

  /** Each key's shortcut, on the entry with focus; each says whether it did anything. */
  const shortcuts: Record<
    string,
    (current: Entry | undefined, mod: boolean) => boolean
  > = {
    " ": (current) => {
      if (!current) {
        return false;
      }
      if (current.kind === "file") {
        actions.open(current);
      } else {
        select(current, { ctrlKey: true, metaKey: true, shiftKey: false });
      }
      return true;
    },
    Backspace: trashPicked,
    Delete: trashPicked,
    Enter: (current) => {
      if (current) {
        actions.open(current);
      }
      return current !== undefined;
    },
    Escape: () => {
      if (selection.size === 0) {
        return false;
      }
      onSelectionChange(new Set());
      return true;
    },
    F2: (current) => {
      if (!(current && drive.canEdit && !current.trashed)) {
        return false;
      }
      onRename(entryId(current));
      return true;
    },
    a: (_current, mod) => {
      if (mod) {
        onSelectionChange(new Set(ids));
      }
      return mod;
    },
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (renaming) {
      return;
    }
    if (NAV_KEYS.has(event.key)) {
      event.preventDefault();
      moveFocus(event);
      return;
    }
    const shortcut = shortcuts[event.key];
    const current = focusId ? byId.get(focusId) : undefined;
    if (shortcut?.(current, event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const itemProps = (entry: Entry): ItemProps => {
    const id = entryId(entry);
    const created =
      (entry.kind === "folder"
        ? entry.folder.createdAt
        : entry.file.createdAt) * 1000;
    return {
      count: counts?.get(id),
      dragEntries,
      entry,
      focusable: id === focusId,
      fresh: created > mounted,
      onOpen: actions.open,
      onRenameEnd,
      onSelect: select,
      renaming: renaming === id,
      selected: selection.has(id),
      showLocation,
    };
  };

  const folders = entries.filter((entry) => entry.kind === "folder");
  const files = entries.filter((entry) => entry.kind === "file");

  let body: ReactNode = empty;
  if (entries.length > 0 && layout === "list") {
    body = (
      <div className="flex flex-col">
        <SortHeader onSortChange={onSortChange} sort={sort} trash={trash} />
        <div className="flex flex-col gap-0.5">
          {entries.map((entry) => (
            <Row key={entryId(entry)} {...itemProps(entry)} />
          ))}
        </div>
      </div>
    );
  } else if (entries.length > 0) {
    body = (
      <>
        {folders.length > 0 && (
          <section className="flex flex-col gap-2">
            {files.length > 0 && <SectionLabel>Folders</SectionLabel>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-3">
              {folders.map((entry) => (
                <FolderTile key={entryId(entry)} {...itemProps(entry)} />
              ))}
            </div>
          </section>
        )}
        {files.length > 0 && (
          <section className="flex flex-col gap-2">
            {folders.length > 0 && <SectionLabel>Files</SectionLabel>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))]">
              {files.map((entry) => (
                <FileTile key={entryId(entry)} {...itemProps(entry)} />
              ))}
            </div>
          </section>
        )}
      </>
    );
  }

  return (
    <ContextMenu disabled={renaming !== undefined}>
      <ContextMenuTrigger
        aria-label="Files and folders"
        aria-multiselectable
        className="group/listing flex min-h-[50dvh] flex-1 flex-col gap-6 pb-24 outline-none"
        onClick={() => {
          if (selection.size > 0) {
            onSelectionChange(new Set());
          }
        }}
        onContextMenuCapture={(event) => {
          const node = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-entry]"
          );
          const entry = node?.dataset.entry
            ? byId.get(node.dataset.entry)
            : undefined;
          if (!entry) {
            setMenuFor(undefined);
            // The trash has nothing to offer for its empty space: the browser's own menu shows.
            if (trash) {
              event.stopPropagation();
            }
            return;
          }
          const id = entryId(entry);
          if (selection.has(id)) {
            setMenuFor(picked);
          } else {
            onSelectionChange(new Set([id]));
            setMenuFor([entry]);
          }
        }}
        onKeyDown={onKeyDown}
        ref={container}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- tiles picked like on a desktop; no native element lays them out
        role="listbox"
      >
        {body}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {menuFor ? (
          <EntryMenuItems entries={menuFor} />
        ) : (
          <BackgroundMenuItems />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
