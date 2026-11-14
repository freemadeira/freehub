import { cn } from "cn";
import { DownloadIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MODE_BACKGROUNDS } from "@/features/branding/brand-card";
import {
  BrandPicture,
  BrandSection,
  DropTarget,
  FileMenu,
  PendingTile,
  useFilePicker,
} from "@/features/branding/brand-parts";
import { downloadLogos, logoBase } from "@/lib/brand-kit";
import type { BrandUpload } from "@/lib/brand-upload";
import { uploadToBrand } from "@/lib/brand-upload";
import type { Brand, BrandFile, LogoKind, LogoMode } from "@/lib/brands";
import {
  extensionOf,
  filesIn,
  filesOf,
  formatOf,
  LOGO_MODES,
  MAX_SLOT_FILES,
  samePlace,
  shownFile,
} from "@/lib/brands";
import type { Project } from "@/lib/project";

const LOGO_NAMES: Record<LogoKind, string> = {
  icon: "App icon",
  lockup: "Lockup",
  symbol: "Symbol",
  wordmark: "Wordmark",
};

/** What each logo is, for whoever fills its slot. */
const LOGO_HINTS: Record<LogoKind, string> = {
  icon: "Square, for apps and favicons",
  lockup: "Symbol and name together",
  symbol: "The mark on its own",
  wordmark: "The name, lettered",
};

const MODE_NAMES: Record<LogoMode, string> = {
  dark: "On dark",
  light: "On light",
};

/** Square logos sit four to a row; wide ones two. */
const GROUPS: { kinds: LogoKind[]; grid: string; tile: string }[] = [
  {
    grid: "grid-cols-2 lg:grid-cols-4",
    kinds: ["symbol", "icon"],
    tile: "aspect-square",
  },
  {
    grid: "grid-cols-2",
    kinds: ["lockup"],
    tile: "aspect-[5/2]",
  },
  {
    grid: "grid-cols-2",
    kinds: ["wordmark"],
    tile: "aspect-[5/2]",
  },
];

/** Logos come in as most files of them do: vectors, images, print files. */
const ACCEPT = "image/*,.svg,.pdf,.eps,.ai";

/** Text and chips readable on the background the logo is drawn for. */
const INK: Record<LogoMode, string> = {
  dark: "text-white/60",
  light: "text-black/50",
};

const CHIP: Record<LogoMode, string> = {
  dark: "bg-white/12 text-white/85 hover:bg-white/20",
  light: "bg-black/6 text-black/70 hover:bg-black/10",
};

