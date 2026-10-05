import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "cn";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

const Select = SelectPrimitive.Root;

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      className={cn("flex min-w-0 flex-1 truncate text-left", className)}
      data-slot="select-value"
      {...props}
    />
  );
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "border-input bg-card focus-visible:ring-ring/50 data-placeholder:text-muted-foreground flex h-9 w-fit items-center justify-between gap-2 rounded-lg border px-3 text-sm whitespace-nowrap transition-[background-color,box-shadow] outline-none select-none focus-visible:ring-3 data-disabled:cursor-not-allowed data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={<ChevronDownIcon className="text-muted-foreground" />}
      />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={false}
        alignOffset={alignOffset}
        className="isolate z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className={cn(
            "bg-popover text-popover-foreground shadow-raised z-50 max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-xl p-1 transition-[opacity,scale] duration-150 ease-out outline-none data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-[0.96] data-starting-style:opacity-0",
            className
          )}
          data-slot="select-content"
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-lg py-1.5 pr-8 pl-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText className="flex min-w-0 flex-1 items-center gap-2 truncate">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <CheckIcon />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
