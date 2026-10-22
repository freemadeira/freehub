import { cn } from "cn";
import { format } from "date-fns";
import {
  CheckIcon,
  MessageCircleIcon,
  PlayIcon,
  RotateCwIcon,
  StarIcon,
  StickyNoteIcon,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";

import { UserAvatar } from "@/components/user-avatar";
import type { ShownLink } from "@/features/catalogs/catalog-context";
import { useCatalog } from "@/features/catalogs/catalog-context";
import { hasPicture, useLinkPicture } from "@/features/catalogs/link-picture";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import { rereadLink, starLinks } from "@/lib/catalog-actions";
import type { CatalogCategory, Link, LinkType } from "@/lib/catalogs";
import { hostOf, platformName } from "@/lib/catalogs";
import { formatDuration } from "@/lib/drive";
import { CHIP_COLORS, SWATCH_COLORS } from "@/lib/palette";

/** How tall a link's picture is for its width, when its size isn't known: by what it is. */
function defaultAspect(type: LinkType): number {
  switch (type) {
    case "short": {
      return 16 / 9;
    }
    case "video": {
      return 9 / 16;
    }
    case "music":
    case "podcast": {
      return 1;
    }
    default: {
      return 1 / 1.91;
    }
  }
}

/** The picture's height for its width: as it is, within what a card shows. */
export function thumbAspect(link: Pick<Link, "thumb" | "type">): number {
  const { thumb } = link;
  const aspect =
    thumb?.width && thumb.height
      ? thumb.height / thumb.width
      : defaultAspect(link.type);
  // Very tall pictures are cut down to an upright phone screen, very wide ones to a banner.
  return Math.min(16 / 9, Math.max(1 / 2.4, aspect));
}

/** A category on a link: its color as a dot, and its name. */
export function CategoryChip({
  category,
  className,
  children,
}: {
  category: CatalogCategory;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex h-5 max-w-full min-w-0 items-center gap-1 rounded-full px-1.5 text-[0.6875rem] font-medium",
        CHIP_COLORS[category.color],
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          SWATCH_COLORS[category.color]
        )}
      />
      <span className="truncate">{category.name}</span>
      {children}
    </span>
  );
}

/** Categories shown on a card before the rest fold into a count. */
const SHOWN_CATEGORIES = 2;

export function LinkCategories({
  link,
  limit = SHOWN_CATEGORIES,
  className,
}: {
  link: ShownLink;
  limit?: number;
  className?: string;
}) {
  const { categories } = useCatalog();
  const known = link.categories.flatMap((id) => {
    const category = categories.get(id);
    return category ? [category] : [];
  });
  if (known.length === 0) {
    return null;
  }
  const hidden = known.length - limit;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {known.slice(0, limit).map((category) => (
        <CategoryChip category={category} key={category.id} />
      ))}
      {hidden > 0 && (
        <span className="text-muted-foreground text-[0.6875rem] tabular-nums">
          +{hidden}
        </span>
      )}
    </div>
  );
}

/** A link's picture: faded in once loaded, over a quiet wash of its platform. */
export function LinkThumb({
  link,
  className,
  fit = "cover",
}: {
  link: Pick<Link, "thumb" | "image">;
  className?: string;
  fit?: "cover" | "contain";
}) {
  const src = useLinkPicture(link);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return null;
  }
  return (
    <img
      alt=""
      className={cn(
        "size-full transition-opacity duration-300 ease-out",
        fit === "cover" ? "object-cover" : "object-contain",
        loaded ? "opacity-100" : "opacity-0",
        className
      )}
      decoding="async"
      draggable={false}
      loading="lazy"
      onError={() => setBroken(true)}
      onLoad={() => setLoaded(true)}
      referrerPolicy="no-referrer"
      src={src}
    />
  );
}

