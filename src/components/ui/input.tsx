import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";
import type * as React from "react";

const FIELD =
  "w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      className={cn(FIELD, "h-9", className)}
      data-slot="input"
      {...props}
    />
  );
}

export { FIELD, Input };
