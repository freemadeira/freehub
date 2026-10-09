import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "cn";
import type { MouseEvent, ReactNode } from "react";

import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { useBoard } from "@/features/board/board-context";
import { NoAssigneeIcon } from "@/features/card/assignee-icons";
import {
  assignable,
  inOfferedOrder,
  PRIORITY_STYLES,
  STATUS_STYLES,
} from "@/features/card/card-fields";
import type { Option } from "@/features/card/card-options";
import {
  PRIORITY_OPTIONS,
  statusOptions,
  useOptionShortcuts,
} from "@/features/card/card-options";
import { AvatarStack, Person } from "@/features/card/card-parts";
import { PriorityNoneIcon } from "@/features/card/priority-icons";
import { updateCard } from "@/lib/actions";
import type { Card, Priority, Status } from "@/lib/model";
import { priorityLabel, statusLabel } from "@/lib/model";

/**
 * Whether a click on a card was for one of its own controls rather than for
 * opening it: on a button inside it, or in a popup one opened, which is
 * portaled out of the card but still bubbles through it in React's tree.
 */
export function isControlClick(event: MouseEvent<HTMLElement>): boolean {
  const card = event.currentTarget;
  const target = event.target as Element;
  if (!card.contains(target)) {
    return true;
  }
  const control = target.closest("button");
  return control !== null && card.contains(control);
}

/** Sits where the bare value would, with room around it to aim at. */
const TRIGGER =
  "focus-visible:ring-ring/50 -m-1 flex shrink-0 items-center rounded-md p-1 outline-none transition-colors duration-150 hover:bg-foreground/5 focus-visible:ring-3 data-popup-open:bg-foreground/5";

interface InlineSelectProps<T> {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  /** What the trigger shows: the value, as the card shows it. */
  children: ReactNode;
  className?: string;
}

function InlineSelect<T>({
  label,
  value,
  options,
  onChange,
  children,
  className,
}: InlineSelectProps<T>) {
  const pick = (next: T | null) => {
    if (next !== value) {
      onChange(next as T);
    }
  };
  const { onKeyDown, ...open } = useOptionShortcuts(options, pick);
  return (
    <Select {...open} items={options} onValueChange={pick} value={value}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn(TRIGGER, className)}
      >
        {children}
      </SelectPrimitive.Trigger>
      <SelectContent className="min-w-44" onKeyDown={onKeyDown}>
        {options.map((option) => (
          <SelectItem
            key={String(option.value)}
            shortcut={option.shortcut}
            value={option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StatusIcon({ status }: { status: Status }) {
  const { icon: Icon, className } = STATUS_STYLES[status];
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} />;
}

/** The card's status, which those who edit cards change from here. */
export function CardStatus({ card }: { card: Card }) {
  const { board, canEdit } = useBoard();
  const label = `Status: ${statusLabel(card.status)}`;
  if (!canEdit) {
    return (
      <>
        <StatusIcon status={card.status} />
        <span className="sr-only">{label}</span>
      </>
    );
  }
  return (
    <InlineSelect
      label={label}
      onChange={(status: Status) => updateCard(board, card, { status })}
      options={statusOptions(board.statuses, card.status)}
      value={card.status}
    >
      <StatusIcon status={card.status} />
    </InlineSelect>
  );
}

function PriorityIcon({ priority }: { priority?: Priority }) {
  if (!priority) {
    return (
      <PriorityNoneIcon
        aria-hidden
        className="text-muted-foreground/60 size-4 shrink-0"
      />
    );
  }
  const { icon: Icon, className } = PRIORITY_STYLES[priority];
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} />;
}

/** The card's priority; with none, only those who could set one see a mark. */
export function CardPriority({ card }: { card: Card }) {
  const { board, canEdit } = useBoard();
  const { priority } = card;
  if (!canEdit) {
    return (
      priority && (
        <>
          <PriorityIcon priority={priority} />
          <span className="sr-only">{priorityLabel(priority)} priority</span>
        </>
      )
    );
  }
  return (
    <InlineSelect
      label={`Priority: ${priority ? priorityLabel(priority) : "None"}`}
      onChange={(next: Priority | null) =>
        updateCard(board, card, { priority: next ?? undefined })
      }
      options={PRIORITY_OPTIONS}
      value={priority ?? null}
    >
      <PriorityIcon priority={priority} />
    </InlineSelect>
  );
}

/**
 * Who the card is assigned to, as avatars. Those who edit cards change it
 * from here, and see where to assign someone when nobody is.
 */
export function CardAssignees({
  card,
  className,
}: {
  card: Card;
  className?: string;
}) {
  const { board, canEdit } = useBoard();
  const { assignees } = card;
  if (!canEdit) {
    return (
      assignees.length > 0 && (
        <AvatarStack className={className} pubkeys={assignees} />
      )
    );
  }
  const offered = assignable(board, assignees);
  return (
    <Select
      multiple
      onValueChange={(next: string[]) =>
        updateCard(board, card, { assignees: inOfferedOrder(offered, next) })
      }
      value={assignees}
    >
      <SelectPrimitive.Trigger
        aria-label={assignees.length > 0 ? "Assignees" : "Assign"}
        className={cn(TRIGGER, "rounded-full", className)}
      >
        {assignees.length > 0 ? (
          <AvatarStack pubkeys={assignees} />
        ) : (
          <NoAssigneeIcon
            aria-hidden
            className="text-muted-foreground/60 size-5"
          />
        )}
      </SelectPrimitive.Trigger>
      <SelectContent align="end" className="min-w-48">
        {offered.map((pubkey) => (
          <SelectItem key={pubkey} value={pubkey}>
            <Person pubkey={pubkey} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
