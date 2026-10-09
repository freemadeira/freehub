import { cn } from "cn";
import { format, isBefore, parseISO, startOfToday } from "date-fns";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBoard } from "@/features/board/board-context";
import {
  assignable,
  inOfferedOrder,
  LABEL_COLORS,
  labelName,
  sprintChoices,
} from "@/features/card/card-fields";
import type { Option } from "@/features/card/card-options";
import {
  PRIORITY_OPTIONS,
  sprintOptions,
  statusOptions,
  useOptionShortcuts,
} from "@/features/card/card-options";
import { LabelDot, Muted, People, Person } from "@/features/card/card-parts";
import { updateCard } from "@/lib/actions";
import type { Card, CardFields } from "@/lib/model";
import { isClosed, LABELS } from "@/lib/model";

const NAME = "font-normal text-muted-foreground";
const VALUE =
  "h-8 w-full rounded-lg px-2 hover:bg-foreground/5 data-popup-open:bg-foreground/5";
const SELECT_VALUE = cn(
  VALUE,
  "border-transparent bg-transparent dark:bg-transparent"
);
const GRID =
  "grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 self-start";

function labelOf<T>(options: Option<T>[], value: T): ReactNode {
  return options.find((option) => option.value === value)?.label;
}

function isOverdue(card: Card): boolean {
  return (
    card.due !== undefined &&
    !isClosed(card.status) &&
    isBefore(parseISO(card.due), startOfToday())
  );
}

interface PropertySelectProps<T> {
  id: string;
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T | null) => void;
}

function PropertySelect<T>({
  id,
  label,
  value,
  options,
  onChange,
}: PropertySelectProps<T>) {
  const { onKeyDown, ...open } = useOptionShortcuts(options, onChange);
  return (
    <>
      <Label className={NAME} htmlFor={id}>
        {label}
      </Label>
      <Select {...open} items={options} onValueChange={onChange} value={value}>
        <SelectTrigger className={SELECT_VALUE} id={id}>
          <SelectValue className="items-center gap-2" />
        </SelectTrigger>
        <SelectContent onKeyDown={onKeyDown}>
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
    </>
  );
}

