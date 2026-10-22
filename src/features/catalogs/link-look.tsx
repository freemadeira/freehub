import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "cn";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  MessageCircleIcon,
  RotateCwIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/icon-button";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import type { ShownLink } from "@/features/catalogs/catalog-context";
import { useCatalog } from "@/features/catalogs/catalog-context";
import { linkPath } from "@/features/catalogs/catalogs-context";
import { LinkPanel } from "@/features/catalogs/link-panel";
import { LinkPlayer } from "@/features/catalogs/link-player";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import { MoveSubmenu } from "@/features/catalogs/selection-bar";
import { useReadSubject } from "@/features/inbox/inbox-context";
import {
  hasReader,
  markSeen,
  removeLinks,
  rereadLink,
  starLinks,
} from "@/lib/catalog-actions";
import { hostOf, platformName } from "@/lib/catalogs";
import type { Comment } from "@/lib/model";
import { LINK_KIND } from "@/lib/model";
import { subjectOf } from "@/lib/notifications";
import { readStorage, writeStorage } from "@/lib/utils";

const PANEL_KEY = "catalog:panel";
/** How far a swipe goes before it steps to the next link, in pixels. */
const SWIPE = 60;

/** Copies the link's address, and says so for a moment. */
function CopyButton({ link }: { link: ShownLink }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <IconButton
      className="max-sm:hidden"
      keepTooltipOnClick
      label="Copy address"
      onClick={async () => {
        await navigator.clipboard.writeText(link.url);
        setCopied(true);
      }}
      tooltip={copied ? "Copied" : "Copy address"}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  );
}

