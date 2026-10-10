import { format } from "date-fns";
import {
  CloudUploadIcon,
  FolderPlusIcon,
  FolderUpIcon,
  HardDriveIcon,
  UploadIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ChangeEvent, DragEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useSearch } from "wouter";

import { copyText } from "@/components/copy";
import { ProjectAvatar } from "@/components/project-avatar";
import { SplitButton } from "@/components/split-button";
import { TopBar } from "@/components/top-bar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { DriveView } from "@/features/drive/drive-context";
import {
  drivePath,
  FILE_PARAM,
  fileHref,
  parseFolderParam,
  parseView,
  VIEW_PARAM,
} from "@/features/drive/drive-context";
import { carriesFiles } from "@/features/drive/drive-dnd";
import { EmptyState, Loading } from "@/features/drive/drive-empty";
import {
  FolderHeader,
  SearchHeader,
  ViewHeader,
} from "@/features/drive/drive-header";
import type { Layout } from "@/features/drive/drive-items";
import { Listing } from "@/features/drive/drive-items";
import type {
  DriveActions,
  DriveContextValue,
  Entry,
} from "@/features/drive/drive-state";
import { DriveContext, entryId, itemsOf } from "@/features/drive/drive-state";
import { Toolbar } from "@/features/drive/drive-toolbar";
import { FolderIcon } from "@/features/drive/file-icon";
import { FolderStyleDialog } from "@/features/drive/folder-style-dialog";
import { MoveDialog } from "@/features/drive/move-dialog";
import { QuickLook } from "@/features/drive/quick-look";
import type { DriveEntries } from "@/features/drive/use-drive-entries";
import { driveEntries } from "@/features/drive/use-drive-entries";
import { useDriveContent, useDriveMarks } from "@/hooks/use-drive";
import type { DriveContent, DriveFolder, DriveTree, Sort } from "@/lib/drive";
import { DEFAULT_SORT, pathTo, SORTS } from "@/lib/drive";
import {
  cleanUpBlobs,
  countItems,
  createFolder,
  downloadFiles,
  emptyTrash,
  purgeExpired,
  purgeItems,
  restoreItems,
  setStarred,
  trashItems,
} from "@/lib/drive-actions";
import type { Destination } from "@/lib/drive-upload";
import {
  readPickedFolder,
  uploadDropped,
  uploadFiles,
  uploadPicked,
} from "@/lib/drive-upload";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";
import { readStorage, writeStorage } from "@/lib/utils";

const SORT_KEY = "drive:sort";
const LAYOUT_KEY = "drive:layout";
const SEARCH_DELAY = 200;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** Clipboard pictures arrive as "image.png"; they get the time they were pasted instead. */
const PASTED = /^image\.(?<extension>\w+)$/u;

function projectPath(project: Pick<Project, "slug">): string {
  return `/p/${project.slug}`;
}

function readSort(): Sort {
  try {
    const value: unknown = JSON.parse(readStorage(SORT_KEY) ?? "null");
    const sort = value as Partial<Sort> | null;
    const key = SORTS.find((option) => option.value === sort?.key)?.value;
    return key ? { ascending: sort?.ascending !== false, key } : DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

function readLayout(): Layout {
  return readStorage(LAYOUT_KEY) === "list" ? "list" : "grid";
}

/** A choice kept on this device, like the order and layout. */
function useStored<T>(read: () => T, write: (value: T) => void) {
  const [value, setValue] = useState(read);
  return [
    value,
    (next: T) => {
      setValue(next);
      write(next);
    },
  ] as const;
}

/** The text searched for, a moment after it's typed. */
function useSettled(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value.trim()), SEARCH_DELAY);
    return () => clearTimeout(timer);
  }, [value]);
  return value.trim() ? settled : "";
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [role=dialog]") !== null)
  );
}

/** A pasted screenshot named for when it was pasted; other files keep their names. */
function named(file: File): File {
  const extension = PASTED.exec(file.name)?.groups?.extension;
  if (!extension) {
    return file;
  }
  const stamp = format(new Date(), "yyyy-MM-dd 'at' HH.mm.ss");
  return new File([file], `Pasted ${stamp}.${extension}`, { type: file.type });
}

