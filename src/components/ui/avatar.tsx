import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "cn";
import type * as React from "react";

function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & { size?: "xs" | "sm" | "default" | "lg" }) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "group/avatar relative flex size-8 shrink-0 rounded-full select-none after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:border after:border-black/10 data-[size=lg]:size-10 data-[size=sm]:size-6 data-[size=xs]:size-5 dark:after:border-white/10",
        className
      )}
      data-size={size}
      data-slot="avatar"
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      className={cn("size-full rounded-full object-cover", className)}
      data-slot="avatar-image"
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "bg-muted flex size-full items-center justify-center rounded-full",
        className
      )}
      data-slot="avatar-fallback"
      {...props}
    />
  );
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "*:data-[slot=avatar]:ring-card flex -space-x-1.5 *:data-[slot=avatar]:ring-2",
        className
      )}
      data-slot="avatar-group"
      {...props}
    />
  );
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "bg-muted text-muted-foreground ring-card relative flex size-6 shrink-0 items-center justify-center rounded-full text-[0.7rem] tabular-nums ring-2",
        className
      )}
      data-slot="avatar-group-count"
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage };
