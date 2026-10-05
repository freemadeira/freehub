import { cn } from "cn";
import type * as React from "react";

import { FIELD } from "@/components/ui/input";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        FIELD,
        "field-sizing-content min-h-20 resize-none py-2",
        className
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
