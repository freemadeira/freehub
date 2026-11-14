import { cn } from "cn";
import { CheckIcon, XIcon } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { updatePart } from "@/lib/brand-actions";
import type { BrandUpload } from "@/lib/brand-upload";
import { uploadToBrand } from "@/lib/brand-upload";
import type { Brand, BrandFile, BrandParts, Verdict } from "@/lib/brands";
import { filesOf, MAX_CAPTION } from "@/lib/brands";
import type { Project } from "@/lib/project";

const VERDICT_NAMES: Record<Verdict, string> = { do: "Do", dont: "Don’t" };

function verdictOf(file: BrandFile): Verdict {
  return file.place.kind === "example" ? file.place.verdict : "do";
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={cn(
        "shadow-surface pointer-events-none absolute top-3 left-3 flex h-7 items-center gap-1 rounded-full pr-3 pl-2 text-xs font-semibold text-white",
        verdict === "do" ? "bg-emerald-600" : "bg-red-600"
      )}
    >
      {verdict === "do" ? (
        <CheckIcon aria-hidden className="size-3.5" strokeWidth={3} />
      ) : (
        <XIcon aria-hidden className="size-3.5" strokeWidth={3} />
      )}
      {VERDICT_NAMES[verdict]}
    </span>
  );
}

/** What the example shows, in a line; typed in place by whoever can. */
function Caption({
  project,
  file,
  editable,
}: {
  project: Project;
  file: BrandFile;
  editable: boolean;
}) {
  const [typed, setTyped] = useState<string>();
  if (!editable) {
    return file.caption ? (
      <figcaption className="px-4 pt-3 pb-4 text-sm text-pretty">
        {file.caption}
      </figcaption>
    ) : null;
  }
  return (
    <figcaption className="px-2.5 pt-1.5 pb-2.5">
      <input
        aria-label="What it shows"
        className="placeholder:text-muted-foreground/60 hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] w-full rounded-lg bg-transparent px-1.5 py-1.5 text-sm transition-colors duration-150 outline-none"
        maxLength={MAX_CAPTION}
        onBlur={() => {
          if (typed !== undefined && typed.trim() !== file.caption) {
            updatePart(project, file, { caption: typed.trim() });
          }
          setTyped(undefined);
        }}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setTyped(undefined);
            event.currentTarget.blur();
          }
        }}
        placeholder="What it shows"
        value={typed ?? file.caption}
      />
    </figcaption>
  );
}

function Example({
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
  const verdict = verdictOf(file);
  const other: Verdict = verdict === "do" ? "dont" : "do";
  return (
    <figure className="bg-card shadow-surface group/item flex h-full flex-col overflow-hidden rounded-2xl">
      <div className="bg-muted relative aspect-[4/3]">
        <button
          aria-label={`Look at ${file.caption || file.name}`}
          className="focus-visible:ring-ring/50 size-full cursor-zoom-in p-4 outline-none focus-visible:ring-3 focus-visible:ring-inset"
          onClick={onOpen}
          type="button"
        >
          <BrandPicture className="size-full" file={file} />
        </button>
        <VerdictBadge verdict={verdict} />
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
          {sortable.handle}
          <FileMenu
            className="bg-background/85 shadow-surface size-7 rounded-full backdrop-blur-sm"
            editable={editable}
            edits={
              <DropdownMenuItem
                onClick={() =>
                  updatePart(project, file, {
                    place: { kind: "example", verdict: other },
                  })
                }
              >
                {other === "do" ? <CheckIcon /> : <XIcon />}
                Make it a {VERDICT_NAMES[other].toLowerCase()}
              </DropdownMenuItem>
            }
            file={file}
            project={project}
          />
        </div>
      </div>
      <Caption editable={editable} file={file} project={project} />
    </figure>
  );
}

/** Pictures of the brand used well and badly, each saying which and why. */
export function ExamplesSection({
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
  const files = filesOf(parts.files, "example");
  const pending = uploads.filter((upload) => upload.place.kind === "example");
  const [open, setOpen] = useState<number>();
  const add = (verdict: Verdict) => (picked: File[]) =>
    uploadToBrand(project, brand, { kind: "example", verdict }, picked);
  const dos = useFilePicker(add("do"), { accept: "image/*" });
  const donts = useFilePicker(add("dont"), { accept: "image/*" });

  return (
    <BrandSection id="examples">
      <DropTarget onFiles={editable ? add("do") : undefined}>
        <SortableParts
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          editable={editable}
          group="examples"
          handleClassName="bg-background/85 shadow-surface size-7 backdrop-blur-sm"
          label={(file) => file.caption || file.name}
          parts={files}
          project={project}
          render={(file, sortable) => (
            <Example
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
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<AddTile className="min-h-40" label="Add an example" />}
              />
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => dos.open()}>
                  <CheckIcon />
                  A do
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => donts.open()}>
                  <XIcon />
                  A don’t
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
      {dos.input}
      {donts.input}
    </BrandSection>
  );
}
