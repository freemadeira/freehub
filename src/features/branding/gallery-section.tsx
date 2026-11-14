import { cn } from "cn";
import { CheckIcon, HardDriveIcon, MinusIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  AddTile,
  BrandPicture,
  BrandSection,
  DropTarget,
  FileMenu,
  PendingTile,
  useFilePicker,
} from "@/features/branding/brand-parts";
import type { Sortable } from "@/features/branding/sortable-parts";
import { SortableParts } from "@/features/branding/sortable-parts";
import { useDriveContent } from "@/hooks/use-drive";
import { fileSource } from "@/lib/brand-files";
import type { BrandUpload } from "@/lib/brand-upload";
import { uploadToBrand } from "@/lib/brand-upload";
import type { Brand, BrandFile, BrandParts, HexColor } from "@/lib/brands";
import { filesOf, isShown, PAPER } from "@/lib/brands";
import type { DriveFile } from "@/lib/drive";
import { fileKind } from "@/lib/drive";
import {
  fileSource as driveFileSource,
  fetchFile,
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
  const { url } = useOpened(thumbSource(file) ?? driveFileSource(file));
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

/** Pictures in the project's Drive, picked to copy into the brand. */
function DrivePicker({
  project,
  open,
  onOpenChange,
  onPick,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (files: DriveFile[]) => void;
}) {
  const { content, loaded } = useDriveContent(project);
  const [picked, setPicked] = useState<string[]>([]);
  const pictures = content.files.filter(
    (file) => fileKind(file) === "image" && isShown(file)
  );
  return (
    <Dialog
      onOpenChange={(next) => {
        setPicked([]);
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
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
          <DialogClose render={<Button type="button" variant="ghost" />}>
            Cancel
          </DialogClose>
          <Button
            disabled={picked.length === 0}
            onClick={() => {
              onPick(pictures.filter((file) => picked.includes(file.id)));
              setPicked([]);
              onOpenChange(false);
            }}
          >
            {picked.length > 0
              ? `Add ${plural(picked.length, "picture")}`
              : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Copies Drive pictures into the brand: opened, then sealed again as the brand's own. */
async function copyFromDrive(
  project: Project,
  brand: Brand,
  kind: GalleryKind,
  files: DriveFile[]
): Promise<void> {
  const copies: File[] = [];
  for (const file of files) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one at a time, to keep memory down
      const blob = await fetchFile(file);
      copies.push(new File([blob], file.name, { type: blob.type }));
    } catch (error) {
      toast.error(`“${file.name}” couldn’t be opened.`, {
        description: errorMessage(error),
      });
    }
  }
  if (copies.length > 0) {
    await uploadToBrand(project, brand, { kind }, copies);
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
      <DrivePicker
        onOpenChange={setFromDrive}
        onPick={(picked) => copyFromDrive(project, brand, kind, picked)}
        open={fromDrive}
        project={project}
      />
    </>
  );
  return {
    add,
    dialogs,
    handleDrive: () => setFromDrive(true),
    handlePick: () => picker.open(),
  };
}

/** Upload from the computer, or copy from the Drive. */
function AddButtons({
  onUpload,
  onDrive,
}: {
  onUpload: () => void;
  onDrive: () => void;
}) {
  return (
    <>
      <Button onClick={onDrive} size="sm" variant="ghost">
        <HardDriveIcon />
        From Drive
      </Button>
      <Button onClick={onUpload} size="sm" variant="outline">
        <PlusIcon />
        Upload
      </Button>
    </>
  );
}

/** The two ways to start a gallery, side by side. */
function EmptyGallery({
  what,
  hint,
  onUpload,
  onDrive,
}: {
  what: string;
  hint: string;
  onUpload: () => void;
  onDrive: () => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <AddTile
        className="min-h-40"
        hint={hint}
        label={`Upload ${what}`}
        onClick={onUpload}
      />
      <AddTile
        className="min-h-40"
        hint="Copy pictures the project keeps in its Drive."
        label="Add from Drive"
        onClick={onDrive}
      />
    </div>
  );
}

function Illustration({
  project,
  file,
  editable,
}: {
  project: Project;
  file: BrandFile;
  editable: boolean;
}) {
  return (
    <figure
      className={cn(
        "bg-muted group/item relative overflow-hidden rounded-2xl",
        editable && "cursor-grab active:cursor-grabbing"
      )}
    >
      <BrandPicture
        className="block h-auto w-full"
        file={file}
        style={{
          aspectRatio:
            file.width && file.height
              ? `${file.width} / ${file.height}`
              : "4 / 3",
        }}
      />
      <FileMenu
        className="bg-background/85 shadow-surface absolute top-2 right-2 size-7 rounded-full opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover/item:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
        editable={editable}
        file={file}
        project={project}
      />
    </figure>
  );
}

/** The brand's illustrations, as a wall of pictures in their own shapes. */
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
  const empty = files.length + pending.length === 0;
  return (
    <BrandSection
      action={
        editable &&
        !empty && (
          <AddButtons
            onDrive={adding.handleDrive}
            onUpload={adding.handlePick}
          />
        )
      }
      id="illustrations"
    >
      <DropTarget onFiles={editable ? adding.add : undefined}>
        {empty ? (
          <EmptyGallery
            hint="Drop pictures here, or pick them."
            onDrive={adding.handleDrive}
            onUpload={adding.handlePick}
            what="illustrations"
          />
        ) : (
          <SortableParts
            className="columns-2 gap-3 lg:columns-3"
            editable={editable}
            group="illustrations"
            itemClassName="mb-3 break-inside-avoid"
            label={(file) => file.name}
            parts={files}
            project={project}
            render={(file) => (
              <Illustration
                editable={editable}
                file={file}
                key={file.id}
                project={project}
              />
            )}
          >
            {pending.map((upload) => (
              <PendingTile
                className="mb-3 aspect-[4/3] break-inside-avoid"
                key={upload.id}
                upload={upload}
              />
            ))}
          </SortableParts>
        )}
      </DropTarget>
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
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
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
  const empty = files.length + pending.length === 0;

  let body: ReactNode = (
    <SortableParts
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
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
        <PendingTile className="aspect-[4/3]" key={upload.id} upload={upload} />
      ))}
    </SortableParts>
  );
  if (empty) {
    body = (
      <EmptyGallery
        hint="Seamless tiles repeat here as they would in use."
        onDrive={adding.handleDrive}
        onUpload={adding.handlePick}
        what="patterns"
      />
    );
  }

  return (
    <BrandSection
      action={
        <>
          {files.length > 0 && (
            <PatternControls
              background={backgroundAt}
              backgrounds={backgrounds}
              onBackground={setBackgroundAt}
              onScale={setScaleAt}
              scaleAt={scaleAt}
            />
          )}
          {editable && !empty && (
            <AddButtons
              onDrive={adding.handleDrive}
              onUpload={adding.handlePick}
            />
          )}
        </>
      }
      id="patterns"
    >
      <DropTarget onFiles={editable ? adding.add : undefined}>
        {body}
      </DropTarget>
      {editable && adding.dialogs}
    </BrandSection>
  );
}
