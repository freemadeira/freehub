import { cn } from "cn";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  DownloadIcon,
  EllipsisIcon,
  ImageOffIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import type {
  ComponentProps,
  CSSProperties,
  DragEvent,
  ReactNode,
} from "react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { removePart } from "@/lib/brand-actions";
import { pictureSource } from "@/lib/brand-files";
import { copySvg, downloadBrandFile, isSvg } from "@/lib/brand-kit";
import type { BrandUpload } from "@/lib/brand-upload";
import type { BrandFile } from "@/lib/brands";
import { formatOf } from "@/lib/brands";
import { fileSource, useOpened } from "@/lib/drive-files";
import type { Project } from "@/lib/project";

/** The chapters of a brand's page, in order, with the ids their sections take. */
export const CHAPTERS = [
  { id: "logos", label: "Logos" },
  { id: "colors", label: "Colors" },
  { id: "typography", label: "Typography" },
  { id: "illustrations", label: "Illustrations" },
  { id: "patterns", label: "Patterns" },
  { id: "examples", label: "Do & don’t" },
  { id: "guidelines", label: "Guidelines" },
  { id: "in-use", label: "In use" },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]["id"];

export function chapterLabel(id: ChapterId): string {
  return CHAPTERS.find((chapter) => chapter.id === id)?.label ?? id;
}

