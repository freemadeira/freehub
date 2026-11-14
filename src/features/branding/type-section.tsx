import {
  DownloadIcon,
  ExternalLinkIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  AddTile,
  BrandSection,
  DropTarget,
  useFilePicker,
} from "@/features/branding/brand-parts";
import type { Sortable } from "@/features/branding/sortable-parts";
import { SortableParts } from "@/features/branding/sortable-parts";
import { downloadFontFiles } from "@/lib/brand-kit";
import type { BrandUpload } from "@/lib/brand-upload";
import { uploadToBrand } from "@/lib/brand-upload";
import type { Brand, BrandFile, BrandFont, BrandParts } from "@/lib/brands";
import {
  cssFamily,
  filesIn,
  fontWeights,
  libraryFontPage,
  MAX_FONTS,
  WEIGHT_NAMES,
} from "@/lib/brands";
import type { Project } from "@/lib/project";
import { plural } from "@/lib/utils";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789";
const SAMPLE = "Sphinx of black quartz, judge my vow.";

/** A typeface set in itself: its name, its letters, and every weight it's used in. */
function Specimen({
  project,
  brand,
  font,
  files,
  uploads,
  editable,
  sortable,
  onEdit,
}: {
  project: Project;
  brand: Brand;
  font: BrandFont;
  files: BrandFile[];
  uploads: BrandUpload[];
  editable: boolean;
  sortable: Sortable;
  onEdit: () => void;
}) {
  const family = cssFamily(font);
  const weights = fontWeights(font, files);
  const own = filesIn(files, { font: font.id, kind: "font" });
  const pending = uploads.filter(
    (upload) => upload.place.kind === "font" && upload.place.font === font.id
  ).length;
  const place = { font: font.id, kind: "font" } as const;
  const add = (picked: File[]) => uploadToBrand(project, brand, place, picked);
  const picker = useFilePicker(add, { accept: ".woff2,.woff,.otf,.ttf" });
  const uploaded = font.source === "file";

  return (
    <DropTarget onFiles={editable && uploaded ? add : undefined}>
      <article className="bg-card shadow-surface flex flex-col gap-6 overflow-hidden rounded-2xl p-5 sm:p-7">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="truncate text-lg font-medium">{font.family}</h3>
            <p className="text-muted-foreground text-sm">
              {[
                font.role,
                uploaded ? plural(own.length, "file") : "Font library",
              ]
                .filter(Boolean)
                .join(" · ")}
              {pending > 0 && ` · uploading ${pending}`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {uploaded ? (
              own.length > 0 && (
                <Button
                  onClick={() => downloadFontFiles(font.family, own)}
                  size="sm"
                  variant="ghost"
                >
                  <DownloadIcon />
                  Download
                </Button>
              )
            ) : (
              <a
                className={buttonVariants({ size: "sm", variant: "ghost" })}
                href={libraryFontPage(font.family)}
                rel="noopener noreferrer"
                target="_blank"
              >
                <ExternalLinkIcon />
                Get it
              </a>
            )}
            {editable && uploaded && (
              <Button
                aria-label="Add font files"
                onClick={() => picker.open()}
                size="icon-sm"
                variant="ghost"
              >
                <PlusIcon />
              </Button>
            )}
            {editable && (
              <>
                <Button
                  aria-label={`Edit ${font.family}`}
                  onClick={onEdit}
                  size="icon-sm"
                  variant="ghost"
                >
                  <PencilIcon />
                </Button>
                {sortable.handle}
              </>
            )}
          </div>
        </header>
        <div
          className="grid gap-6 md:grid-cols-[auto_1fr] md:items-end"
          style={{ fontFamily: family }}
        >
          <span aria-hidden className="text-8xl leading-none sm:text-9xl">
            Aa
          </span>
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-2xl leading-snug text-balance sm:text-3xl">
              {SAMPLE}
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed break-words">
              {ALPHABET}
            </p>
          </div>
        </div>
        {weights.length > 0 && (
          <ul
            className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-4"
            style={{ fontFamily: family }}
          >
            {weights.map((weight) => (
              <li className="flex items-baseline gap-2" key={weight}>
                <span className="text-xl" style={{ fontWeight: weight }}>
                  Ag
                </span>
                <span className="text-muted-foreground font-sans text-xs">
                  {WEIGHT_NAMES[weight] ?? weight}
                </span>
              </li>
            ))}
          </ul>
        )}
        {picker.input}
      </article>
    </DropTarget>
  );
}

/** The brand's typefaces, each set in itself. */
export function TypeSection({
  project,
  brand,
  parts,
  uploads,
  editable,
  onEdit,
}: {
  project: Project;
  brand: Brand;
  parts: BrandParts;
  uploads: BrandUpload[];
  editable: boolean;
  /** Opens a typeface to change, or a new one without. */
  onEdit: (font?: BrandFont) => void;
}) {
  const { fonts, files } = parts;
  return (
    <BrandSection
      action={
        editable &&
        fonts.length > 0 &&
        fonts.length < MAX_FONTS && (
          <Button onClick={() => onEdit()} size="sm" variant="outline">
            <PlusIcon />
            Add typeface
          </Button>
        )
      }
      id="typography"
    >
      <SortableParts
        className="flex flex-col gap-3"
        editable={editable}
        group="fonts"
        handleClassName="text-muted-foreground hover:text-foreground size-8"
        label={(font) => font.family}
        parts={fonts}
        project={project}
        render={(font, sortable) => (
          <Specimen
            brand={brand}
            editable={editable}
            files={files}
            font={font}
            key={font.id}
            onEdit={() => onEdit(font)}
            project={project}
            sortable={sortable}
            uploads={uploads}
          />
        )}
      >
        {editable && fonts.length === 0 && (
          <AddTile
            className="min-h-40"
            hint="From the font library, or the brand’s own files."
            label="Add typeface"
            onClick={() => onEdit()}
          />
        )}
      </SortableParts>
    </BrandSection>
  );
}