/** Pasting files anywhere on the page, outside a field, uploads them to `to`. */
function usePasteUpload(to: Destination | undefined) {
  const project = to?.project;
  const folder = to?.folder;
  useEffect(() => {
    if (!project) {
      return;
    }
    const onPaste = (event: ClipboardEvent) => {
      const pasted = [...(event.clipboardData?.files ?? [])];
      if (pasted.length === 0 || isTyping(event.target)) {
        return;
      }
      event.preventDefault();
      uploadFiles(pasted.map(named), { folder, project });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [project, folder]);
}

/** "/" jumps to the search, as in many apps. */
function useSlashToSearch(field: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !(event.metaKey || event.ctrlKey || isTyping(event.target))
      ) {
        event.preventDefault();
        field.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [field]);
}

/** Files dragged in from the computer, anywhere on the page, upload to `to`. */
function useDropUpload(to: Destination | undefined) {
  const [dropping, setDropping] = useState(false);
  const handlers = {
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDropping(false);
      }
    },
    onDragOver: (event: DragEvent) => {
      if (to && carriesFiles(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!dropping) {
          setDropping(true);
        }
      }
    },
    onDrop: (event: DragEvent) => {
      setDropping(false);
      if (to && carriesFiles(event)) {
        event.preventDefault();
        uploadDropped(event.dataTransfer, to);
      }
    },
  };
  return { dropping, handlers };
}

