import { KanbanIcon, ListIcon } from "lucide-react";
import { useState } from "react";

import { IconSwitch } from "@/components/icon-switch";
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

/** Kanban or list. */
export function LayoutSwitch({ value, onChange }: LayoutSwitchProps) {
  return (
    <IconSwitch
      choices={LAYOUTS}
      label="Layout"
      onChange={onChange}
      value={value}
    />
  );
}
