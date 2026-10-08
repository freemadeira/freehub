import { cn } from "cn";
import { KanbanIcon, ListIcon } from "lucide-react";
import { useState } from "react";

import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Board } from "@/lib/model";
import { readStorage, writeStorage } from "@/lib/utils";

/** How a board lays out its cards: a column per status, or a list grouped by status. */
const LAYOUTS = [
  { icon: KanbanIcon, label: "Kanban", value: "kanban" },
  { icon: ListIcon, label: "List", value: "list" },
] as const;

export type BoardLayout = (typeof LAYOUTS)[number]["value"];

const DEFAULT_LAYOUT: BoardLayout = "kanban";

function layoutKey(board: Pick<Board, "address">): string {
  return `board:${board.address}:layout`;
}

/** The board's layout, remembered on this device. */
export function useBoardLayout(
  board: Pick<Board, "address">
): [BoardLayout, (value: BoardLayout) => void] {
  const [value, setValue] = useState(() => {
    const stored = readStorage(layoutKey(board));
    return (
      LAYOUTS.find((item) => item.value === stored)?.value ?? DEFAULT_LAYOUT
    );
  });
  const change = (next: BoardLayout) => {
    setValue(next);
    writeStorage(layoutKey(board), next === DEFAULT_LAYOUT ? null : next);
  };
  return [value, change];
}

interface LayoutSwitchProps {
  value: BoardLayout;
  onChange: (value: BoardLayout) => void;
}

/** Kanban or list, side by side, so the current one shows at a glance. */
export function LayoutSwitch({ value, onChange }: LayoutSwitchProps) {
  return (
    <ToggleGroup
      aria-label="Layout"
      className="bg-foreground/5 relative isolate gap-0 rounded-full p-0.5"
      onValueChange={(next) => {
        // Pressing the current layout again would unpress it; it stays.
        if (next[0]) {
          onChange(next[0] as BoardLayout);
        }
      }}
      value={[value]}
    >
      {LAYOUTS.map(({ icon: Icon, label, value: item }) => (
        <FluidTooltip.Root key={item}>
          <FluidTooltip.Trigger>
            <ToggleGroupItem
              aria-label={label}
              className="text-muted-foreground hover:text-foreground data-pressed:text-foreground flex size-7 items-center justify-center rounded-full transition-colors duration-150"
              value={item}
            >
              <Icon aria-hidden className="size-4" />
            </ToggleGroupItem>
          </FluidTooltip.Trigger>
          <FluidTooltip.Content>{label}</FluidTooltip.Content>
        </FluidTooltip.Root>
      ))}
      {/* Slides between the two, like the tabs' indicator. */}
      <span
        aria-hidden
        className={cn(
          "bg-card shadow-surface absolute top-0.5 left-0.5 -z-10 size-7 rounded-full transition-[translate] duration-200 ease-out",
          value === "list" && "translate-x-7"
        )}
      />
    </ToggleGroup>
  );
}
