import type { KeyboardEvent, ReactNode } from "react";
import { useState } from "react";

import {
  labelName,
  PRIORITY_STYLES,
  STATUS_STYLES,
} from "@/features/card/card-fields";
import { LabelDot, Muted } from "@/features/card/card-parts";
import { PriorityNoneIcon } from "@/features/card/priority-icons";
import type { Label, Priority, Sprint, Status } from "@/lib/model";
import { inStatusOrder, LABELS, PRIORITIES, statusLabel } from "@/lib/model";

/** One choice in a card property picker. */
export interface Option<T> {
  value: T;
  label: ReactNode;
  /** The key that picks it while the picker is open. */
  shortcut?: string;
}

function statusOption(status: Status, shortcut?: string): Option<Status> {
  const { icon: Icon, className } = STATUS_STYLES[status];
  return {
    label: (
      <>
        <Icon className={className} />
        {statusLabel(status)}
      </>
    ),
    shortcut,
    value: status,
  };
}

/**
 * The statuses a board uses, keyed like Linear's: triage 0, the rest 1 onwards
 * in order. A card in a status the board doesn't use keeps it on offer, with
 * no key. In key order, so triage comes last, as 0 does on the keyboard.
 */
export function statusOptions(
  statuses: readonly Status[],
  current?: Status
): Option<Status>[] {
  const shortcuts = new Map<Status, string>(
    inStatusOrder(statuses)
      .filter((status) => status !== "triage")
      .map((status, index) => [status, String(index + 1)])
  );
  if (statuses.includes("triage")) {
    shortcuts.set("triage", "0");
  }
  const offered = inStatusOrder(current ? [...statuses, current] : statuses);
  return [
    ...offered.filter((status) => status !== "triage"),
    ...offered.filter((status) => status === "triage"),
  ].map((status) => statusOption(status, shortcuts.get(status)));
}

/**
 * Lets a picker's options be picked by their shortcut keys while it's open.
 * Spread the state on the picker and `onKeyDown` on its popup.
 */
export function useOptionShortcuts<T>(
  options: Option<T>[],
  onPick: (value: T) => void
) {
  const [open, setOpen] = useState(false);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const option = options.find(({ shortcut }) => shortcut === event.key);
    if (option) {
      event.preventDefault();
      setOpen(false);
      onPick(option.value);
    }
  };
  return { onKeyDown, onOpenChange: setOpen, open };
}

export const PRIORITY_OPTIONS: Option<Priority | null>[] = [
  {
    label: (
      <>
        <PriorityNoneIcon className="text-muted-foreground" />
        <Muted>No priority</Muted>
      </>
    ),
    value: null,
  },
  ...PRIORITIES.map(({ id, label }) => {
    const { icon: Icon, className } = PRIORITY_STYLES[id];
    return {
      label: (
        <>
          <Icon className={className} />
          {label}
        </>
      ),
      value: id,
    };
  }),
];

export const LABEL_OPTIONS: Option<Label>[] = LABELS.map((label) => ({
  label: (
    <>
      <LabelDot label={label} />
      {labelName(label)}
    </>
  ),
  value: label,
}));

export function sprintOptions(sprints: Sprint[]): Option<string | null>[] {
  return [
    { label: <Muted>No sprint</Muted>, value: null },
    ...sprints.map((sprint) => ({
      label: (
        <>
          <span className="truncate">{sprint.title}</span>
          {sprint.status === "active" && <Muted>Active</Muted>}
        </>
      ),
      value: sprint.id,
    })),
  ];
}
