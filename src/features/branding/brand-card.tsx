import { cn } from "cn";
import { PlusIcon, SwatchBookIcon } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { CARD_SURFACE } from "@/features/boards/board-card";
import { BrandPicture } from "@/features/branding/brand-parts";
import { brandPath } from "@/features/branding/branding-context";
import type { Brand, BrandParts, BrandsContent } from "@/lib/brands";
import {
  cssFamily,
  NO_PARTS,
  paletteGradient,
  pickMark,
  textFonts,
  textOn,
} from "@/lib/brands";
import type { Project } from "@/lib/project";

/** Where a logo made for each background is shown: on that background. */
export const MODE_BACKGROUNDS = { dark: "#0b0c0f", light: "#ffffff" } as const;

/**
 * The logo that stands for the brand, on the background it's drawn for, or
 * its initial on its first color, set in its heading type.
 */
export function BrandMark({
  brand,
  parts,
  className,
}: {
  brand: Brand;
  parts: BrandParts;
  className?: string;
}) {
  const mark = pickMark(parts.files);
  const [first] = parts.colors;
  const { heading } = textFonts(parts.fonts);
  if (mark) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden",
          className
        )}
        style={{ background: MODE_BACKGROUNDS[mark.mode] }}
      >
        <BrandPicture className="size-[72%]" file={mark.file} original />
      </span>
    );
  }
  const initial = [...brand.title.trim()][0]?.toUpperCase() ?? "?";
  return (
    <span
      aria-hidden
      className={cn(
        "bg-muted text-foreground flex shrink-0 items-center justify-center font-semibold select-none",
        className
      )}
      style={
        first
          ? {
              background: first.hex,
              color: textOn(first.hex),
              fontFamily: heading ? cssFamily(heading) : undefined,
            }
          : { fontFamily: heading ? cssFamily(heading) : undefined }
      }
    >
      {initial}
    </span>
  );
}

/** A wash of the brand's colors, or a quiet one before it has any. */
export function BrandCover({
  parts,
  className,
}: {
  parts: BrandParts;
  className?: string;
}) {
  const gradient = paletteGradient(parts.colors);
  return (
    <div
      aria-hidden
      className={cn("bg-muted", className)}
      style={gradient ? { backgroundImage: gradient } : undefined}
    />
  );
}

function BrandCard({
  project,
  brand,
  parts,
}: {
  project: Project;
  brand: Brand;
  parts: BrandParts;
}) {
  return (
    <Link
      className={cn(CARD_SURFACE, "gap-0 overflow-hidden p-0")}
      href={brandPath(project, brand)}
    >
      <BrandCover className="h-20" parts={parts} />
      <div className="flex flex-1 flex-col gap-1.5 px-4 pb-4">
        <BrandMark
          brand={brand}
          className="ring-card -mt-6 mb-1 size-12 rounded-xl text-lg ring-4"
          parts={parts}
        />
        <h3 className="min-w-0 truncate leading-snug font-medium">
          {brand.title}
        </h3>
        {brand.description && (
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {brand.description}
          </p>
        )}
      </div>
    </Link>
  );
}

export function BrandGrid({
  project,
  content,
}: {
  project: Project;
  content: BrandsContent;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {content.brands.map((brand) => (
        <BrandCard
          brand={brand}
          key={brand.id}
          parts={content.parts.get(brand.id) ?? NO_PARTS}
          project={project}
        />
      ))}
    </div>
  );
}

/** Where brands would be: a way to start one, for whoever can. */
export function NoBrands({
  editable,
  onNew,
}: {
  editable: boolean;
  onNew: () => void;
}) {
  return (
    <Empty>
      <SwatchBookIcon
        aria-hidden
        className="text-muted-foreground size-8"
        strokeWidth={1.5}
      />
      <EmptyTitle>No brands yet</EmptyTitle>
      <EmptyDescription>
        {editable
          ? "Keep logos, colors, typefaces and how to use them in one place."
          : "Brands in this project show up here."}
      </EmptyDescription>
      {editable && (
        <Button onClick={onNew}>
          <PlusIcon />
          New brand
        </Button>
      )}
    </Empty>
  );
}
