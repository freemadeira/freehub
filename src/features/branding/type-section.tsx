import { DownloadIcon, ExternalLinkIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  AddTile,
  BrandSection,
  DropTarget,
} from "@/features/branding/brand-parts";
import type { Sortable } from "@/features/branding/sortable-parts";
import { SortableParts } from "@/features/branding/sortable-parts";
import { addFont } from "@/lib/brand-actions";
import { downloadFontFiles } from "@/lib/brand-kit";
import { uploadToBrand } from "@/lib/brand-upload";
import type { Brand, BrandFile, BrandFont, BrandParts } from "@/lib/brands";
import {
  cssFamily,
  familyOfFile,
  filesIn,
  fontWeights,
  libraryFontPage,
  MAX_FONTS,
  placeFit,
  WEIGHT_NAMES,
} from "@/lib/brands";
import type { Project } from "@/lib/project";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789";
const SAMPLE = "Sphinx of black quartz, judge my vow.";

/** A typeface set in itself: its name, its letters, and every weight it's used in. */
function Specimen({
  project,
  brand,
  font,
  files,
  editable,
  sortable,
  onEdit,
}: {
  project: Project;
  brand: Brand;
  font: BrandFont;
  files: BrandFile[];
  editable: boolean;
  sortable: Sortable;
  onEdit: () => void;
}) {
  const family = cssFamily(font);
  const weights = fontWeights(font, files);
  const own = filesIn(files, { font: font.id, kind: "font" });
  const uploaded = font.source === "file";
  const add = (picked: File[]) =>
    uploadToBrand(project, brand, { font: font.id, kind: "font" }, picked);

  return (
    <DropTarget onFiles={editable && uploaded ? add : undefined}>
      <article className="bg-card shadow-surface group/specimen flex flex-col gap-6 overflow-hidden rounded-2xl p-5 sm:p-7">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="truncate text-lg font-medium">{font.family}</h3>
            {font.role && (
              <p className="text-muted-foreground text-sm">{font.role}</p>
            )}
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
            {editable && (
              <span className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/specimen:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                <Button
                  aria-label={`Edit ${font.family}`}
                  onClick={onEdit}
                  size="icon-sm"
                  variant="ghost"
                >
                  <PencilIcon />
                </Button>
                {sortable.handle}
              </span>
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
      </article>
    </DropTarget>
  );
}

/** Font files dropped on the chapter: a new typeface of them, named as the first one says. */
async function addFamily(
  project: Project,
  brand: Brand,
  dropped: File[]
): Promise<void> {
  const { fits, misfit } = placeFit("font");
  const fonts = dropped.filter((file) =>
    fits({ name: file.name, type: file.type })
  );
  const [first] = fonts;
  if (!first) {
    toast.error(misfit);
    return;
  }
  const made = addFont(project, brand, {
    family: familyOfFile(first.name),
    role: "",
    source: "file",
    weights: [],
  });
  if (made && (await made.saved)) {
    await uploadToBrand(project, brand, { font: made.id, kind: "font" }, fonts);
  }
}

/** The brand's typefaces, each set in itself. */
export function TypeSection({
  project,
  brand,
  parts,
  editable,
  onEdit,
}: {
  project: Project;
  brand: Brand;
  parts: BrandParts;
  editable: boolean;
  /** Opens a typeface to change, or a new one without. */
  onEdit: (font?: BrandFont) => void;
}) {
  const { fonts, files } = parts;
  return (
    <BrandSection id="typography">
      <DropTarget
        onFiles={
          editable && fonts.length < MAX_FONTS
            ? (dropped) => addFamily(project, brand, dropped)
            : undefined
        }
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
            />
          )}
        >
          {editable && fonts.length < MAX_FONTS && (
            <AddTile
              className="min-h-28"
              label="Add typeface"
              onClick={() => onEdit()}
            />
          )}
        </SortableParts>
      </DropTarget>
    </BrandSection>
  );
}
