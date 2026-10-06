import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "cn";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "focus-visible:ring-ring/50 data-checked:bg-primary bg-input relative inline-flex h-5 w-8 shrink-0 items-center rounded-full p-0.5 transition-[background-color,box-shadow] duration-150 outline-none after:absolute after:-inset-2 focus-visible:ring-3 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform duration-150 ease-out data-checked:translate-x-3"
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