/** A logo on the background it's made for, with its formats; a place to drop it while empty. */
function LogoTile({
  project,
  brand,
  files,
  uploads,
  logo,
  mode,
  editable,
  className,
}: {
  project: Project;
  brand: Brand;
  files: BrandFile[];
  uploads: BrandUpload[];
  logo: LogoKind;
  mode: LogoMode;
  editable: boolean;
  className: string;
}) {
  const place = { kind: "logo", logo, mode } as const;
  const own = filesIn(files, place);
  const pending = uploads.filter((upload) => samePlace(upload.place, place));
  const shown = shownFile(own);
  const add = (picked: File[]) => uploadToBrand(project, brand, place, picked);
  const picker = useFilePicker(add, { accept: ACCEPT });
  const label = `${LOGO_NAMES[logo]} · ${MODE_NAMES[mode]}`;
  const [firstPending] = pending;

  if (own.length === 0 && firstPending) {
    return <PendingTile className={className} upload={firstPending} />;
  }
  if (own.length === 0) {
    return (
      <DropTarget className={className} onFiles={add}>
        <button
          aria-label={`Add ${label.toLowerCase()}`}
          className={cn(
            "focus-visible:ring-ring/50 flex size-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed p-4 text-center text-sm transition-colors duration-150 ease-out outline-none focus-visible:ring-3",
            mode === "dark"
              ? "border-white/20 text-white/55 hover:border-white/40 hover:text-white"
              : "border-black/15 text-black/50 hover:border-black/30 hover:text-black"
          )}
          onClick={() => picker.open()}
          style={{ background: MODE_BACKGROUNDS[mode] }}
          type="button"
        >
          <PlusIcon aria-hidden className="mb-1 size-4" />
          <span className="font-medium">{label}</span>
          <span className="text-xs">{LOGO_HINTS[logo]}</span>
        </button>
        {picker.input}
      </DropTarget>
    );
  }
  return (
    <DropTarget className={className} onFiles={editable ? add : undefined}>
      <figure
        className="shadow-surface relative flex size-full items-center justify-center overflow-hidden rounded-2xl"
        style={{ background: MODE_BACKGROUNDS[mode] }}
      >
        {shown ? (
          <BrandPicture className="size-full p-[18%]" file={shown} original />
        ) : (
          <span className={cn("text-sm font-medium", INK[mode])}>
            {formatOf(own[0] ?? { name: "", type: "" })}
          </span>
        )}
        <figcaption
          className={cn(
            "absolute bottom-3 left-3.5 text-xs font-medium",
            INK[mode]
          )}
        >
          {label}
        </figcaption>
        <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1">
          {own.map((file) => (
            <FileMenu
              className={cn(
                "h-6 rounded-full px-2.5 font-mono text-[11px] font-medium tracking-wide transition-colors duration-150 ease-out",
                CHIP[mode]
              )}
              editable={editable}
              file={file}
              key={file.id}
              name={`${logoBase(brand, logo, mode)}${extensionOf(file.name) ? `.${extensionOf(file.name)}` : ""}`}
              project={project}
            >
              {formatOf(file)}
            </FileMenu>
          ))}
          {editable && own.length + pending.length < MAX_SLOT_FILES && (
            <button
              aria-label={`Add another format of the ${label.toLowerCase()}`}
              className={cn(
                "focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded-full transition-colors duration-150 ease-out outline-none focus-visible:ring-3",
                CHIP[mode]
              )}
              onClick={() => picker.open()}
              type="button"
            >
              <PlusIcon aria-hidden className="size-3.5" />
            </button>
          )}
        </div>
        {firstPending && (
          <span className="bg-background/85 shadow-surface absolute top-2.5 right-2.5 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums backdrop-blur-sm">
            {Math.round(firstPending.progress * 100)}%
          </span>
        )}
      </figure>
      {picker.input}
    </DropTarget>
  );
}

/** Each logo for light and dark backgrounds, in every format there is. */
export function LogosSection({
  project,
  brand,
  files,
  uploads,
  editable,
}: {
  project: Project;
  brand: Brand;
  files: BrandFile[];
  uploads: BrandUpload[];
  editable: boolean;
}) {
  const logos = filesOf(files, "logo");
  return (
    <BrandSection
      action={
        logos.length > 0 && (
          <Button
            onClick={() => downloadLogos(brand, files)}
            size="sm"
            variant="outline"
          >
            <DownloadIcon />
            Download all
          </Button>
        )
      }
      id="logos"
    >
      <div className="flex flex-col gap-3">
        {GROUPS.map(({ kinds, grid, tile }) => {
          const slots = kinds.flatMap((logo) =>
            LOGO_MODES.map((mode) => ({ logo, mode }))
          );
          // Viewers see only the logos there are.
          const shown = editable
            ? slots
            : slots.filter(
                ({ logo, mode }) =>
                  filesIn(files, { kind: "logo", logo, mode }).length > 0
              );
          if (shown.length === 0) {
            return null;
          }
          return (
            <div className={cn("grid gap-3", grid)} key={kinds.join("-")}>
              {shown.map(({ logo, mode }) => (
                <LogoTile
                  brand={brand}
                  className={tile}
                  editable={editable}
                  files={files}
                  key={`${logo}-${mode}`}
                  logo={logo}
                  mode={mode}
                  project={project}
                  uploads={uploads}
                />
              ))}
            </div>
          );
        })}
      </div>
    </BrandSection>
  );
}
