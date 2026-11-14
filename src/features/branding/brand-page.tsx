import type { NostrEvent } from "applesauce-core/helpers/event";
import {
  EllipsisIcon,
  PlusIcon,
  PackageIcon,
  SwatchBookIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { IconButton } from "@/components/icon-button";
import { ProjectAvatar } from "@/components/project-avatar";
import { TopBar } from "@/components/top-bar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { DeleteBrandDialog } from "@/features/branding/brand-dialog";
import { BrandHero } from "@/features/branding/brand-hero";
import type { ChapterId } from "@/features/branding/brand-parts";
import { brandingPath } from "@/features/branding/branding-context";
import { ChapterRail } from "@/features/branding/chapter-rail";
import { ColorsSection } from "@/features/branding/colors-section";
import { ExamplesSection } from "@/features/branding/examples-section";
import { FontDialog } from "@/features/branding/font-dialog";
import {
  IllustrationsSection,
  PatternsSection,
} from "@/features/branding/gallery-section";
import { GuideSection } from "@/features/branding/guide-section";
import { LogosSection } from "@/features/branding/logos-section";
import { MockupsSection } from "@/features/branding/mockups-section";
import { TypeSection } from "@/features/branding/type-section";
import { PinButton } from "@/features/home/pin-controls";
import { hasBlossom } from "@/lib/blossom";
import { useBrandFonts } from "@/lib/brand-files";
import { downloadKit } from "@/lib/brand-kit";
import type { BrandUpload } from "@/lib/brand-upload";
import { useBrandUploads } from "@/lib/brand-upload";
import type { Brand, BrandFont, BrandParts } from "@/lib/brands";
import { filesOf } from "@/lib/brands";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";

/** Marks the page while files from the computer are dragged over it, so every place to drop them shows. */
function useDraggingFiles(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const root = document.documentElement;
    let depth = 0;
    const set = (on: boolean) => {
      if (on) {
        root.dataset.draggingFiles = "";
      } else {
        delete root.dataset.draggingFiles;
      }
    };
    const end = () => {
      depth = 0;
      set(false);
    };
    const carries = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files") ?? false;
    const enter = (event: DragEvent) => {
      if (carries(event)) {
        depth += 1;
        set(true);
      }
    };
    // Files let go between drop targets would open in the tab instead.
    const over = (event: DragEvent) => {
      if (carries(event)) {
        event.preventDefault();
      }
    };
    const drop = (event: DragEvent) => {
      if (carries(event)) {
        event.preventDefault();
      }
      end();
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        set(false);
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragend", end);
      set(false);
    };
  }, [enabled]);
}

/**
 * The chapters to show, in order: all of them for whoever can fill them in
 * (files only where the team keeps them), and only what's filled in for
 * everyone else. "In use" needs something to draw with.
 */
function shownChapters(
  brand: Brand,
  parts: BrandParts,
  editable: boolean
): ChapterId[] {
  const files = hasBlossom();
  const filled: Record<ChapterId, boolean> = {
    colors: parts.colors.length > 0,
    examples: filesOf(parts.files, "example").length > 0,
    guidelines: brand.guide.trim() !== "",
    illustrations: filesOf(parts.files, "illustration").length > 0,
    "in-use":
      parts.colors.length + parts.fonts.length > 0 ||
      filesOf(parts.files, "logo").length > 0,
    logos: filesOf(parts.files, "logo").length > 0,
    patterns: filesOf(parts.files, "pattern").length > 0,
    typography: parts.fonts.length > 0,
  };
  const order: ChapterId[] = [
    ...(files ? (["logos"] as const) : []),
    "colors",
    "typography",
    ...(files ? (["illustrations", "patterns", "examples"] as const) : []),
    "guidelines",
    "in-use",
  ];
  return order.filter((id) => filled[id] || (editable && id !== "in-use"));
}

