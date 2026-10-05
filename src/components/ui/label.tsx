import { cn } from "cn";
import type * as React from "react";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("text-sm font-medium select-none", className)}
      data-slot="label"
      {...props}
    />
  );
}

export { Label };
