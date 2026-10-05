import { cn } from "cn";
import { Loader2Icon } from "lucide-react";
import type * as React from "react";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      aria-hidden
      className={cn("size-4 animate-spin", className)}
      data-slot="spinner"
      {...props}
    />
  );
}

export { Spinner };
