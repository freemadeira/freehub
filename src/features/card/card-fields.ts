import type { LucideIcon } from "lucide-react";

import {
  PriorityHighIcon,
  PriorityLowIcon,
  PriorityMediumIcon,
  PriorityUrgentIcon,
} from "@/features/card/priority-icons";
import {
  StatusBacklogIcon,
  StatusCanceledIcon,
  StatusDoneIcon,
  StatusDuplicateIcon,
  StatusProgressIcon,
  StatusReviewIcon,
  StatusTodoIcon,
  StatusTriageIcon,
} from "@/features/card/status-icons";
import type { Board, Label, Priority, Sprint, Status } from "@/lib/model";

interface IconStyle {
  icon: LucideIcon;
  className: string;
}

const CLOSED_GRAY = "text-neutral-400 dark:text-neutral-500";

/** Linear's colors. */
export const STATUS_STYLES: Record<Status, IconStyle> = {
  backlog: { className: "text-muted-foreground", icon: StatusBacklogIcon },
  canceled: { className: CLOSED_GRAY, icon: StatusCanceledIcon },
  done: { className: "text-blue-500", icon: StatusDoneIcon },
  duplicate: { className: CLOSED_GRAY, icon: StatusDuplicateIcon },
  progress: { className: "text-yellow-500", icon: StatusProgressIcon },
  review: { className: "text-green-500", icon: StatusReviewIcon },
  todo: { className: "text-foreground/75", icon: StatusTodoIcon },
  triage: { className: "text-orange-500", icon: StatusTriageIcon },
};

export const PRIORITY_STYLES: Record<Priority, IconStyle> = {
  high: { className: "text-muted-foreground", icon: PriorityHighIcon },
  low: { className: "text-muted-foreground", icon: PriorityLowIcon },
  medium: { className: "text-muted-foreground", icon: PriorityMediumIcon },
  urgent: { className: "text-foreground", icon: PriorityUrgentIcon },
};

export const LABEL_COLORS: Record<Label, string> = {
  blue: "text-blue-500",
  green: "text-green-500",
  orange: "text-orange-500",
  purple: "text-violet-500",
  red: "text-red-500",
  yellow: "text-yellow-400",
};

export function labelName(label: Label): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Sprints a card can move to: any not yet ended, plus its current one. */
export function sprintChoices(sprints: Sprint[], current?: string): Sprint[] {
  return sprints.filter(
    (sprint) => sprint.status !== "ended" || sprint.id === current
  );
}

/** The board's members, plus anyone still assigned after leaving it. */
export function assignable(board: Board, assignees: string[]): string[] {
  const members = new Set(board.members);
  return [
    ...board.members,
    ...assignees.filter((pubkey) => !members.has(pubkey)),
  ];
}

/** The people picked, in the order they're offered. */
export function inOfferedOrder(people: string[], picked: string[]): string[] {
  const chosen = new Set(picked);
  return people.filter((pubkey) => chosen.has(pubkey));
}
