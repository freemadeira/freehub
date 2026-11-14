import { cn } from "cn";
import {
  CheckIcon,
  HardDriveIcon,
  MinusIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  AddTile,
  BrandPicture,
  BrandSection,
  DropTarget,
  FileMenu,
  PendingTile,
  PictureViewer,
  useFilePicker,
} from "@/features/branding/brand-parts";
import type { Sortable } from "@/features/branding/sortable-parts";
import { SortableParts } from "@/features/branding/sortable-parts";
import { useDriveContent } from "@/hooks/use-drive";
import type { BrandUpload } from "@/lib/brand-upload";
import { uploadToBrand } from "@/lib/brand-upload";
import type { Brand, BrandFile, BrandParts, HexColor } from "@/lib/brands";
import { filesOf, isShown, PAPER } from "@/lib/brands";
import type { DriveFile } from "@/lib/drive";
import { fileKind } from "@/lib/drive";
import {
  fetchFile,
  fileSource,
  thumbSource,
  useOpened,
} from "@/lib/drive-files";
import type { Project } from "@/lib/project";
import { errorMessage, plural } from "@/lib/utils";

const ACCEPT = "image/*";
/** Sizes a pattern's tile repeats at, in pixels across. */
const SCALES = [96, 160, 240, 360];

type GalleryKind = "illustration" | "pattern";

function DriveThumb({
  file,
  picked,
  onToggle,
}: {
  file: DriveFile;
  picked: boolean;
  onToggle: () => void;
}) {
  const { url } = useOpened(thumbSource(file) ?? fileSource(file));
  return (
    <button
      aria-pressed={picked}
      className={cn(
        "bg-muted focus-visible:ring-ring/50 relative block aspect-square w-full overflow-hidden rounded-xl outline-none focus-visible:ring-3",
        picked && "ring-primary ring-2"
      )}
      onClick={onToggle}
      title={file.name}
      type="button"
    >
      {url && (
        <img alt={file.name} className="size-full object-cover" src={url} />
      )}
      {picked && (
        <span className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full">
          <CheckIcon aria-hidden className="size-3.5" />
        </span>
      )}
    </button>
  );
}

/** The Drive's pictures to pick from, or why there are none yet. */
function DrivePictures({
  pictures,
  loaded,
  picked,
  onToggle,
}: {
  pictures: DriveFile[];
  loaded: boolean;
  picked: string[];
  onToggle: (id: string) => void;
}) {
  if (pictures.length > 0) {
    return (
      <ul className="grid max-h-[55dvh] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-4">
        {pictures.map((file) => (
          <li key={file.id}>
            <DriveThumb
              file={file}
              onToggle={() => onToggle(file.id)}
              picked={picked.includes(file.id)}
            />
          </li>
        ))}
      </ul>
    );
  }
  if (loaded) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        No pictures in this project’s Drive.
      </p>
    );
  }
  return (
    <div aria-busy className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      <Skeleton className="aspect-square rounded-xl" />
      <Skeleton className="aspect-square rounded-xl" />
      <Skeleton className="aspect-square rounded-xl" />
    </div>
  );
}

/**
 * What the Drive picker holds while it's open. It follows the Drive only
 * then, so a brand page doesn't keep the Drive in step for nothing.
 */