/** One chapter of the brand's page, by its id. */
function Chapter({
  id,
  project,
  brand,
  parts,
  uploads,
  versions,
  editable,
  pubkey,
  onEditFont,
}: {
  id: ChapterId;
  project: Project;
  brand: Brand;
  parts: BrandParts;
  uploads: BrandUpload[];
  versions: NostrEvent[];
  editable: boolean;
  pubkey: string;
  onEditFont: (font?: BrandFont) => void;
}) {
  const shared = { brand, editable, parts, project, uploads };
  switch (id) {
    case "logos": {
      return <LogosSection {...shared} files={parts.files} />;
    }
    case "colors": {
      return <ColorsSection {...shared} />;
    }
    case "typography": {
      return <TypeSection {...shared} onEdit={onEditFont} />;
    }
    case "illustrations": {
      return <IllustrationsSection {...shared} />;
    }
    case "patterns": {
      return <PatternsSection {...shared} />;
    }
    case "examples": {
      return <ExamplesSection {...shared} />;
    }
    case "guidelines": {
      return (
        <GuideSection
          brand={brand}
          editable={editable}
          project={project}
          pubkey={pubkey}
          versions={versions}
        />
      );
    }
    default: {
      return <MockupsSection brand={brand} parts={parts} />;
    }
  }
}

/**
 * A brand as its guidelines: logos for every background, colors with their
 * values, typefaces set in themselves, illustrations, patterns, do's and
 * don'ts, written guidelines and the brand in use. Whoever can edit the
 * project fills each part in place; everyone else reads what's there.
 */
export function BrandPage({
  project,
  brand,
  parts,
  versions,
  alone,
  pubkey,
  onNew,
}: {
  project: Project;
  brand: Brand;
  parts: BrandParts;
  /** Each member's newest version of the brand, to merge guidelines edited at once. */
  versions: NostrEvent[];
  /** The project's only brand, with no list of them to go back to. */
  alone: boolean;
  pubkey: string;
  /** Starts another brand in the project. */
  onNew: () => void;
}) {
  const editable = canEdit(project, pubkey);
  const uploads = useBrandUploads(brand.id);
  const [font, setFont] = useState<BrandFont>();
  const [fontOpen, setFontOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useBrandFonts(parts.fonts, parts.files);
  useDraggingFiles(editable && hasBlossom());

  const editFont = (picked?: BrandFont) => {
    setFont(picked);
    setFontOpen(true);
  };
  const chapters = shownChapters(brand, parts, editable);
  const empty =
    parts.colors.length + parts.fonts.length + parts.files.length === 0 &&
    !brand.guide.trim();
  return (
    <>
      <TopBar
        crumbs={[
          {
            href: `/p/${project.slug}`,
            icon: <ProjectAvatar project={project} />,
            label: project.title,
          },
          ...(alone
            ? []
            : [
                {
                  href: brandingPath(project),
                  icon: (
                    <SwatchBookIcon className="text-muted-foreground size-4 shrink-0" />
                  ),
                  label: "Branding",
                },
              ]),
          { label: brand.title },
        ]}
      >
        <FluidTooltip.Group>
          <PinButton
            pin={{ id: brand.id, project: project.address, type: "brand" }}
          />
          {!empty && (
            <IconButton
              label="Download brand kit"
              onClick={() => downloadKit(brand, parts)}
            >
              <PackageIcon />
            </IconButton>
          )}
        </FluidTooltip.Group>
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <IconButton label="More">
                  <EllipsisIcon />
                </IconButton>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onNew}>
                <PlusIcon />
                New brand
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleting(true)}
                variant="destructive"
              >
                <Trash2Icon />
                Delete brand
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TopBar>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 pt-4 pb-24 sm:px-6">
        <BrandHero
          brand={brand}
          editable={editable}
          parts={parts}
          project={project}
        />
        <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[9rem_minmax(0,1fr)]">
          <ChapterRail chapters={chapters} />
          <div className="flex min-w-0 flex-col gap-14 lg:col-start-2">
            {chapters.map((id) => (
              <Chapter
                brand={brand}
                editable={editable}
                id={id}
                key={id}
                onEditFont={editFont}
                parts={parts}
                project={project}
                pubkey={pubkey}
                uploads={uploads}
                versions={versions}
              />
            ))}
          </div>
        </div>
      </main>
      {editable && (
        <>
          <FontDialog
            brand={brand}
            files={parts.files}
            font={font}
            onOpenChange={setFontOpen}
            open={fontOpen}
            project={project}
          />
          <DeleteBrandDialog
            brand={brand}
            onOpenChange={setDeleting}
            open={deleting}
            project={project}
          />
        </>
      )}
    </>
  );
}