function Assignees({
  id,
  people,
  value,
  onChange,
}: {
  id: string;
  people: string[];
  value: string[];
  onChange: (assignees: string[]) => void;
}) {
  return (
    <>
      <Label className={NAME} htmlFor={id}>
        Assignees
      </Label>
      <Select
        multiple
        onValueChange={(next: string[]) =>
          onChange(inOfferedOrder(people, next))
        }
        value={value}
      >
        <SelectTrigger className={SELECT_VALUE} id={id}>
          <SelectValue className="items-center gap-2">
            {(current: string[]) => <People pubkeys={current} />}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {people.map((pubkey) => (
            <SelectItem key={pubkey} value={pubkey}>
              <Person pubkey={pubkey} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function DueDate({
  id,
  card,
  onChange,
}: {
  id: string;
  card: Card;
  onChange: (due: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const date = card.due ? parseISO(card.due) : undefined;
  const overdue = isOverdue(card);

  const pick = (day?: Date) => {
    onChange(day && format(day, "yyyy-MM-dd"));
    setOpen(false);
  };

  return (
    <>
      <Label className={NAME} htmlFor={id}>
        Due date
      </Label>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger
          className={cn(
            VALUE,
            "focus-visible:ring-ring/50 flex items-center justify-between gap-2 text-left text-sm transition-colors outline-none select-none focus-visible:ring-3",
            overdue && "text-destructive"
          )}
          id={id}
        >
          {date ? format(date, "MMM d, yyyy") : <Muted>No due date</Muted>}
          <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
        </PopoverTrigger>
        <PopoverContent align="start" className="flex flex-col gap-1 p-2">
          <Calendar
            defaultMonth={date}
            mode="single"
            onSelect={pick}
            selected={date}
          />
          {date && (
            <Button onClick={() => pick()} size="sm" variant="ghost">
              Clear
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className={cn("text-sm select-none", NAME)}>{label}</dt>
      <dd className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
        {children}
      </dd>
    </>
  );
}

/** The properties as text, for viewers of the board. */
function PropertyList({ card, className }: { card: Card; className?: string }) {
  const { board, content } = useBoard();
  const sprints = sprintOptions(sprintChoices(content.sprints, card.sprint));
  const statuses = statusOptions(board.statuses, card.status);
  return (
    <dl className={cn(GRID, className)}>
      <Property label="Status">{labelOf(statuses, card.status)}</Property>
      <Property label="Assignees">
        <People pubkeys={card.assignees} />
      </Property>
      <Property label="Priority">
        {labelOf(PRIORITY_OPTIONS, card.priority ?? null)}
      </Property>
      <Property label="Sprint">
        {labelOf(sprints, card.sprint ?? null) ?? labelOf(sprints, null)}
      </Property>
      <Property label="Due date">
        {card.due ? (
          <span className={cn(isOverdue(card) && "text-destructive")}>
            {format(parseISO(card.due), "MMM d, yyyy")}
          </span>
        ) : (
          <Muted>No due date</Muted>
        )}
      </Property>
      <Property label="Labels">
        {card.labels.length > 0 ? (
          <>
            {card.labels.map((label) => (
              <LabelDot key={label} label={label} />
            ))}
            <span className="sr-only">
              {card.labels.map((label) => labelName(label)).join(", ")}
            </span>
          </>
        ) : (
          <Muted>No labels</Muted>
        )}
      </Property>
    </dl>
  );
}

export function CardProperties({
  card,
  className,
}: {
  card: Card;
  className?: string;
}) {
  const id = useId();
  const { board, canEdit, content } = useBoard();
  const save = (changes: Partial<CardFields>) =>
    updateCard(board, card, changes);
  const sprints = sprintChoices(content.sprints, card.sprint);

  if (!canEdit) {
    return <PropertyList card={card} className={className} />;
  }

  return (
    <div className={cn(GRID, className)}>
      <PropertySelect
        id={`${id}-status`}
        label="Status"
        onChange={(status) => {
          if (status) {
            save({ status });
          }
        }}
        options={statusOptions(board.statuses, card.status)}
        value={card.status}
      />
      <Assignees
        id={`${id}-assignees`}
        onChange={(assignees) => save({ assignees })}
        people={assignable(board, card.assignees)}
        value={card.assignees}
      />
      <PropertySelect
        id={`${id}-priority`}
        label="Priority"
        onChange={(priority) => save({ priority: priority ?? undefined })}
        options={PRIORITY_OPTIONS}
        value={card.priority ?? null}
      />
      <PropertySelect
        id={`${id}-sprint`}
        label="Sprint"
        onChange={(sprint) => save({ sprint: sprint ?? undefined })}
        options={sprintOptions(sprints)}
        value={sprints.find((sprint) => sprint.id === card.sprint)?.id ?? null}
      />
      <DueDate card={card} id={`${id}-due`} onChange={(due) => save({ due })} />
      <span className={cn("text-sm select-none", NAME)} id={`${id}-labels`}>
        Labels
      </span>
      <ToggleGroup
        aria-labelledby={`${id}-labels`}
        className="h-8 gap-2 px-2"
        multiple
        onValueChange={(labels) =>
          save({ labels: LABELS.filter((label) => labels.includes(label)) })
        }
        value={card.labels}
      >
        {LABELS.map((label) => (
          <ToggleGroupItem
            aria-label={label}
            className={cn(
              "size-5 rounded-full inset-ring-2 inset-ring-current transition-colors duration-150 hover:bg-current/30 data-pressed:bg-current",
              LABEL_COLORS[label]
            )}
            key={label}
            value={label}
          />
        ))}
      </ToggleGroup>
    </div>
  );
}
