import { cn } from "cn";
import { format, formatDistanceToNowStrict } from "date-fns";
import type { ReactNode } from "react";

/** "Just now", then "5 minutes ago". */
export function ago(seconds: number): string {
  const date = new Date(seconds * 1000);
  return Date.now() - date.getTime() < 60_000
    ? "Just now"
    : formatDistanceToNowStrict(date, { addSuffix: true });
}

export function TimelineTime({
  at,
  className,
}: {
  /** In seconds. */
  at: number;
  className?: string;
}) {
  const date = new Date(at * 1000);
  return (
    <time
      className={cn("text-muted-foreground shrink-0 text-xs", className)}
      dateTime={date.toISOString()}
      title={format(date, "PPpp")}
    >
      {ago(at)}
    </time>
  );
}

/** Covers the timeline's line where an entry sits on it. */
export function TimelineMarker({ children }: { children: ReactNode }) {
  return (
    <span className="bg-background relative z-10 flex size-6 shrink-0 items-center justify-center">
      {children}
    </span>
  );
}

/** Entries down a line, each with a marker on it. */
export function Timeline({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "before:bg-border relative flex flex-col gap-4 before:absolute before:top-3 before:bottom-3 before:left-3 before:w-px",
        className
      )}
    >
      {children}
    </ol>
  );
}
