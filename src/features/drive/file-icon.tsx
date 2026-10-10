import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import {
  AlignLeftIcon,
  AudioLinesIcon,
  CodeXmlIcon,
  ImageIcon,
  PackageIcon,
  PenToolIcon,
  PlayIcon,
  PresentationIcon,
  Table2Icon,
} from "lucide-react";
import { useId } from "react";

import type { FileKind } from "@/lib/drive";
import { extensionOf, fileKind } from "@/lib/drive";
import type { Color } from "@/lib/palette";

/** Each kind's color, its glyph, and a tint for the space around its icon. */
const KINDS: Record<
  FileKind,
  { color: string; tint: string; glyph?: LucideIcon }
> = {
  archive: {
    color: "text-amber-600 dark:text-amber-500",
    glyph: PackageIcon,
    tint: "bg-amber-500/8",
  },
  audio: {
    color: "text-fuchsia-500",
    glyph: AudioLinesIcon,
    tint: "bg-fuchsia-500/8",
  },
  code: { color: "text-teal-500", glyph: CodeXmlIcon, tint: "bg-teal-500/8" },
  design: {
    color: "text-purple-500",
    glyph: PenToolIcon,
    tint: "bg-purple-500/8",
  },
  doc: { color: "text-blue-500", glyph: AlignLeftIcon, tint: "bg-blue-500/8" },
  file: {
    color: "text-neutral-400 dark:text-neutral-500",
    tint: "bg-foreground/4",
  },
  image: { color: "text-pink-500", glyph: ImageIcon, tint: "bg-pink-500/8" },
  pdf: { color: "text-red-500", glyph: AlignLeftIcon, tint: "bg-red-500/8" },
  sheet: {
    color: "text-emerald-500",
    glyph: Table2Icon,
    tint: "bg-emerald-500/8",
  },
  slides: {
    color: "text-orange-500",
    glyph: PresentationIcon,
    tint: "bg-orange-500/8",
  },
  text: {
    color: "text-slate-500 dark:text-slate-400",
    glyph: AlignLeftIcon,
    tint: "bg-slate-500/8",
  },
  video: { color: "text-violet-500", glyph: PlayIcon, tint: "bg-violet-500/8" },
};

/** The tint behind a file that has no picture of its own. */
export function kindTint(file: { name: string; type: string }): string {
  return KINDS[fileKind(file)].tint;
}

const SIZES = {
  lg: { badge: "text-[0.5625rem] px-1 rounded-[3px]", box: "h-14 w-[2.9rem]" },
  md: {
    badge: "text-[0.4375rem] px-0.5 rounded-[2px]",
    box: "h-9 w-[1.85rem]",
  },
  sm: { box: "h-5 w-[1.05rem]" },
  xl: {
    badge: "text-[0.8125rem] px-1.5 rounded-[5px]",
    box: "h-24 w-[4.95rem]",
  },
} as const;

type IconSize = keyof typeof SIZES;

/**
 * A file as a page with its corner folded, tinted in its kind's color, with
 * what it holds drawn on it and its extension on a tab, like "PDF".
 */
export function FileIcon({
  file,
  size = "md",
  className,
}: {
  file: { name: string; type: string };
  size?: IconSize;
  className?: string;
}) {
  const kind = fileKind(file);
  const { color, glyph: Glyph } = KINDS[kind];
  const extension = extensionOf(file.name).slice(0, 4).toUpperCase();
  const sizing = SIZES[size];
  const badge = "badge" in sizing && extension ? sizing.badge : undefined;
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0",
        sizing.box,
        color,
        className
      )}
    >
      <svg
        className="size-full overflow-visible"
        fill="none"
        viewBox="0 0 40 48"
      >
        <path
          className="fill-card"
          d="M8 1h17.2L38 13.8V41a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V7a6 6 0 0 1 6-6Z"
        />
        <path
          d="M8 1h17.2L38 13.8V41a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V7a6 6 0 0 1 6-6Z"
          fill="currentColor"
          fillOpacity={0.1}
          stroke="currentColor"
          strokeOpacity={0.45}
          strokeWidth={1.5}
        />
        <path
          d="M25.2 1v8.8a4 4 0 0 0 4 4H38"
          fill="currentColor"
          fillOpacity={0.28}
          stroke="currentColor"
          strokeLinejoin="round"
          strokeOpacity={0.45}
          strokeWidth={1.5}
        />
      </svg>
      {Glyph && (
        <Glyph
          className={cn(
            "absolute left-[46%] size-[44%] -translate-x-1/2 -translate-y-1/2",
            badge ? "top-[44%]" : "top-[58%]",
            Glyph === PlayIcon && "fill-current"
          )}
          strokeWidth={size === "sm" ? 2.75 : 2.25}
        />
      )}
      {badge && (
        <span
          className={cn(
            "absolute bottom-[12%] -left-[10%] bg-current leading-[1.45] font-bold tracking-wide shadow-sm",
            badge
          )}
        >
          <span className="text-white">{extension}</span>
        </span>
      )}
    </span>
  );
}

const FOLDER_COLORS: Record<Color, string> = {
  blue: "text-blue-500",
  gray: "text-neutral-400 dark:text-neutral-500",
  green: "text-green-500",
  orange: "text-orange-500",
  pink: "text-pink-500",
  purple: "text-violet-500",
  red: "text-red-500",
  teal: "text-teal-500",
  yellow: "text-yellow-400",
};

const FOLDER_SIZES = {
  lg: { box: "h-10 w-12", emoji: "text-base" },
  md: { box: "h-7 w-8", emoji: "text-[0.7rem]" },
  sm: { box: "h-4 w-[1.2rem]", emoji: "hidden" },
  xl: { box: "h-20 w-24", emoji: "text-3xl" },
} as const;

/**
 * A folder: its back with the tab, a lighter front over it, in the folder's
 * color, and its emoji on the front when it has one.
 */
export function FolderIcon({
  folder,
  size = "md",
  open = false,
  className,
}: {
  folder?: { color?: Color; icon?: string };
  size?: keyof typeof FOLDER_SIZES;
  /** Lifts the front a little, like a folder something is about to drop into. */
  open?: boolean;
  className?: string;
}) {
  const shine = useId();
  const sizing = FOLDER_SIZES[size];
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0",
        sizing.box,
        FOLDER_COLORS[folder?.color ?? "blue"],
        className
      )}
    >
      <svg className="size-full overflow-visible" viewBox="0 0 48 40">
        <defs>
          <linearGradient id={shine} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity={0.32} />
            <stop offset="1" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path
          d="M5 1h12.6a4 4 0 0 1 3.1 1.5L23.4 6H43a5 5 0 0 1 5 5v24a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5V6a5 5 0 0 1 5-5Z"
          fill="currentColor"
          fillOpacity={0.6}
        />
        <g
          className="origin-bottom transition-transform duration-200 ease-out"
          style={{
            transform: open ? "perspective(60px) rotateX(-14deg)" : undefined,
          }}
        >
          <path
            d="M0 16a5 5 0 0 1 5-5h38a5 5 0 0 1 5 5v19a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5Z"
            fill="currentColor"
          />
          <path
            d="M0 16a5 5 0 0 1 5-5h38a5 5 0 0 1 5 5v19a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5Z"
            fill={`url(#${shine})`}
          />
        </g>
      </svg>
      {folder?.icon && (
        <span
          className={cn(
            "absolute inset-x-0 top-[28%] bottom-0 flex items-center justify-center leading-none",
            sizing.emoji
          )}
        >
          {folder.icon}
        </span>
      )}
    </span>
  );
}
