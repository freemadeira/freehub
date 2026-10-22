import { cn } from "cn";
import type { MouseEvent, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { UserAvatar } from "@/components/user-avatar";
import type { ShownLink } from "@/features/catalogs/catalog-context";
import { useCatalog, useSeenRef } from "@/features/catalogs/catalog-context";
import {
  LinkCategories,
  LinkFooter,
  LinkMedia,
  LinkThumb,
  NewDot,
  SelectBox,
  ShortWhen,
  StarButton,
  thumbAspect,
} from "@/features/catalogs/link-parts";
import { hasPicture } from "@/features/catalogs/link-picture";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import { hostOf } from "@/lib/catalogs";

/**
 * What a press on a link does: opens it over the catalog, or with Shift
 * picks it, and once some are picked, picks or unpicks it. With ⌘ or Ctrl it
 * opens where it links to, as links do.
 */
function useLinkPress(link: ShownLink) {
  const { open, toggle, selected, canEdit } = useCatalog();
  return (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      window.open(link.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (canEdit && (event.shiftKey || selected.size > 0)) {
      toggle(link, event.shiftKey);
      return;
    }
    open(link);
  };
}

/**
 * The whole card as one button under its parts, so pressing anywhere opens
 * the link while the star and the box above it stay buttons of their own.
 */
function Cover({ link, className }: { link: ShownLink; className?: string }) {
  const press = useLinkPress(link);
  return (
    <button
      aria-label={link.title}
      className={cn(
        "focus-visible:ring-ring/50 absolute inset-0 z-0 cursor-default outline-none focus-visible:ring-3",
        className
      )}
      onAuxClick={(event) => {
        if (event.button === 1) {
          window.open(link.url, "_blank", "noopener,noreferrer");
        }
      }}
      onClick={press}
      type="button"
    />
  );
}

/** A link in the gallery: its picture first, then what it is and who saved it. */
export function LinkCard({ link }: { link: ShownLink }) {
  const { selected } = useCatalog();
  const seen = useSeenRef(link);
  const picked = selected.has(link.id);
  const reading = link.state === "reading";
  return (
    <article
      className={cn(
        "group/link bg-card shadow-surface hover:shadow-raised relative isolate flex flex-col overflow-hidden rounded-2xl transition-[box-shadow,scale,opacity] duration-200 ease-out active:scale-[0.99] starting:scale-[0.97] starting:opacity-0",
        // An outline, as the surface's own shadow would cover a ring.
        picked && "outline-primary outline-2 outline-offset-2"
      )}
      ref={seen}
    >
      <Cover className="rounded-2xl" link={link} />
      <div className="pointer-events-none relative">
        <LinkMedia link={link} />
      </div>
      <div className="pointer-events-none relative flex flex-col gap-1.5 p-3.5 pt-3">
        <h3
          className={cn(
            "line-clamp-2 text-[0.9375rem] leading-snug font-medium text-pretty",
            // Until it's read, its title is its address.
            reading && "text-muted-foreground text-sm font-normal break-all"
          )}
        >
          {link.title}
        </h3>
        {reading ? (
          <output
            aria-label="Reading the page"
            className="flex flex-col gap-1.5 py-0.5"
          >
            <span className="link-reading block h-3 rounded-full" />
            <span className="link-reading block h-3 w-3/5 rounded-full" />
          </output>
        ) : (
          link.summary && (
            <p className="text-muted-foreground line-clamp-2 text-[0.8125rem] leading-snug text-pretty">
              {link.summary}
            </p>
          )
        )}
        <LinkCategories className="mt-0.5" link={link} />
        <div className="mt-0.5">
          <LinkFooter link={link} />
        </div>
      </div>
      <SelectBox className="absolute top-2.5 left-2.5 z-10" link={link} />
      <NewDot className="absolute top-3 right-3 z-10" link={link} />
    </article>
  );
}

/** A link in the list: one line of what it is, with its categories and who saved it. */
export function LinkRow({ link }: { link: ShownLink }) {
  const { selected } = useCatalog();
  const seen = useSeenRef(link);
  const picked = selected.has(link.id);
  const pictured = hasPicture(link);
  return (
    <li
      className={cn(
        "group/link hover:bg-foreground/3 relative isolate flex min-h-14 items-center gap-3 px-3 py-2 transition-colors duration-150 not-last:border-b",
        picked && "bg-primary/8 hover:bg-primary/10"
      )}
      ref={seen}
    >
      <Cover link={link} />
      <div className="pointer-events-none relative flex w-5 shrink-0 items-center justify-center">
        <SelectBox
          className="absolute opacity-0 group-hover/link:opacity-100"
          link={link}
        />
        <NewDot className="size-2 group-hover/link:opacity-0" link={link} />
      </div>
      <span className="bg-muted pointer-events-none relative flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg max-sm:w-12">
        {pictured ? (
          <LinkThumb link={link} />
        ) : (
          <PlatformIcon platform={link.platform} />
        )}
      </span>
      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{link.title}</span>
          {pictured && (
            <PlatformIcon
              className="size-3.5 shrink-0"
              platform={link.platform}
            />
          )}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {link.state === "reading"
            ? "Reading…"
            : link.summary || hostOf(link.url)}
        </span>
      </div>
      <LinkCategories
        className="pointer-events-none relative max-w-60 shrink-0 flex-nowrap max-lg:hidden"
        link={link}
      />
      <span className="text-muted-foreground pointer-events-none relative w-28 shrink-0 truncate text-xs max-md:hidden">
        {link.byline?.name}
      </span>
      <span className="text-muted-foreground pointer-events-none relative flex w-24 shrink-0 items-center justify-end gap-1.5 text-xs max-sm:hidden">
        <UserAvatar aria-hidden pubkey={link.savedBy} size="xs" />
        <ShortWhen at={link.savedAt} />
      </span>
      <StarButton className="relative" link={link} />
    </li>
  );
}

/** The narrowest a gallery column gets, in pixels, on wide screens and on phones. */
const MIN_COLUMN = 240;
const MIN_PHONE_COLUMN = 150;
const MAX_COLUMNS = 5;
const GAP = 12;

/** How many columns fit the gallery's width. */
function columnsFor(width: number): number {
  const min = width < 560 ? MIN_PHONE_COLUMN : MIN_COLUMN;
  return Math.min(
    MAX_COLUMNS,
    Math.max(2, Math.floor((width + GAP) / (min + GAP)))
  );
}

/** A card's height, roughly, before it renders: what puts each in the shortest column. */
function estimateHeight(link: ShownLink, width: number): number {
  const text =
    92 +
    (link.summary || link.state === "reading" ? 36 : 0) +
    (link.categories.length > 0 ? 24 : 0);
  if (hasPicture(link) || link.state === "reading") {
    return width * thumbAspect(link) + text;
  }
  if (link.excerpt && (link.type === "post" || link.type === "short")) {
    return Math.min(180, 60 + link.excerpt.length * 0.45) + text;
  }
  return 96 + text;
}

/** The gallery's width, as it changes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Links as cards in columns, each card going to the shortest column so far,
 * so the newest stay along the top, read left to right.
 */
export function LinkGallery({ links }: { links: ShownLink[] }) {
  const { ref, width } = useWidth();
  const count = width > 0 ? columnsFor(width) : 0;
  const columnWidth = count > 0 ? (width - GAP * (count - 1)) / count : 0;
  const columns: ShownLink[][] = Array.from({ length: count }, () => []);
  const heights: number[] = Array.from({ length: count }, () => 0);
  for (const link of links) {
    let shortest = 0;
    for (let index = 1; index < count; index += 1) {
      if ((heights[index] ?? 0) < (heights[shortest] ?? 0)) {
        shortest = index;
      }
    }
    columns[shortest]?.push(link);
    heights[shortest] =
      (heights[shortest] ?? 0) + estimateHeight(link, columnWidth) + GAP;
  }
  return (
    <div className="flex items-start gap-3" ref={ref}>
      {columns.map((column, index) => (
        // Columns are made fresh from the width each time; their place is who they are.
        // oxlint-disable-next-line react/no-array-index-key
        <div className="flex min-w-0 flex-1 flex-col gap-3" key={index}>
          {column.map((link) => (
            <LinkCard key={link.id} link={link} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function LinkList({ links }: { links: ShownLink[] }) {
  return (
    <ul className="bg-card shadow-surface flex flex-col overflow-hidden rounded-2xl">
      {links.map((link) => (
        <LinkRow key={link.id} link={link} />
      ))}
    </ul>
  );
}

/** A group of links under its heading, like a category with how many it holds. */
export function LinkGroup({
  title,
  count,
  children,
}: {
  title: ReactNode;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        {title}
        <span className="text-muted-foreground tabular-nums">{count}</span>
      </h2>
      {children}
    </section>
  );
}
