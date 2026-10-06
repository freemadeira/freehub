import { cn } from "cn";
import { FileIcon, FileTextIcon } from "lucide-react";

import type { DocPageFields } from "@/lib/docs";

/** The page's emoji, or a page icon that shows whether it has text. */
export function PageIcon({
  page,
  className,
}: {
  page: Pick<DocPageFields, "icon" | "content">;
  className?: string;
}) {
  if (page.icon) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center text-[0.95em] leading-none",
          className
        )}
      >
        {page.icon}
      </span>
    );
  }
  const Icon = page.content.trim() ? FileTextIcon : FileIcon;
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} />;
}
