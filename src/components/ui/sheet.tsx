import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cn } from "cn";
import { XIcon } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";

const SIDES = {
  bottom:
    "inset-x-0 bottom-0 max-h-[calc(100dvh-2rem)] rounded-t-2xl data-ending-style:translate-y-full data-starting-style:translate-y-full",
  left: "inset-y-0 left-0 h-dvh w-3/4 max-w-sm rounded-r-2xl data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
  right:
    "inset-y-0 right-0 h-dvh w-full sm:inset-y-2 sm:right-2 sm:h-auto sm:max-w-lg sm:rounded-2xl data-ending-style:translate-x-[calc(100%+0.5rem)] data-starting-style:translate-x-[calc(100%+0.5rem)]",
} as const;

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/25 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:opacity-0 dark:bg-black/60",
        className
      )}
      data-slot="sheet-overlay"
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: keyof typeof SIDES;
  showCloseButton?: boolean;
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        className={cn(
          "bg-popover text-popover-foreground shadow-raised ease-drawer fixed z-50 flex flex-col gap-4 text-sm transition-[translate] duration-300 outline-none data-ending-style:duration-200",
          SIDES[side],
          className
        )}
        data-side={side}
        data-slot="sheet-content"
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                className="absolute top-3 right-3"
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1 p-5", className)}
      data-slot="sheet-header"
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      className={cn("text-lg leading-tight font-semibold", className)}
      data-slot="sheet-title"
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
