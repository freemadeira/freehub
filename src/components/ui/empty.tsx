import { cn } from "cn";
import type * as React from "react";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center",
        className
      )}
      data-slot="empty"
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("text-base font-medium", className)}
      data-slot="empty-title"
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-muted-foreground -mt-2 max-w-xs text-sm", className)}
      data-slot="empty-description"
      {...props}
    />
  );
}

export { Empty, EmptyDescription, EmptyTitle };