function DropOverlay({ show, label }: { show: boolean; label: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          animate={{ opacity: 1 }}
          aria-hidden
          className="border-primary/60 bg-primary/5 pointer-events-none absolute -inset-x-2 inset-y-0 z-30 rounded-3xl border-2 border-dashed backdrop-blur-[2px]"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="sticky top-1/2 flex justify-center pt-24">
            <motion.div
              animate={{ scale: 1, y: 0 }}
              className="bg-primary text-primary-foreground shadow-raised flex items-center gap-3 rounded-full py-3 pr-5 pl-4"
              initial={{ scale: 0.9, y: 8 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
            >
              <CloudUploadIcon className="size-5 animate-bounce" />
              <span className="text-sm font-medium">
                Drop to upload to {label}
              </span>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function UploadButtons({
  onPickFiles,
  onPickFolder,
  onNewFolder,
}: {
  onPickFiles: () => void;
  onPickFolder: () => void;
  onNewFolder: () => void;
}) {
  return (
    <>
      <Button
        className="max-sm:hidden"
        onClick={onNewFolder}
        size="sm"
        variant="ghost"
      >
        <FolderPlusIcon />
        New folder
      </Button>
      <SplitButton
        menu={
          <>
            <DropdownMenuItem onClick={onPickFiles}>
              <UploadIcon />
              Upload files
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPickFolder}>
              <FolderUpIcon />
              Upload a folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onNewFolder}>
              <FolderPlusIcon />
              New folder
            </DropdownMenuItem>
          </>
        }
        menuLabel="More ways to add"
        onClick={onPickFiles}
        size="sm"
      >
        <UploadIcon />
        Upload
      </SplitButton>
    </>
  );
}

function Confirm({
  open,
  onOpenChange,
  title,
  description,
  action,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  action: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} variant="destructive">
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Opening, renaming, moving, starring and deleting, as the listing and menus ask for them. */
function useActions({
  project,
  pubkey,
  tree,
  folderId,
  openFile,
  pickFiles,
  onSelect,
  onRename,
  onMove,
  onStyle,
  onPurge,
}: {
  project: Project;
  pubkey: string;
  tree: DriveTree;
  folderId?: string;
  openFile: (fileId: string) => void;
  pickFiles: () => void;
  onSelect: (ids: Set<string>) => void;
  onRename: (id: string) => void;
  onMove: (entries: Entry[]) => void;
  onStyle: (folder: DriveFolder) => void;
  onPurge: (entries: Entry[]) => void;
}): DriveActions {
  const [, navigate] = useLocation();

  // Shown at once, so it can be named right away; it's saved meanwhile.
  const newFolder = () => {
    const made = createFolder(project, folderId);
    onSelect(new Set([made.id]));
    onRename(made.id);
  };

  const restore = async (entries: Entry[]) => {
    onSelect(new Set());
    const items = itemsOf(entries);
    if (await restoreItems(project, items)) {
      toast.success(`${countItems(items)} restored`);
    }
  };

  const copyLink = async (entry: Entry) => {
    const href =
      entry.kind === "folder"
        ? drivePath(project, entry.folder)
        : fileHref(
            project,
            entry.file,
            entry.file.folder ? tree.byId.get(entry.file.folder) : undefined
          );
    if (await copyText(`${globalThis.location.origin}${href}`)) {
      toast.success("Link copied");
    }
  };

  return {
    copyLink,
    download: (files) => {
      downloadFiles(files);
    },
    move: onMove,
    newFolder,
    open: (entry) => {
      if (entry.trashed) {
        return;
      }
      if (entry.kind === "folder") {
        navigate(drivePath(project, entry.folder));
      } else {
        openFile(entry.file.id);
      }
    },
    pickFiles,
    purge: onPurge,
    rename: (entry) => {
      onSelect(new Set([entryId(entry)]));
      onRename(entryId(entry));
    },
    restore,
    star: (entries, starred) => {
      setStarred(pubkey, project, entries.map(entryId), starred);
    },
    style: onStyle,
    trash: (entries) => {
      onSelect(new Set());
      trashItems(project, itemsOf(entries));
    },
  };
}

/** The search parameters, and a way to change some of them while keeping the rest. */
function useParams() {
  const [location] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const withParams = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    const query = next.toString();
    return query ? `${location}?${query}` : location;
  };
  return {
    openFile: params.get(FILE_PARAM) ?? undefined,
    view: parseView(params.get(VIEW_PARAM)),
    withParams,
  };
}

function crumbsOf(
  project: Project,
  tree: DriveTree,
  folder?: DriveFolder,
  view?: DriveView
) {
  const above = folder ? pathTo(tree, folder.parent) : [];
  return [
    {
      href: projectPath(project),
      icon: <ProjectAvatar project={project} />,
      label: project.title,
    },
    {
      href: folder || view ? drivePath(project) : undefined,
      icon: <HardDriveIcon className="text-muted-foreground size-4 shrink-0" />,
      label: "Drive",
    },
    ...above.map((item) => ({
      href: drivePath(project, item),
      label: item.name,
    })),
    ...(folder ? [{ label: folder.name }] : []),
  ];
}

/**
 * Upkeep any member's app does while the Drive is open: deleting what's been
 * in the trash for 30 days, and the blobs of your files deleted for good.
 */
function useUpkeep(
  project: Project,
  content: DriveContent,
  loaded: boolean,
  editable: boolean
) {
  useEffect(() => {
    if (loaded && editable) {
      purgeExpired(project);
    }
  }, [loaded, editable, project]);
  const { deleted } = content;
  useEffect(() => {
    if (loaded) {
      cleanUpBlobs(deleted);
    }
  }, [loaded, deleted]);
}

/** What's shown, by name: the folder, the view, or the search. */
function PageHeader({
  folder,
  view,
  query,
  listing,
  onEmptyTrash,
}: {
  folder?: DriveFolder;
  view?: DriveView;
  query: string;
  listing: DriveEntries;
  /** For members, who may empty the trash. */
  onEmptyTrash?: () => void;
}) {
  if (query) {
    return <SearchHeader query={query} results={listing.results} />;
  }
  if (view) {
    const emptiable = view === "trash" && listing.entries.length > 0;
    return (
      <ViewHeader
        onEmptyTrash={emptiable ? onEmptyTrash : undefined}
        view={view}
      />
    );
  }
  return <FolderHeader files={listing.folderFiles} folder={folder} />;
}

interface DrivePageProps {
  project: Project;
  pubkey: string;
  content: DriveContent;
  loaded: boolean;
  folder?: DriveFolder;
}

function DrivePage({
  project,
  pubkey,
  content,
  loaded,
  folder,
}: DrivePageProps) {
  const [, navigate] = useLocation();
  const { openFile, view, withParams } = useParams();
  const editable = canEdit(project, pubkey);
  const { tree } = content;
  const folderId = folder?.id;

  const [sort, setSort] = useStored(readSort, (value) =>
    writeStorage(SORT_KEY, JSON.stringify(value))
  );
  const [layout, setLayout] = useStored<Layout>(readLayout, (value) =>
    writeStorage(LAYOUT_KEY, value === "grid" ? null : value)
  );
  const [text, setText] = useState("");
  const query = useSettled(text);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  // The entry being renamed in place; empty when none is.
  const [renaming, setRenaming] = useState("");
  const [moving, setMoving] = useState<Entry[]>();
  const [styling, setStyling] = useState<DriveFolder>();
  const [purging, setPurging] = useState<Entry[]>();
  const [emptying, setEmptying] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const marks = useDriveMarks(pubkey, project);
  useUpkeep(project, content, loaded, editable);

  // A new place starts with nothing picked.
  const place = `${folderId ?? ""}:${view ?? ""}:${query}`;
  const [shownPlace, setShownPlace] = useState(place);
  if (place !== shownPlace) {
    setShownPlace(place);
    setSelection(new Set());
    setRenaming("");
  }

  const listing = driveEntries({
    content,
    folder: folderId,
    loaded,
    marks,
    query,
    sort,
    view,
  });
  const browsing = !(view || query);
  const here: Destination | undefined =
    browsing && editable ? { folder: folderId, project } : undefined;
  usePasteUpload(here);
  useSlashToSearch(searchField);
  const drop = useDropUpload(here);
  const pickFiles = () => filePicker.current?.click();

  const actions = useActions({
    folderId,
    onMove: setMoving,
    onPurge: setPurging,
    onRename: setRenaming,
    onSelect: setSelection,
    onStyle: setStyling,
    openFile: (fileId) => navigate(withParams({ [FILE_PARAM]: fileId })),
    pickFiles,
    project,
    pubkey,
    tree,
  });

  const drive: DriveContextValue = {
    actions,
    canEdit: editable,
    content,
    destination: (target) => ({ folder: target, project }),
    project,
    pubkey,
    starred: (id) => marks.stars.has(id),
    tree,
  };

  const onPicked = (event: ChangeEvent<HTMLInputElement>, folders: boolean) => {
    const list = [...(event.target.files ?? [])];
    event.target.value = "";
    if (list.length > 0 && here) {
      if (folders) {
        uploadPicked(readPickedFolder(list), here);
      } else {
        uploadFiles(list, here);
      }
    }
  };

  const changeView = (next: DriveView | undefined) => {
    setText("");
    navigate(
      next ? `${drivePath(project)}?${VIEW_PARAM}=${next}` : drivePath(project)
    );
  };

  const picked = listing.entries.filter((entry) =>
    selection.has(entryId(entry))
  );
  const files = listing.entries.flatMap((entry) =>
    entry.kind === "file" ? [entry.file] : []
  );

  return (
    <DriveContext value={drive}>
      <TopBar crumbs={crumbsOf(project, tree, folder, view)}>
        {here && (
          <UploadButtons
            onNewFolder={() => actions.newFolder()}
            onPickFiles={pickFiles}
            onPickFolder={() => folderPicker.current?.click()}
          />
        )}
      </TopBar>
      <input
        aria-label="Upload files"
        className="sr-only"
        multiple
        onChange={(event) => onPicked(event, false)}
        ref={filePicker}
        tabIndex={-1}
        type="file"
      />
      <input
        aria-label="Upload a folder"
        className="sr-only"
        multiple
        onChange={(event) => onPicked(event, true)}
        ref={folderPicker}
        tabIndex={-1}
        type="file"
        // Not in React's types, but every browser picks folders with it.
        {...{ webkitdirectory: "" }}
      />
      <main
        className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 pt-4 sm:px-6"
        {...drop.handlers}
      >
        <PageHeader
          folder={folder}
          listing={listing}
          onEmptyTrash={editable ? () => setEmptying(true) : undefined}
          query={query}
          view={view}
        />
        <Toolbar
          layout={layout}
          onClearPicked={() => setSelection(new Set())}
          onLayoutChange={setLayout}
          onSortChange={setSort}
          onTextChange={setText}
          onViewChange={changeView}
          picked={picked}
          searchField={searchField}
          searching={query !== ""}
          sort={sort}
          text={text}
          view={view}
        />
        <Listing
          counts={listing.counts}
          empty={
            <EmptyState
              editable={editable}
              folder={folder}
              kind={query ? "search" : (view ?? "files")}
              layout={layout}
              loading={listing.loading}
              onNewFolder={() => actions.newFolder()}
              onPick={pickFiles}
            />
          }
          entries={listing.loading ? [] : listing.entries}
          layout={layout}
          onRename={setRenaming}
          onRenameEnd={() => setRenaming("")}
          onSelectionChange={setSelection}
          onSortChange={setSort}
          renaming={renaming || undefined}
          selection={selection}
          showLocation={!browsing}
          sort={sort}
        />
        <DropOverlay label={folder?.name ?? "the Drive"} show={drop.dropping} />
      </main>
      <QuickLook
        fileId={openFile}
        files={files}
        onNavigate={(file) =>
          navigate(withParams({ [FILE_PARAM]: file?.id }), {
            replace: Boolean(file && openFile),
          })
        }
      />
      <MoveDialog
        entries={moving}
        onOpenChange={(open) => setMoving(open ? moving : undefined)}
      />
      <FolderStyleDialog
        folder={styling}
        onOpenChange={(open) => setStyling(open ? styling : undefined)}
        project={project}
      />
      <Confirm
        action="Delete forever"
        description="They’re deleted for everyone, with what’s inside folders. This can’t be undone."
        onConfirm={() => {
          if (purging) {
            setSelection(new Set());
            purgeItems(project, itemsOf(purging));
          }
        }}
        onOpenChange={(open) => setPurging(open ? purging : undefined)}
        open={purging !== undefined}
        title={`Delete ${countItems(itemsOf(purging ?? []))} forever?`}
      />
      <Confirm
        action="Empty trash"
        description="Everything in it is deleted for good, for everyone. This can’t be undone."
        onConfirm={() => emptyTrash(project)}
        onOpenChange={setEmptying}
        open={emptying}
        title="Empty the trash?"
      />
    </DriveContext>
  );
}

// ———————————————————————————————————————— The route

function FolderGone({ project }: { project: Project }) {
  return (
    <Empty>
      <FolderIcon folder={{ color: "gray" }} size="xl" />
      <EmptyTitle>This folder isn’t here anymore</EmptyTitle>
      <EmptyDescription>It may have been moved to the trash.</EmptyDescription>
      <Link
        className="text-primary text-sm font-medium"
        href={drivePath(project)}
      >
        Back to the Drive
      </Link>
    </Empty>
  );
}

/**
 * A project's Drive at `/p/:project/drive`, or one of its folders after it.
 * The link follows the folder's name as it changes; any name before the id
 * still opens it.
 */
export function DriveRoute({
  project,
  pubkey,
  folderParam,
}: {
  project: Project;
  pubkey: string;
  folderParam?: string;
}) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { content, loaded } = useDriveContent(project);
  const id = folderParam ? parseFolderParam(folderParam) : undefined;
  const folder = id ? content.tree.byId.get(id) : undefined;
  const path = folder ? drivePath(project, folder) : undefined;

  useEffect(() => {
    if (path && folderParam && !path.endsWith(`/${folderParam}`)) {
      navigate(search ? `${path}?${search}` : path, { replace: true });
    }
  }, [navigate, folderParam, path, search]);

  if (folderParam && !folder) {
    return (
      <>
        <TopBar
          crumbs={[
            { href: projectPath(project), label: project.title },
            { href: drivePath(project), label: "Drive" },
          ]}
        />
        {loaded ? (
          <FolderGone project={project} />
        ) : (
          <main
            aria-busy
            className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pt-4 sm:px-6"
          >
            <Skeleton className="h-12 w-64 rounded-xl" />
            <Loading layout="grid" />
          </main>
        )}
      </>
    );
  }
  return (
    <DrivePage
      content={content}
      folder={folder}
      key={project.address}
      loaded={loaded}
      project={project}
      pubkey={pubkey}
    />
  );
}