function DrivePickerBody({
  project,
  onPick,
  onDone,
}: {
  project: Project;
  /** Resolves once the pictures are opened and on their way into the brand. */
  onPick: (files: DriveFile[]) => Promise<void>;
  onDone: () => void;
}) {
  const { content, loaded } = useDriveContent(project);
  const [picked, setPicked] = useState<string[]>([]);
  const [opening, setOpening] = useState(false);
  const pictures = content.files.filter(
    (file) => fileKind(file) === "image" && isShown(file)
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add from Drive</DialogTitle>
      </DialogHeader>
      <DrivePictures
        loaded={loaded}
        onToggle={(id) =>
          setPicked((before) =>
            before.includes(id)
              ? before.filter((item) => item !== id)
              : [...before, id]
          )
        }
        picked={picked}
        pictures={pictures}
      />
      <DialogFooter>
        <DialogClose
          disabled={opening}
          render={<Button type="button" variant="ghost" />}
        >
          Cancel
        </DialogClose>
        <Button
          disabled={picked.length === 0 || opening}
          onClick={async () => {
            setOpening(true);
            await onPick(pictures.filter((file) => picked.includes(file.id)));
            setOpening(false);
            onDone();
          }}
        >
          {opening && <Spinner />}
          {picked.length > 0
            ? `Add ${plural(picked.length, "picture")}`
            : "Add"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Copies Drive pictures into the brand: each opened, then sealed again as
 * the brand's own, so deleting it from the Drive leaves the brand be.
 * Resolves once they're opened; the uploads carry on from there.
 */
async function copyFromDrive(
  project: Project,
  brand: Brand,
  kind: GalleryKind,
  files: DriveFile[]
): Promise<void> {
  const copies: File[] = [];
  for (const file of files) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one download at a time, so a big pick doesn't flood the servers
      const blob = await fetchFile(file);
      copies.push(new File([blob], file.name, { type: blob.type }));
    } catch (error) {
      toast.error(`“${file.name}” couldn’t be opened.`, {
        description: errorMessage(error),
      });
    }
  }
  if (copies.length > 0) {
    uploadToBrand(project, brand, { kind }, copies);
  }
}

/** Where pictures come into a gallery: the computer, by picking or dropping, or the Drive. */
function useGalleryAdd(project: Project, brand: Brand, kind: GalleryKind) {
  const [fromDrive, setFromDrive] = useState(false);
  const add = (picked: File[]) =>
    uploadToBrand(project, brand, { kind }, picked);
  const picker = useFilePicker(add, { accept: ACCEPT });
  const dialogs = (
    <>
      {picker.input}
      <Dialog onOpenChange={setFromDrive} open={fromDrive}>
        <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
          <DrivePickerBody
            onDone={() => setFromDrive(false)}
            onPick={(picked) => copyFromDrive(project, brand, kind, picked)}
            project={project}
          />
        </DialogContent>
      </Dialog>
    </>
  );
  return {
    add,
    dialogs,
    handleDrive: () => setFromDrive(true),
    handlePick: () => picker.open(),
  };
}

/** The tile that adds to a gallery: from the computer, or from the Drive. */
function AddPictures({
  label,
  className,
  onUpload,
  onDrive,
}: {
  label: string;
  className?: string;
  onUpload: () => void;
  onDrive: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<AddTile className={className} label={label} />}
      />
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={onUpload}>
          <UploadIcon />
          From your computer
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDrive}>
          <HardDriveIcon />
          From Drive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Illustration({
  project,
  file,
  editable,
  sortable,
  onOpen,
}: {
  project: Project;
  file: BrandFile;
  editable: boolean;
  sortable: Sortable;
  onOpen: () => void;
}) {
  return (
    <figure className="bg-muted group/item relative aspect-[4/3] overflow-hidden rounded-2xl">
      <button
        aria-label={`Look at ${file.name}`}
        className="focus-visible:ring-ring/50 size-full cursor-zoom-in rounded-2xl p-3 outline-none focus-visible:ring-3 focus-visible:ring-inset"
        onClick={onOpen}
        type="button"
      >
        <BrandPicture className="size-full" file={file} />
      </button>
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
        {sortable.handle}
        <FileMenu
          className="bg-background/85 shadow-surface size-7 rounded-full backdrop-blur-sm"
          editable={editable}
          file={file}
          project={project}
        />
      </div>
    </figure>
  );
}

/** The brand's illustrations, each looked at up close on a click. */
export function IllustrationsSection({
  project,
  brand,
  parts,
  uploads,
  editable,
}: {
  project: Project;
  brand: Brand;
  parts: BrandParts;
  uploads: BrandUpload[];
  editable: boolean;
}) {
  const files = filesOf(parts.files, "illustration");
  const pending = uploads.filter(
    (upload) => upload.place.kind === "illustration"
  );
  const adding = useGalleryAdd(project, brand, "illustration");
  const [open, setOpen] = useState<number>();
  return (
    <BrandSection id="illustrations">
      <DropTarget onFiles={editable ? adding.add : undefined}>
        <SortableParts
          className="grid grid-cols-2 gap-3 lg:grid-cols-3"
          editable={editable}
          group="illustrations"
          handleClassName="bg-background/85 shadow-surface size-7 backdrop-blur-sm"
          label={(file) => file.name}
          parts={files}
          project={project}
          render={(file, sortable) => (
            <Illustration
              editable={editable}
              file={file}
              key={file.id}
              onOpen={() => setOpen(files.indexOf(file))}
              project={project}
              sortable={sortable}
            />
          )}
        >
          {pending.map((upload) => (
            <PendingTile
              className="aspect-[4/3]"
              key={upload.id}
              upload={upload}
            />
          ))}
          {editable && (
            <AddPictures
              className="aspect-[4/3]"
              label="Add illustrations"
              onDrive={adding.handleDrive}
              onUpload={adding.handlePick}
            />
          )}
        </SortableParts>
      </DropTarget>
      <PictureViewer
        at={open}
        editable={editable}
        files={files}
        onAt={setOpen}
        project={project}
      />
      {editable && adding.dialogs}
    </BrandSection>
  );
}

/** A pattern repeated across a tile, over the background picked. */
function PatternTile({
  project,
  file,
  scale,
  background,
  editable,
  sortable,
}: {
  project: Project;
  file: BrandFile;
  scale: number;
  background: HexColor;
  editable: boolean;
  sortable: Sortable;
}) {
  const { url } = useOpened(fileSource(file));
  const ratio = file.width && file.height ? file.height / file.width : 1;
  return (
    <figure
      className="shadow-surface group/item relative aspect-[4/3] overflow-hidden rounded-2xl transition-[background-color] duration-200"
      style={{
        backgroundColor: background,
        backgroundImage: url ? `url("${url}")` : undefined,
        backgroundRepeat: "repeat",
        backgroundSize: `${scale}px ${Math.round(scale * ratio)}px`,
      }}
    >
      {!url && (
        <span
          aria-busy
          className="bg-foreground/5 absolute inset-0 animate-pulse"
        />
      )}
      <figcaption className="sr-only">{file.name}</figcaption>
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
        {sortable.handle}
        <FileMenu
          className="bg-background/85 shadow-surface size-7 rounded-full backdrop-blur-sm"
          editable={editable}
          file={file}
          project={project}
        />
      </div>
    </figure>
  );
}

/** Backgrounds to lay patterns on, and how big they repeat. */
function PatternControls({
  backgrounds,
  background,
  onBackground,
  scaleAt,
  onScale,
}: {
  backgrounds: HexColor[];
  background: number;
  onBackground: (at: number) => void;
  scaleAt: number;
  onScale: (at: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <fieldset className="flex items-center gap-1">
        <legend className="sr-only">Background</legend>
        {backgrounds.map((hex, index) => (
          <button
            aria-label={index === 0 ? "On white" : `On ${hex}`}
            aria-pressed={index === background}
            className={cn(
              "image-outline focus-visible:ring-ring/50 size-5 rounded-full outline-none focus-visible:ring-3",
              index === background &&
                "ring-foreground ring-offset-background ring-2 ring-offset-2"
            )}
            key={`${hex}-${index}`}
            onClick={() => onBackground(index)}
            style={{ background: hex }}
            type="button"
          />
        ))}
      </fieldset>
      <div className="bg-foreground/5 flex items-center rounded-full">
        <Button
          aria-label="Smaller"
          disabled={scaleAt === 0}
          onClick={() => onScale(scaleAt - 1)}
          size="icon-sm"
          variant="ghost"
        >
          <MinusIcon />
        </Button>
        <Button
          aria-label="Bigger"
          disabled={scaleAt === SCALES.length - 1}
          onClick={() => onScale(scaleAt + 1)}
          size="icon-sm"
          variant="ghost"
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  );
}

/** The brand's patterns, repeated as they'd be used, at a size and on a color picked here. */
export function PatternsSection({
  project,
  brand,
  parts,
  uploads,
  editable,
}: {
  project: Project;
  brand: Brand;
  parts: BrandParts;
  uploads: BrandUpload[];
  editable: boolean;
}) {
  const files = filesOf(parts.files, "pattern");
  const pending = uploads.filter((upload) => upload.place.kind === "pattern");
  const [scaleAt, setScaleAt] = useState(1);
  const [backgroundAt, setBackgroundAt] = useState(0);
  const backgrounds: HexColor[] = [
    PAPER,
    ...parts.colors.map((color) => color.hex),
  ];
  const background = backgrounds[backgroundAt] ?? PAPER;
  const scale = SCALES[scaleAt] ?? 160;
  const adding = useGalleryAdd(project, brand, "pattern");

  return (
    <BrandSection
      action={
        files.length > 0 && (
          <PatternControls
            background={backgroundAt}
            backgrounds={backgrounds}
            onBackground={setBackgroundAt}
            onScale={setScaleAt}
            scaleAt={scaleAt}
          />
        )
      }
      id="patterns"
    >
      <DropTarget onFiles={editable ? adding.add : undefined}>
        <SortableParts
          className="grid grid-cols-2 gap-3 lg:grid-cols-3"
          editable={editable}
          group="patterns"
          handleClassName="bg-background/85 shadow-surface size-7 backdrop-blur-sm"
          label={(file) => file.name}
          parts={files}
          project={project}
          render={(file, sortable) => (
            <PatternTile
              background={background}
              editable={editable}
              file={file}
              key={file.id}
              project={project}
              scale={scale}
              sortable={sortable}
            />
          )}
        >
          {pending.map((upload) => (
            <PendingTile
              className="aspect-[4/3]"
              key={upload.id}
              upload={upload}
            />
          ))}
          {editable && (
            <AddPictures
              className="aspect-[4/3]"
              label="Add patterns"
              onDrive={adding.handleDrive}
              onUpload={adding.handlePick}
            />
          )}
        </SortableParts>
      </DropTarget>
      {editable && adding.dialogs}
    </BrandSection>
  );
}
