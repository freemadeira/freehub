import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";

const buttonVariants = cva(
  "group/button focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,color,box-shadow,scale,opacity] duration-150 ease-out outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      static: false,
      variant: "default",
    },
    variants: {
      size: {
        default:
          "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-lg": "size-11",
        "icon-sm": "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-11 gap-2 px-6 text-[0.95rem]",
        sm: "h-8 gap-1 px-3 text-[0.8rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
      },
      static: {
        false: "active:not-aria-[haspopup]:scale-[0.96]",
        true: "",
      },
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        link: "text-foreground decoration-foreground/30 hover:decoration-foreground underline underline-offset-4",
        outline:
          "bg-card text-foreground shadow-surface hover:bg-accent aria-expanded:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)]",
      },
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  static: isStatic = false,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      className={cn(
        buttonVariants({ className, size, static: isStatic, variant })
      )}
      data-slot="button"
      {...props}
    />
  );
}

export { Button, buttonVariants };
