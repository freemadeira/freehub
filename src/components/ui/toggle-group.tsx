import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "cn";

function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props) {
  return (
    <ToggleGroupPrimitive
      className={cn("flex items-center gap-1", className)}
      data-slot="toggle-group"
      {...props}
    />
  );
}

function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      className={cn(
        "focus-visible:ring-ring/50 outline-none select-none focus-visible:ring-3",
        className
      )}
      data-slot="toggle-group-item"
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
