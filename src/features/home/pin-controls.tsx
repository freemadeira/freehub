import { cn } from "cn";
import { PinIcon, PinOffIcon } from "lucide-react";

import { IconButton } from "@/components/icon-button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { usePin } from "@/features/home/home-context";
import type { Pin } from "@/lib/home";

/** Pins what the page shows to Home, or unpins it; a filled pin says it's there. */
export function PinButton({ pin }: { pin: Pin }) {
  const { pinned, toggle } = usePin(pin);
  return (
    <IconButton
      aria-pressed={pinned}
      keepTooltipOnClick
      label={pinned ? "Unpin from Home" : "Pin to Home"}
      onClick={() => toggle()}
    >
      <PinIcon className={cn(pinned && "fill-current")} />
    </IconButton>
  );
}

/** The menu item that pins something to Home, or unpins it. */
export function PinMenuItem({ pin }: { pin: Pin }) {
  const { pinned, toggle } = usePin(pin);
  return (
    <DropdownMenuItem onClick={() => toggle(true)}>
      {pinned ? <PinOffIcon /> : <PinIcon />}
      {pinned ? "Unpin from Home" : "Pin to Home"}
    </DropdownMenuItem>
  );
}
