import { cn } from "cn";
import type { ComponentProps } from "react";

/** A key to press, drawn as a small key cap. */
function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "bg-card text-muted-foreground shadow-surface inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 font-sans text-[0.6875rem] leading-none font-medium select-none",
        className
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

/** Keys pressed together or in turn, side by side. */
function KbdGroup({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
