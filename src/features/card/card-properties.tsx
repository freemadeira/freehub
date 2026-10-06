import { cn } from "cn";
import { format, isBefore, parseISO, startOfToday } from "date-fns";
import { ChevronDownIcon } from "lucide-react";
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
  sprintChoices,
} from "@/features/card/card-fields";
import type { Option } from "@/features/card/card-options";
import {
  PRIORITY_OPTIONS,
  sprintOptions,
  STATUS_OPTIONS,
} from "@/features/card/card-options";
import { Muted, People, Person } from "@/features/card/card-parts";
import { updateCard } from "@/lib/actions";
import type { Card, CardFields } from "@/lib/model";
import { LABELS } from "@/lib/model";

const NAME = "font-normal text-muted-foreground";
const VALUE =
  "h-8 w-full rounded-lg px-2 hover:bg-foreground/5 data-popup-open:bg-foreground/5";
const SELECT_VALUE = cn(
  VALUE,
  "border-transparent bg-transparent dark:bg-transparent"
);

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
  return (
    <>
      <Label className={NAME} htmlFor={id}>
        {label}
      </Label>
      <Select items={options} onValueChange={onChange} value={value}>
        <SelectTrigger className={SELECT_VALUE} id={id}>
          <SelectValue className="items-center gap-2" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={String(option.value)} value={option.value}>
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
  const overdue =
    date !== undefined &&
    card.status !== "done" &&
    isBefore(date, startOfToday());

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

export function CardProperties({
  card,
  className,
}: {
  card: Card;
  className?: string;
}) {
  const id = useId();
  const { board, content } = useBoard();
  const save = (changes: Partial<CardFields>) =>
    updateCard(board, card, changes);
  const sprints = sprintChoices(content.sprints, card.sprint);

  return (
    <div
      className={cn(
        "grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 self-start",
        className
      )}
    >
      <PropertySelect
        id={`${id}-status`}
        label="Status"
        onChange={(status) => {
          if (status) {
            save({ status });
          }
        }}
        options={STATUS_OPTIONS}
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