/** Where the link is from and how long it plays, over its picture. */
function MediaBadges({ link }: { link: ShownLink }) {
  const playable =
    link.type === "video" || link.type === "short" || link.duration;
  return (
    <>
      <span className="absolute bottom-2 left-2 flex h-6 items-center gap-1.5 rounded-full bg-black/55 px-1.5 text-[0.6875rem] font-medium text-white backdrop-blur-md">
        <span className="flex size-4 items-center justify-center rounded-full bg-white dark:bg-neutral-900">
          <PlatformIcon className="size-3" platform={link.platform} />
        </span>
        {link.duration ? (
          <span className="pr-0.5 tabular-nums">
            {formatDuration(link.duration)}
          </span>
        ) : null}
      </span>
      {playable && (
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 flex size-11 -translate-1/2 scale-90 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-md transition-[opacity,scale] duration-200 ease-out group-hover/link:scale-100 group-hover/link:opacity-100"
        >
          <PlayIcon className="size-5 translate-x-px fill-current" />
        </span>
      )}
    </>
  );
}

/** A post's own words, as a quote, for posts without a picture. */
function PostQuote({ link }: { link: ShownLink }) {
  return (
    <div className="bg-muted/70 flex flex-col gap-2 p-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <PlatformIcon className="size-3.5" platform={link.platform} />
        <span className="text-muted-foreground truncate text-xs font-medium">
          {link.byline?.name ?? platformName(link.platform)}
        </span>
      </div>
      <p className="line-clamp-6 text-sm leading-relaxed text-pretty whitespace-pre-line">
        {link.excerpt}
      </p>
    </div>
  );
}

/** A page without a picture: its site, large and quiet. */
function SiteTile({ link }: { link: ShownLink }) {
  return (
    <div className="bg-muted/70 flex h-24 flex-col items-center justify-center gap-2">
      <PlatformIcon className="size-7 opacity-80" platform={link.platform} />
      <span className="text-muted-foreground max-w-[80%] truncate font-mono text-[0.6875rem]">
        {hostOf(link.url)}
      </span>
    </div>
  );
}

/** What heads a link's card: its picture, its words, or its site. */
export function LinkMedia({ link }: { link: ShownLink }) {
  if (hasPicture(link)) {
    return (
      <div
        className="bg-muted relative overflow-hidden"
        style={{ aspectRatio: String(1 / thumbAspect(link)) }}
      >
        <LinkThumb
          className="transition-[opacity,scale] duration-300 group-hover/link:scale-[1.02]"
          link={link}
        />
        <MediaBadges link={link} />
      </div>
    );
  }
  if (link.state === "reading") {
    return (
      <div
        className="bg-muted relative overflow-hidden"
        style={{ aspectRatio: String(1 / thumbAspect(link)) }}
      >
        <div className="link-reading absolute inset-0" />
      </div>
    );
  }
  if (link.excerpt && (link.type === "post" || link.type === "short")) {
    return <PostQuote link={link} />;
  }
  return <SiteTile link={link} />;
}

/** The link's star, there to press on hover, and shown whenever it's starred. */
export function StarButton({
  link,
  className,
}: {
  link: ShownLink;
  className?: string;
}) {
  return (
    <button
      aria-label={link.starred ? "Remove star" : "Star"}
      aria-pressed={link.starred}
      className={cn(
        "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 pointer-events-auto flex size-6 items-center justify-center rounded-md transition-[color,opacity] duration-150 outline-none focus-visible:ring-3",
        !link.starred &&
          "opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100 pointer-coarse:hidden",
        className
      )}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        starLinks([link.id], !link.starred);
      }}
      type="button"
    >
      <StarIcon
        className={cn(
          "size-3.5",
          link.starred && "fill-amber-400 text-amber-400"
        )}
      />
    </button>
  );
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago, in seconds, as briefly as a card has room for: "now", "30m", "2h", "3d", then the day. */
export function shortAgo(at: number, now: number = Date.now() / 1000): string {
  const since = now - at;
  if (since < MINUTE) {
    return "now";
  }
  if (since < HOUR) {
    return `${Math.floor(since / MINUTE)}m`;
  }
  if (since < DAY) {
    return `${Math.floor(since / HOUR)}h`;
  }
  if (since < 7 * DAY) {
    return `${Math.floor(since / DAY)}d`;
  }
  return format(
    at * 1000,
    new Date(at * 1000).getFullYear() === new Date(now * 1000).getFullYear()
      ? "MMM d"
      : "MMM d, yyyy"
  );
}