/** A chapter of the brand: its title, what can be done with it, and what it holds. */
export function BrandSection({
  id,
  action,
  children,
}: {
  id: ChapterId;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-28 flex-col gap-4 lg:scroll-mt-20"
      id={id}
    >
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-xl font-semibold tracking-tight" id={`${id}-title`}>
          {chapterLabel(id)}
        </h2>
        {action && <div className="flex items-center gap-1.5">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Whether the drag carries files from the computer, rather than something on the page. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

/**
 * Takes files dropped on it, lighting up while they're over it. Without
 * `onFiles` it's just its children, for whoever can't add any.
 */
export function DropTarget({
  onFiles,
  className,
  children,
}: {
  onFiles?: (files: File[]) => void;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  if (!onFiles) {
    return <div className={className}>{children}</div>;
  }
  return (
    <div
      className={cn(
        "relative rounded-2xl outline-offset-4 transition-shadow duration-150 ease-out",
        // While files are dragged over the page, every place to drop them shows.
        "[[data-dragging-files]_&]:outline-primary/70 [[data-dragging-files]_&]:outline-2 [[data-dragging-files]_&]:outline-dashed",
        over && "ring-primary ring-offset-background ring-2 ring-offset-4",
        className
      )}
      data-drop-target
      onDragEnter={(event) => {
        if (carriesFiles(event)) {
          event.preventDefault();
          depth.current += 1;
          setOver(true);
        }
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) {
          setOver(false);
        }
      }}
      onDragOver={(event) => {
        if (carriesFiles(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) {
          return;
        }
        event.preventDefault();
        // The innermost target takes the files; outer ones leave them be.
        event.stopPropagation();
        depth.current = 0;
        setOver(false);
        const files = [...event.dataTransfer.files];
        if (files.length > 0) {
          onFiles(files);
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * A hidden file input and a way to open it: render `input`, then call `open`.
 */
export function useFilePicker(
  onPick: (files: File[]) => void,
  { accept, multiple = true }: { accept?: string; multiple?: boolean } = {}
): { input: ReactNode; open: () => void } {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      accept={accept}
      aria-hidden
      className="sr-only"
      multiple={multiple}
      onChange={(event) => {
        const picked = [...(event.target.files ?? [])];
        event.target.value = "";
        if (picked.length > 0) {
          onPick(picked);
        }
      }}
      ref={ref}
      tabIndex={-1}
      type="file"
    />
  );
  return { input, open: () => ref.current?.click() };
}

/**
 * A dashed place to add something, for whoever can. It takes a button's
 * props, so a popover or menu can open from it.
 */
export function AddTile({
  label,
  className,
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      className={cn(
        "border-foreground/15 text-muted-foreground hover:border-foreground/30 hover:bg-foreground/[0.02] hover:text-foreground focus-visible:ring-ring/50 flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed p-4 text-center text-sm transition-colors duration-150 ease-out outline-none focus-visible:ring-3",
        className
      )}
      type="button"
      {...props}
    >
      <PlusIcon aria-hidden className="size-4" />
      <span className="text-foreground font-medium">{label}</span>
    </button>
  );
}

/** Originals bigger than this show as their thumbnail, unless they're vectors. */
const MAX_ORIGINAL = 5 * 1024 * 1024;

/** Pictures looked at up close show themselves up to this size. */
const VIEWER_ORIGINAL = 40 * 1024 * 1024;

/** SVGs opened before, by object URL, as data URLs. */
const svgUrls = new Map<string, string>();

/**
 * An opened SVG as a data URL. Shown from an object URL, it would open in
 * the app's own origin from "Open image in new tab", scripts and all; a data
 * URL opens in an origin of its own.
 */
function useSvgDataUrl(url: string | undefined): string | undefined {
  // Kept in state, not read from the cache while rendering: the compiler
  // takes renders to be pure, and would keep showing what it read first.
  const [read, setRead] = useState<{ from: string; data: string }>();
  useEffect(() => {
    if (!url) {
      return;
    }
    let live = true;
    const open = async () => {
      try {
        let data = svgUrls.get(url);
        if (!data) {
          const response = await fetch(url);
          data = `data:image/svg+xml,${encodeURIComponent(await response.text())}`;
          svgUrls.set(url, data);
        }
        if (live) {
          setRead({ data, from: url });
        }
      } catch {
        // Not shown; the placeholder stays.
      }
    };
    open();
    return () => {
      live = false;
    };
  }, [url]);
  return url && read?.from === url ? read.data : undefined;
}

/**
 * A brand file's picture, opened from the servers: the file itself for
 * vectors and small images when it's shown large, its thumbnail otherwise.
 */
export function BrandPicture({
  file,
  original = false,
  maxOriginal = MAX_ORIGINAL,
  className,
  style,
}: {
  file: BrandFile;
  /** The file itself rather than its thumbnail, like a logo shown large. */
  original?: boolean;
  /** How big an original may be to show itself, in bytes. */
  maxOriginal?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const svg = isSvg(file);
  const whole = original && (svg || file.size <= maxOriginal);
  const source = whole ? fileSource(file) : pictureSource(file);
  const { url, error } = useOpened(source);
  const svgUrl = useSvgDataUrl(
    source.type === "image/svg+xml" ? url : undefined
  );
  const shown = source.type === "image/svg+xml" ? svgUrl : url;
  if (error) {
    return (
      <span
        className={cn(
          "text-muted-foreground flex items-center justify-center",
          className
        )}
        title={error}
      >
        <ImageOffIcon aria-hidden className="size-5" />
      </span>
    );
  }
  if (!shown) {
    return (
      <span
        aria-busy
        className={cn("bg-foreground/5 animate-pulse rounded-lg", className)}
      />
    );
  }
  return (
    <img
      alt={file.caption || file.name}
      className={cn("object-contain", className)}
      draggable={false}
      height={file.height}
      src={shown}
      style={style}
      width={file.width}
    />
  );
}

/** A file on its way, where it'll land: its picture if it has one, and how far along it is. */
export function PendingTile({
  upload,
  className,
}: {
  upload: BrandUpload;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-muted relative flex items-center justify-center overflow-hidden rounded-2xl",
        className
      )}
    >
      {upload.preview ? (
        <img
          alt=""
          className="size-full object-contain p-4 opacity-50"
          src={upload.preview}
        />
      ) : (
        <span className="text-muted-foreground max-w-[80%] truncate text-xs">
          {upload.name}
        </span>
      )}
      <span className="bg-background/85 shadow-surface absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums backdrop-blur-sm">
        <Spinner className="size-3" />
        {Math.round(upload.progress * 100)}%
      </span>
    </div>
  );
}

/** What can be done with a file: save it, copy its code, or take it off. */
export function FileMenu({
  project,
  file,
  name,
  editable,
  className,
  children,
  edits,
}: {
  project: Project;
  file: BrandFile;
  /** What it's saved as. */
  name?: string;
  editable: boolean;
  /** How the button that opens the menu looks. */
  className?: string;
  /** What the button shows; three dots without. */
  children?: ReactNode;
  /** More changes to offer whoever can edit, before taking it off. */
  edits?: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={
          children ? `${formatOf(file)} file` : `More for ${file.name}`
        }
        className={cn(
          "focus-visible:ring-ring/50 flex items-center justify-center outline-none focus-visible:ring-3",
          className
        )}
      >
        {children ?? <EllipsisIcon aria-hidden className="size-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => downloadBrandFile(file, name)}>
          <DownloadIcon />
          Download {formatOf(file)}
        </DropdownMenuItem>
        {isSvg(file) && (
          <DropdownMenuItem onClick={() => copySvg(file)}>
            <CodeIcon />
            Copy SVG code
          </DropdownMenuItem>
        )}
        {editable && (
          <>
            <DropdownMenuSeparator />
            {edits}
            <DropdownMenuItem
              onClick={() => removePart(project, file)}
              variant="destructive"
            >
              <Trash2Icon />
              Remove
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Pictures looked at up close, one at a time: the file itself, what it
 * shows, and the arrow keys to go through the others.
 */
export function PictureViewer({
  project,
  files,
  at,
  onAt,
  editable,
}: {
  project: Project;
  files: BrandFile[];
  /** Which one is open, if any. */
  at?: number;
  onAt: (at?: number) => void;
  editable: boolean;
}) {
  const file = at === undefined ? undefined : files[at];
  const step = (by: number) => {
    if (at !== undefined && files.length > 1) {
      onAt((at + by + files.length) % files.length);
    }
  };
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onAt();
        }
      }}
      open={file !== undefined}
    >
      <DialogContent
        className="gap-3 sm:max-w-4xl"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            step(-1);
          } else if (event.key === "ArrowRight") {
            step(1);
          }
        }}
      >
        {file && (
          <>
            <DialogTitle className="truncate pr-10">
              {file.caption || file.name}
            </DialogTitle>
            <div className="bg-muted flex min-h-64 items-center justify-center rounded-xl p-4">
              <BrandPicture
                className="max-h-[65dvh] w-auto max-w-full"
                file={file}
                key={file.id}
                maxOriginal={VIEWER_ORIGINAL}
                original
              />
            </div>
            <div className="flex items-center justify-end gap-1">
              {files.length > 1 && (
                <>
                  <Button
                    aria-label="Previous"
                    onClick={() => step(-1)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <span className="text-muted-foreground px-1 text-xs tabular-nums">
                    {(at ?? 0) + 1} / {files.length}
                  </span>
                  <Button
                    aria-label="Next"
                    onClick={() => step(1)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <ChevronRightIcon />
                  </Button>
                </>
              )}
              <FileMenu
                className="hover:bg-muted size-8 rounded-full"
                editable={editable}
                file={file}
                project={project}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