function Viewer({
  link,
  links,
  comments,
  onNavigate,
}: {
  link: ShownLink;
  links: ShownLink[];
  comments: ReadonlyMap<string, Comment[]>;
  /** Opens another link, or closes the look when given none. */
  onNavigate: (link?: ShownLink) => void;
}) {
  const { catalog, project, canEdit } = useCatalog();
  const [panel, setPanel] = useState(() => readStorage(PANEL_KEY) !== "closed");
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const index = links.findIndex((item) => item.id === link.id);
  const previous = index > 0 ? links[index - 1] : undefined;
  const next = index === -1 ? undefined : links[index + 1];
  // Seeing a link reads what the inbox says about it.
  useReadSubject(subjectOf(LINK_KIND, link.id));

  useEffect(() => {
    if (link.isNew) {
      markSeen(project, link.catalog, link.id);
    }
  }, [project, link.catalog, link.id, link.isNew]);

  const togglePanel = () => {
    setPanel(!panel);
    writeStorage(PANEL_KEY, panel ? "closed" : null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable=true], iframe")) {
      return;
    }
    if (event.key === "ArrowLeft" && previous) {
      event.preventDefault();
      onNavigate(previous);
    } else if (event.key === "ArrowRight" && next) {
      event.preventDefault();
      onNavigate(next);
    } else if (event.key === " ") {
      // Like Quick Look: space closes what space opened.
      event.preventDefault();
      onNavigate();
    } else if (
      event.key.toLowerCase() === "s" &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      starLinks([link.id], !link.starred);
    }
  };

  // On phones, a sideways swipe over the preview steps through the links.
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      swipe.current = { x: event.clientX, y: event.clientY };
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) {
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const target = dx < 0 ? next : previous;
      if (target) {
        onNavigate(target);
      }
    }
  };

  const step = (target: ShownLink | undefined, side: "left" | "right") =>
    target && (
      <IconButton
        className={cn(
          "absolute top-1/2 z-10 -translate-y-1/2 bg-black/40 text-white backdrop-blur-md hover:bg-black/60 hover:text-white max-sm:hidden",
          side === "left" ? "left-4" : "right-4"
        )}
        label={side === "left" ? "Previous link" : "Next link"}
        onClick={() => onNavigate(target)}
        size="icon-lg"
      >
        {side === "left" ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      </IconButton>
    );

  return (
    <div
      className="flex size-full flex-col"
      onKeyDown={onKeyDown}
      role="presentation"
    >
      <header className="flex h-14 shrink-0 items-center gap-3 px-3 sm:px-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
          <PlatformIcon className="size-4.5" platform={link.platform} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <DialogPrimitive.Title className="truncate text-sm font-medium">
            {link.title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-muted-foreground truncate text-xs">
            {link.platform === "web"
              ? hostOf(link.url)
              : platformName(link.platform)}
            {links.length > 1 && index !== -1 && (
              <span className="tabular-nums">
                {" "}
                · {index + 1} of {links.length}
              </span>
            )}
          </DialogPrimitive.Description>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <FluidTooltip.Group>
            <IconButton
              aria-pressed={link.starred}
              label={link.starred ? "Remove star" : "Star"}
              onClick={() => starLinks([link.id], !link.starred)}
              tooltip={link.starred ? "Remove star  S" : "Star  S"}
            >
              <StarIcon
                className={cn(link.starred && "fill-amber-400 text-amber-400")}
              />
            </IconButton>
            <IconButton
              aria-pressed={panel}
              className={cn(panel && "bg-muted text-foreground")}
              label="Details and comments"
              onClick={togglePanel}
            >
              <MessageCircleIcon />
            </IconButton>
            <CopyButton link={link} />
            <IconButton
              label="Open"
              nativeButton={false}
              render={
                // oxlint-disable-next-line jsx-a11y/anchor-has-content -- the icon is its content
                <a
                  aria-label="Open"
                  href={link.url}
                  rel="noopener noreferrer"
                  target="_blank"
                />
              }
            >
              <ExternalLinkIcon />
            </IconButton>
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<IconButton label="More" />}>
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {hasReader() && (
                    <DropdownMenuItem onClick={() => rereadLink(project, link)}>
                      <RotateCwIcon />
                      Read the page again
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() =>
                      navigator.clipboard.writeText(
                        `${location.origin}${linkPath(project, catalog, link.id)}`
                      )
                    }
                  >
                    <CopyIcon />
                    Copy link to this
                  </DropdownMenuItem>
                  <MoveSubmenu
                    links={[link]}
                    onMoved={() => onNavigate(next ?? previous)}
                  />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      removeLinks(project, [link]);
                      onNavigate(next ?? previous);
                    }}
                    variant="destructive"
                  >
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DialogPrimitive.Close render={<IconButton label="Close" />}>
              <XIcon />
            </DialogPrimitive.Close>
          </FluidTooltip.Group>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 gap-3 px-3 pb-3 max-md:flex-col sm:px-4 sm:pb-4">
        <div
          className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center max-md:min-h-[40%]"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          {step(previous, "left")}
          <div
            className="flex size-full items-center justify-center p-2 sm:p-6"
            key={link.id}
          >
            <LinkPlayer link={link} />
          </div>
          {step(next, "right")}
        </div>
        {panel && (
          <LinkPanel
            className="w-[24rem] shrink-0 max-md:max-h-[55%] max-md:w-auto"
            comments={comments.get(link.id)}
            key={link.id}
            link={link}
          />
        )}
      </div>
    </div>
  );
}

/**
 * A link open over its catalog: played or previewed, with everything about
 * it beside. ← and → step through the links shown with it.
 */
export function LinkLook({
  linkId,
  links,
  comments,
  onNavigate,
}: {
  linkId: string | undefined;
  /** The links shown with it, in order, to step through. */
  links: ShownLink[];
  comments: ReadonlyMap<string, Comment[]>;
  /** Opens another link, or closes the look when given none. */
  onNavigate: (link?: ShownLink) => void;
}) {
  const { links: all } = useCatalog();
  const listed = linkId ? links.find((link) => link.id === linkId) : undefined;
  // Opened from a link elsewhere, it may not be among those shown.
  const link =
    listed ?? (linkId ? all.find((item) => item.id === linkId) : undefined);
  // Kept while the look closes, so it fades out with what it showed.
  const [last, setLast] = useState<ShownLink>();
  if (link && link !== last) {
    setLast(link);
  }
  const shown = link ?? last;
  return (
    <DialogPrimitive.Root
      onOpenChange={(open) => {
        if (!open) {
          onNavigate();
        }
      }}
      open={link !== undefined}
    >
      <DialogPortal>
        <DialogOverlay className="bg-black/80 backdrop-blur-md dark:bg-black/80" />
        <DialogPrimitive.Popup className="dark text-foreground fixed inset-0 z-50 transition-[opacity,scale] duration-200 ease-out outline-none data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
          {shown && (
            <Viewer
              comments={comments}
              link={shown}
              links={listed ? links : [shown]}
              onNavigate={onNavigate}
            />
          )}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
