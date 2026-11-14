import { cn } from "cn";
import {
  ChevronDownIcon,
  CodeIcon,
  DownloadIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MODE_BACKGROUNDS } from "@/features/branding/brand-card";
import {
  BrandPicture,
  BrandSection,
  DropTarget,
  PendingTile,
  useFilePicker,
} from "@/features/branding/brand-parts";
import { removePart } from "@/lib/brand-actions";
import {
  copySvg,
  downloadBrandFile,
  downloadLogos,
  isSvg,
  logoBase,
} from "@/lib/brand-kit";
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
  sameBrandPlace,
  shownFile,
} from "@/lib/brands";
import type { Project } from "@/lib/project";

const LOGO_NAMES: Record<LogoKind, string> = {
  icon: "App icon",
  lockup: "Lockup",
  symbol: "Symbol",
  wordmark: "Wordmark",
};

/** What each logo is, for whoever wonders. */
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

/** Square logos sit four to a row; wide ones two, or one on a phone. */
const GROUPS: { kinds: LogoKind[]; grid: string; tile: string }[] = [
  {
    grid: "grid-cols-2 lg:grid-cols-4",
    kinds: ["symbol", "icon"],
    tile: "aspect-square",
  },
  {
    grid: "grid-cols-1 sm:grid-cols-2",
    kinds: ["lockup"],
    tile: "aspect-[5/2]",
  },
  {
    grid: "grid-cols-1 sm:grid-cols-2",
    kinds: ["wordmark"],
    tile: "aspect-[5/2]",
  },
];

/** Logos come in as most files of them do: vectors, images, print files. */
const ACCEPT = "image/*,.svg,.pdf,.eps,.ai";

/** Text and chips readable on the background the logo is drawn for. */
const INK: Record<LogoMode, string> = {
  dark: "text-white/70",
  light: "text-black/65",
};

const CHIP: Record<LogoMode, string> = {
  dark: "bg-white/12 text-white/85 hover:bg-white/20 data-popup-open:bg-white/20",
  light:
    "bg-black/6 text-black/75 hover:bg-black/10 data-popup-open:bg-black/10",
};

/** The logo's formats in one menu: each to download, SVG code to copy, more to add or take off. */
function FormatsMenu({
  project,
  brand,
  files,
  logo,
  mode,
  editable,
  onAdd,
}: {
  project: Project;
  brand: Brand;
  files: BrandFile[];
  logo: LogoKind;
  mode: LogoMode;
  editable: boolean;
  /** Missing once the slot keeps as many formats as it can. */
  onAdd?: () => void;
}) {
  const [first, ...rest] = files.map(formatOf);
  const base = logoBase(brand, logo, mode);
  const named = (file: BrandFile) => {
    const extension = extensionOf(file.name);
    return extension ? `${base}.${extension}` : base;
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Formats of the ${LOGO_NAMES[logo].toLowerCase()} ${MODE_NAMES[mode].toLowerCase()}`}
        className={cn(
          "focus-visible:ring-ring/50 flex h-6 items-center gap-0.5 rounded-full pr-1.5 pl-2.5 font-mono text-[11px] font-medium tracking-wide backdrop-blur-sm transition-colors duration-150 ease-out outline-none focus-visible:ring-3",
          CHIP[mode]
        )}
      >
        {first}
        {rest.length > 0 && <span className="opacity-60">+{rest.length}</span>}
        <ChevronDownIcon aria-hidden className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {files.map((file) => (
          <DropdownMenuItem
            key={file.id}
            onClick={() => downloadBrandFile(file, named(file))}
          >
            <DownloadIcon />
            Download {formatOf(file)}
          </DropdownMenuItem>
        ))}
        {files.filter(isSvg).map((file) => (
          <DropdownMenuItem
            key={`${file.id}-code`}
            onClick={() => copySvg(file)}
          >
            <CodeIcon />
            Copy SVG code
          </DropdownMenuItem>
        ))}
        {editable && (
          <>
            <DropdownMenuSeparator />
            {onAdd && (
              <DropdownMenuItem onClick={onAdd}>
                <PlusIcon />
                Add a format
              </DropdownMenuItem>
            )}
            {files.map((file) => (
              <DropdownMenuItem
                key={`${file.id}-remove`}
                onClick={() => removePart(project, file)}
                variant="destructive"
              >
                <Trash2Icon />
                Remove {formatOf(file)}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  const pending = uploads.filter((upload) =>
    sameBrandPlace(upload.place, place)
  );
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
          className="border-foreground/15 text-muted-foreground hover:border-foreground/30 hover:bg-foreground/[0.02] hover:text-foreground focus-visible:ring-ring/50 flex size-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed p-3 text-center text-sm transition-colors duration-150 ease-out outline-none focus-visible:ring-3"
          onClick={() => picker.open()}
          title={LOGO_HINTS[logo]}
          type="button"
        >
          {/* The background it's drawn for, as a small swatch. */}
          <span
            aria-hidden
            className="image-outline size-4 rounded-full"
            style={{ background: MODE_BACKGROUNDS[mode] }}
          />
          <span className="text-foreground font-medium">
            {LOGO_NAMES[logo]}
          </span>
          <span className="text-xs">{MODE_NAMES[mode]}</span>
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
            {own.map(formatOf).join(" · ")}
          </span>
        )}
        <figcaption
          className={cn(
            "absolute top-3 left-3.5 text-xs font-medium",
            INK[mode]
          )}
          title={LOGO_HINTS[logo]}
        >
          {label}
        </figcaption>
        <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">
          {firstPending && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                CHIP[mode]
              )}
            >
              {Math.round(firstPending.progress * 100)}%
            </span>
          )}
          <FormatsMenu
            brand={brand}
            editable={editable}
            files={own}
            logo={logo}
            mode={mode}
            onAdd={
              own.length + pending.length < MAX_SLOT_FILES
                ? () => picker.open()
                : undefined
            }
            project={project}
          />
        </div>
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
