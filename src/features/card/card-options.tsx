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
import { LABELS, PRIORITIES, STATUSES } from "@/lib/model";

/** One choice in a card property picker. */
export interface Option<T> {
  value: T;
  label: ReactNode;
  /** The key that picks it while the picker is open. */
  shortcut?: string;
}

/** Keyed like Linear's: triage 0, the rest 1 onwards in order. */
const statusOptions: Option<Status>[] = STATUSES.map(({ id, label }, index) => {
  const { icon: Icon, className } = STATUS_STYLES[id];
  return {
    label: (
      <>
        <Icon className={className} />
        {label}
      </>
    ),
    shortcut: String(index),
    value: id,
  };
});

/** In key order, so triage comes last, as 0 does on the keyboard. */
export const STATUS_OPTIONS: Option<Status>[] = [
  ...statusOptions.slice(1),
  ...statusOptions.slice(0, 1),
];

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
