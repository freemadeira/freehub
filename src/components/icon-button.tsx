import type { ComponentProps, ReactNode } from "react";

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
  /** Shown instead of the label, e.g. to confirm the click worked. */
  tooltip?: ReactNode;
  /** Keeps the tooltip open after a click, so a changed `tooltip` is seen. */
  keepTooltipOnClick?: boolean;
};

/** Icon-only button with its label as a tooltip; joins an enclosing FluidTooltip.Group. */
export function IconButton({
  label,
  tooltip = label,
  keepTooltipOnClick = false,
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
        <FluidTooltip.Trigger keepOpenOnClick={keepTooltipOnClick}>
          {button}
        </FluidTooltip.Trigger>
        <FluidTooltip.Content>{tooltip}</FluidTooltip.Content>
      </FluidTooltip.Root>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger closeOnClick={!keepTooltipOnClick} render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
