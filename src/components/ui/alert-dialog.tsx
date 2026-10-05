import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { cn } from "cn";
import type * as React from "react";

import { Button } from "@/components/ui/button";

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
}

function AlertDialogContent({
  className,
  ...props
}: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop
        className="fixed inset-0 isolate z-50 bg-black/25 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:opacity-0 dark:bg-black/60"
        data-slot="alert-dialog-overlay"
      />
      <AlertDialogPrimitive.Popup
        className={cn(
          "bg-popover text-popover-foreground shadow-raised fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-2xl p-5 transition-[opacity,scale] duration-200 ease-out outline-none data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:scale-[0.97] data-starting-style:opacity-0",
          className
        )}
        data-slot="alert-dialog-content"
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      data-slot="alert-dialog-header"
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      data-slot="alert-dialog-footer"
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("text-lg leading-tight font-semibold", className)}
      data-slot="alert-dialog-title"
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

function AlertDialogAction({
  variant,
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-action"
      render={<Button variant={variant} />}
      {...props}
    />
  );
}

function AlertDialogCancel({
  variant = "ghost",
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      render={<Button variant={variant} />}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
};
