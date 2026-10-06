import { cn } from "cn";

import type { Color } from "@/lib/palette";
import { SWATCH_COLORS } from "@/lib/palette";

const SIZES = {
  default: "size-5 rounded-md text-[0.65rem]",
  lg: "size-11 rounded-xl text-lg",
  md: "size-8 rounded-lg text-sm",
} as const;

export function ProjectAvatar({
  project,
  size = "default",
  className,
}: {
  project: { title: string; color: Color };
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const initial = [...project.title.trim()][0]?.toUpperCase() ?? "?";
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold text-white select-none",
        project.color === "yellow" && "text-black/75",
        SWATCH_COLORS[project.color],
        SIZES[size],
        className
      )}
    >
      {initial}
    </span>
  );
}
