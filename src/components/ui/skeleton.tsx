import { cn } from "cn";
import type * as React from "react";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("bg-foreground/5 animate-pulse rounded-lg", className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

export { Skeleton };
