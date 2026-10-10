import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SplitButtonProps = Pick<
  ComponentProps<typeof Button>,
  "children" | "onClick" | "size" | "variant"
> & {
  /** Names the chevron for screen readers. */
  menuLabel: string;
  /** What the chevron offers instead of the button's own action. */
  menu: ReactNode;
};

/** A button for the usual action, joined to a chevron with a menu of the rest. */
export function SplitButton({
  children,
  menu,
  menuLabel,
  onClick,
  size,
  variant,
}: SplitButtonProps) {
  return (
    // Pressing the button shrinks the pair as one, not half of it.
    <div className="flex transition-[scale] duration-150 ease-out has-[[data-main]:active]:scale-[0.96]">
      <Button
        className="rounded-r-none border-r-0"
        data-main=""
        onClick={onClick}
        size={size}
        static
        variant={variant}
      >
        {children}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={menuLabel}
              className={cn(
                "relative rounded-l-none border-l-0 pr-2.5 pl-2",
                // Outline halves meet on their own ring; solid ones need a seam.
                variant !== "outline" &&
                  "before:absolute before:inset-y-2 before:left-0 before:w-px before:bg-current/25"
              )}
              size={size}
              variant={variant}
            />
          }
        >
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {menu}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
