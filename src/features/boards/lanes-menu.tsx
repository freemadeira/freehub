import { Rows3Icon } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LaneKind } from "@/features/boards/sprint-cards";
import { LANE_KINDS } from "@/features/boards/sprint-cards";
import { readStorage, writeStorage } from "@/lib/utils";

const LABELS: Record<LaneKind, string> = {
  assignee: "By assignee",
  board: "By board",
  none: "None",
};

function parseLanes(value: string | null): LaneKind {
  return LANE_KINDS.find((kind) => kind === value) ?? "none";
}

/** The rows the cards split into, remembered on this device under the key given. */
export function useLanes(key: string): [LaneKind, (lanes: LaneKind) => void] {
  const [lanes, setLanes] = useState(() => parseLanes(readStorage(key)));
  const change = (next: LaneKind) => {
    setLanes(next);
    writeStorage(key, next === "none" ? null : next);
  };
  return [lanes, change];
}

interface LanesMenuProps {
  value: LaneKind;
  onChange: (lanes: LaneKind) => void;
}

/** Picks the swimlanes: a row of cards per board or per person, or none. */
export function LanesMenu({ value, onChange }: LanesMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            label={
              value === "none"
                ? "Swimlanes"
                : `Swimlanes: ${LABELS[value].toLowerCase()}`
            }
            variant={value === "none" ? "ghost" : "secondary"}
          >
            <Rows3Icon />
          </IconButton>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup
          onValueChange={(next) => onChange(parseLanes(next))}
          value={value}
        >
          {/* Inside the group, which it names. */}
          <DropdownMenuLabel>Swimlanes</DropdownMenuLabel>
          {LANE_KINDS.map((kind) => (
            <DropdownMenuRadioItem key={kind} value={kind}>
              {LABELS[kind]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
