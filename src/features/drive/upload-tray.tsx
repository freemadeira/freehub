import { cn } from "cn";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

import { IconButton } from "@/components/icon-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { fileHref } from "@/features/drive/drive-context";
import { FileIcon } from "@/features/drive/file-icon";
import type { DriveFolder, DriveTree } from "@/lib/drive";
import type { UploadItem } from "@/lib/drive-upload";
import {
  cancel,
  cancelAll,
  clearFinished,
  isActive,
  retry,
  useUploads,
} from "@/lib/drive-upload";
import { formatBytes, plural } from "@/lib/utils";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** A tray of only finished uploads tucks itself away after this, unless it's being looked at. */
const DISMISS_MS = 6000;

/** "12s", "3 min", "1 h 5 min". */
function timeLeft(seconds: number): string {
  if (seconds < 60) {
    return `${Math.max(1, Math.round(seconds))}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function rate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** How far all of it got, as a ring that fills, a check once done, or a warning if some failed. */
function Ring({
  share,
  state,
}: {
  share: number;
  state: "active" | "done" | "failed";
}) {
  const radius = 11;
  const length = 2 * Math.PI * radius;
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center">
      <svg
        aria-hidden
        className="absolute inset-0 -rotate-90"
        viewBox="0 0 32 32"
      >
        <circle
          className="stroke-foreground/10"
          cx="16"
          cy="16"
          fill="none"
          r={radius}
          strokeWidth="3"
        />
        <circle
          className={cn(
            "transition-[stroke-dashoffset,stroke] duration-300 ease-out",
            state === "failed" ? "stroke-destructive" : "stroke-primary",
            state === "done" && "stroke-green-500"
          )}
          cx="16"
          cy="16"
          fill="none"
          r={radius}
          strokeDasharray={length}
          strokeDashoffset={length * (1 - (state === "active" ? share : 1))}
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
      {state === "done" && (
        <CheckIcon
          aria-hidden
          className="size-3.5 text-green-500"
          strokeWidth={3}
        />
      )}
      {state === "failed" && (
        <CircleAlertIcon aria-hidden className="text-destructive size-3.5" />
      )}
    </span>
  );
}

function Bar({ share, busy }: { share: number; busy?: boolean }) {
  return (
    <span className="bg-foreground/8 relative block h-1 overflow-hidden rounded-full">
      <span
        className={cn(
          "bg-primary absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ease-out",
          busy && "animate-pulse"
        )}
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </span>
  );
}

function Status({ item, folder }: { item: UploadItem; folder?: DriveFolder }) {
  switch (item.status) {
    case "queued": {
      return <span>Waiting · {formatBytes(item.size)}</span>;
    }
    case "uploading": {
      return (
        <span className="tabular-nums">
          {formatBytes(item.loaded)} of {formatBytes(item.size)}
          {item.speed > 0 && ` · ${rate(item.speed)}`}
        </span>
      );
    }
    case "saving": {
      return <span>Finishing up…</span>;
    }
    case "done": {
      return <span>In {folder?.name ?? "Drive"}</span>;
    }
    case "canceled": {
      return <span>Canceled</span>;
    }
    default: {
      return (
        <span className="text-destructive truncate" title={item.error}>
          {item.error ?? "Didn’t upload"}
        </span>
      );
    }
  }
}

function Row({
  item,
  trees,
}: {
  item: UploadItem;
  trees: ReadonlyMap<string, DriveTree>;
}) {
  const [, navigate] = useLocation();
  const folder = item.folder
    ? trees.get(item.project.address)?.byId.get(item.folder)
    : undefined;
  const [broken, setBroken] = useState(false);
  const active = isActive(item);
  const done = item.status === "done";
  const open = () => {
    if (done && item.fileId) {
      navigate(
        fileHref(item.project, { folder: item.folder, id: item.fileId }, folder)
      );
    }
  };
  return (
    <motion.li
      animate={{ opacity: 1, y: 0 }}
      className="group/row relative flex items-center gap-3 px-3 py-2"
      initial={{ opacity: 0, y: 6 }}
      layout="position"
      transition={{ duration: 0.2, ease: EASE_OUT }}
    >
      {item.preview && !broken ? (
        <img
          alt=""
          className="image-outline size-9 shrink-0 rounded-lg object-cover"
          onError={() => setBroken(true)}
          src={item.preview}
        />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center">
          <FileIcon file={item} size="md" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {done ? (
          <button
            className="hover:text-primary focus-visible:ring-ring/50 truncate rounded text-left text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:ring-3"
            onClick={open}
            title={`Open ${item.name}`}
            type="button"
          >
            {item.name}
          </button>
        ) : (
          <span className="truncate text-sm font-medium" title={item.name}>
            {item.name}
          </span>
        )}
        {(item.status === "uploading" || item.status === "saving") && (
          <Bar
            busy={item.status === "saving"}
            share={item.size > 0 ? item.loaded / item.size : 1}
          />
        )}
        <span className="text-muted-foreground flex min-w-0 text-xs">
          <Status folder={folder} item={item} />
        </span>
      </span>
      <span className="relative z-10 flex shrink-0 items-center">
        {active && (
          <IconButton
            label={`Cancel ${item.name}`}
            onClick={() => cancel(item.id)}
            size="icon-xs"
          >
            <XIcon />
          </IconButton>
        )}
        {(item.status === "failed" || item.status === "canceled") && (
          <IconButton
            label={`Try ${item.name} again`}
            onClick={() => retry(item.id)}
            size="icon-xs"
          >
            <RotateCcwIcon />
          </IconButton>
        )}
        {done && (
          <span className="flex size-6 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
            <CheckIcon aria-hidden className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </span>
    </motion.li>
  );
}

/** What all the uploads come to, for the tray's header. */
function summarize(items: UploadItem[]) {
  const active = items.filter(isActive);
  const failed = items.filter((item) => item.status === "failed").length;
  const done = items.filter((item) => item.status === "done").length;
  const total = active.reduce((sum, item) => sum + item.size, 0);
  const loaded = active.reduce((sum, item) => sum + item.loaded, 0);
  const speed = active.reduce((sum, item) => sum + item.speed, 0);
  const counted = items.filter((item) => item.status !== "canceled").length;
  let title = `${plural(done, "upload")} complete`;
  if (active.length > 0) {
    title = `Uploading ${Math.min(done + 1, counted)} of ${counted}`;
  } else if (failed > 0) {
    title = `${failed} didn’t upload`;
  }
  let detail = "";
  if (active.length > 0 && speed > 0) {
    detail = `${timeLeft((total - loaded) / speed)} left · ${rate(speed)}`;
  } else if (active.length > 0) {
    detail = "Starting…";
  } else if (failed > 0) {
    detail = `${done} of ${counted} uploaded`;
  }
  let state: "active" | "done" | "failed" = "done";
  if (active.length > 0) {
    state = "active";
  } else if (failed > 0) {
    state = "failed";
  }
  return {
    active: active.length,
    detail,
    share: total > 0 ? loaded / total : 0,
    state,
    title,
  };
}

/**
 * Uploads as they go, in a card in the corner that stays up across the app:
 * how far each got, how long the rest will take, and buttons to cancel or
 * try again. It tucks itself away once everything's in.
 */
export function UploadTray({
  trees,
}: {
  /** Every project's Drive folders, by project address, to say where each file went. */
  trees: ReadonlyMap<string, DriveTree>;
}) {
  const items = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const summary = summarize(items);
  const finished = items.length > 0 && summary.state === "done";

  useEffect(() => {
    if (!finished || hovered) {
      return;
    }
    const timer = setTimeout(clearFinished, DISMISS_MS);
    return () => clearTimeout(timer);
  }, [finished, hovered]);

  const close = () => {
    if (summary.active > 0) {
      setConfirming(true);
    } else {
      clearFinished();
    }
  };

  return (
    <>
      <AnimatePresence>
        {items.length > 0 && (
          <motion.section
            animate={{ filter: "blur(0px)", opacity: 1, scale: 1, y: 0 }}
            aria-label="Uploads"
            className="bg-popover text-popover-foreground shadow-raised fixed right-4 bottom-4 z-40 flex w-92 max-w-[calc(100vw-2rem)] origin-bottom-right flex-col overflow-hidden rounded-2xl max-sm:right-2 max-sm:bottom-2 max-sm:max-w-[calc(100vw-1rem)]"
            exit={{
              filter: "blur(4px)",
              opacity: 0,
              scale: 0.96,
              transition: { duration: 0.15 },
              y: 8,
            }}
            initial={{ filter: "blur(4px)", opacity: 0, scale: 0.96, y: 16 }}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            transition={{ duration: 0.3, ease: EASE_OUT }}
          >
            <header className="flex items-center gap-3 py-2.5 pr-2 pl-3">
              <Ring share={summary.share} state={summary.state} />
              <div aria-live="polite" className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">
                  {summary.title}
                </span>
                {summary.detail && (
                  <span className="text-muted-foreground truncate text-xs tabular-nums">
                    {summary.detail}
                  </span>
                )}
              </div>
              <FluidTooltip.Group>
                <IconButton
                  aria-expanded={!collapsed}
                  className="[&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:ease-out aria-[expanded=false]:[&>svg]:rotate-180"
                  label={collapsed ? "Show uploads" : "Hide uploads"}
                  onClick={() => setCollapsed(!collapsed)}
                >
                  <ChevronDownIcon />
                </IconButton>
                <IconButton
                  label={summary.active > 0 ? "Cancel uploads" : "Close"}
                  onClick={close}
                >
                  <XIcon />
                </IconButton>
              </FluidTooltip.Group>
            </header>
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.div
                  animate={{ height: "auto", opacity: 1 }}
                  className="overflow-hidden"
                  exit={{ height: 0, opacity: 0 }}
                  initial={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: EASE_OUT }}
                >
                  <ol className="flex max-h-72 flex-col overflow-y-auto border-t py-1">
                    {items.map((item) => (
                      <Row item={item} key={item.id} trees={trees} />
                    ))}
                  </ol>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>
      <AlertDialog onOpenChange={setConfirming} open={confirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel {plural(summary.active, "upload")}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              What’s already uploaded stays in the Drive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep uploading</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                cancelAll();
                clearFinished();
              }}
              variant="destructive"
            >
              Cancel uploads
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
