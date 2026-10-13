import type { LucideIcon } from "lucide-react";

import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface IconChoice<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
}

interface IconSwitchProps<T extends string> {
  label: string;
  choices: readonly IconChoice<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A few ways to show something, side by side, so the current one shows at a glance. */
export function IconSwitch<T extends string>({
  label,
  choices,
  value,
  onChange,
}: IconSwitchProps<T>) {
  const index = Math.max(
    0,
    choices.findIndex((choice) => choice.value === value)
  );
  return (
    <ToggleGroup
      aria-label={label}
      className="bg-foreground/5 relative isolate gap-0 rounded-full p-0.5"
      onValueChange={(next) => {
        // Pressing the current one again would unpress it; it stays.
        const picked = choices.find((choice) => choice.value === next[0]);
        if (picked) {
          onChange(picked.value);
        }
      }}
      value={[value]}
    >
      {choices.map(({ icon: Icon, label: name, value: item }) => (
        <FluidTooltip.Root key={item}>
          <FluidTooltip.Trigger>
            <ToggleGroupItem
              aria-label={name}
              className="text-muted-foreground hover:text-foreground data-pressed:text-foreground flex size-7 items-center justify-center rounded-full transition-colors duration-150"
              value={item}
            >
              <Icon aria-hidden className="size-4" />
            </ToggleGroupItem>
          </FluidTooltip.Trigger>
          <FluidTooltip.Content>{name}</FluidTooltip.Content>
        </FluidTooltip.Root>
      ))}
      {/* Slides between them, like the tabs' indicator. */}
      <span
        aria-hidden
        className="bg-card shadow-surface absolute top-0.5 left-0.5 -z-10 size-7 rounded-full transition-[translate] duration-200 ease-out"
        style={{ translate: `${index * 1.75}rem` }}
      />
    </ToggleGroup>
  );
}
