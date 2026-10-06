import { cn } from "cn";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Color } from "@/lib/palette";
import { COLORS, SWATCH_COLORS } from "@/lib/palette";

interface ColorPickerProps {
  value: Color;
  onChange: (color: Color) => void;
  className?: string;
  "aria-labelledby"?: string;
}

export function ColorPicker({
  value,
  onChange,
  className,
  ...props
}: ColorPickerProps) {
  return (
    <ToggleGroup
      className={cn("flex-wrap gap-2", className)}
      onValueChange={(next) => {
        const color = COLORS.find((item) => item === next[0]);
        if (color) {
          onChange(color);
        }
      }}
      value={[value]}
      {...props}
    >
      {COLORS.map((color) => (
        <ToggleGroupItem
          aria-label={color}
          className={cn(
            "ring-offset-popover data-pressed:ring-foreground/70 size-6 rounded-full ring-offset-2 transition-shadow duration-150 data-pressed:ring-2",
            SWATCH_COLORS[color]
          )}
          key={color}
          value={color}
        />
      ))}
    </ToggleGroup>
  );
}
