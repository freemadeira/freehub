import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import {
  FluidTooltip,
  useInFluidTooltipGroup,
} from "@/components/ui/fluid-tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type IconButtonProps = Omit<ComponentProps<typeof Button>, "aria-label"> & {
  label: string;
};

/** Icon-only button with its label as a tooltip; joins an enclosing FluidTooltip.Group. */
export function IconButton({
  label,
  children,
  size = "icon-sm",
  variant = "ghost",
  ...props
}: IconButtonProps) {
  const grouped = useInFluidTooltipGroup();
  const button = (
    <Button aria-label={label} size={size} variant={variant} {...props}>
      {children}
    </Button>
  );
  if (grouped) {
    return (
      <FluidTooltip.Root>
        <FluidTooltip.Trigger>{button}</FluidTooltip.Trigger>
        <FluidTooltip.Content>{label}</FluidTooltip.Content>
      </FluidTooltip.Root>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
