import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type IconButtonProps = Omit<ComponentProps<typeof Button>, "aria-label"> & {
  label: string;
};

export function IconButton({
  label,
  children,
  size = "icon-sm",
  variant = "ghost",
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={label} size={size} variant={variant} {...props} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