/** When something happened, in seconds, briefly, with the exact time on hover. */
export function ShortWhen({ at }: { at: number }) {
  const date = new Date(at * 1000);
  return (
    <time
      className="shrink-0 tabular-nums"
      dateTime={date.toISOString()}
      title={format(date, "PPpp")}
    >
      {shortAgo(at)}
    </time>
  );
}

/** Who saved it and when, with whether it has a note or comments. */
export function LinkFooter({ link }: { link: ShownLink }) {
  const { canEdit, project } = useCatalog();
  return (
    <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
      {link.byline && (
        <>
          <span className="min-w-0 truncate">{link.byline.name}</span>
          <span aria-hidden>·</span>
        </>
      )}
      <UserAvatar aria-hidden pubkey={link.savedBy} size="xs" />
      <ShortWhen at={link.savedAt} />
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {link.state === "failed" && canEdit && (
          <button
            className="hover:text-foreground pointer-events-auto flex items-center gap-1 transition-colors duration-150"
            onClick={(event) => {
              event.stopPropagation();
              rereadLink(project, link);
            }}
            title="The page couldn’t be read. Try again."
            type="button"
          >
            <RotateCwIcon className="size-3" />
            Retry
          </button>
        )}
        {link.note && (
          <StickyNoteIcon aria-label="Has a note" className="size-3.5" />
        )}
        {link.commentCount > 0 && (
          <span className="flex items-center gap-0.5 tabular-nums">
            <MessageCircleIcon aria-hidden className="size-3.5" />
            <span className="sr-only">Comments: </span>
            {link.commentCount}
          </span>
        )}
        <StarButton className="-my-1 -mr-1" link={link} />
      </span>
    </div>
  );
}

/** A link's new dot, which fades once it's been seen. */
export function NewDot({
  link,
  className,
}: {
  link: ShownLink;
  className?: string;
}) {
  return (
    <span
      aria-label={link.isNew ? "New" : undefined}
      className={cn(
        "bg-primary pointer-events-none size-3 rounded-full shadow-[0_0_0_2px_var(--color-card),0_1px_3px_rgb(0_0_0/0.3)] transition-[opacity,scale] duration-500 ease-out",
        link.isNew ? "scale-100 opacity-100" : "scale-50 opacity-0",
        className
      )}
      role={link.isNew ? "status" : undefined}
    />
  );
}

/** The box that picks a link, there on hover and while picking. */
export function SelectBox({
  link,
  className,
}: {
  link: ShownLink;
  className?: string;
}) {
  const { selected, toggle, canEdit } = useCatalog();
  if (!canEdit) {
    return null;
  }
  const picked = selected.has(link.id);
  const picking = selected.size > 0;
  return (
    <button
      aria-label={picked ? "Unselect" : "Select"}
      aria-pressed={picked}
      className={cn(
        "pointer-events-auto flex size-5 items-center justify-center rounded-md shadow-sm ring-1 transition-[opacity,background-color] duration-150 outline-none focus-visible:ring-3",
        picked
          ? "bg-primary text-primary-foreground ring-primary"
          : "bg-background/90 ring-foreground/20 text-transparent backdrop-blur",
        picking || picked
          ? "opacity-100"
          : "opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100 pointer-coarse:hidden",
        className
      )}
      onClick={(event) => {
        event.stopPropagation();
        toggle(link, event.shiftKey);
      }}
      type="button"
    >
      <CheckIcon className="size-3.5" strokeWidth={3} />
    </button>
  );
}
