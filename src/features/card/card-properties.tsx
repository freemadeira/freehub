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
import { UserAvatar } from "@/components/user-avatar";
import { useBoard } from "@/features/board/board-context";
import { LABEL_COLORS, PRIORITY_STYLES } from "@/features/board/card-tile";
import { useProfile } from "@/hooks/use-profile";
import { updateCard } from "@/lib/actions";
import type { Card, CardFields } from "@/lib/model";
import { LABELS, PRIORITIES, STATUSES } from "@/lib/model";

const NAME = "font-normal text-muted-foreground";
const VALUE =
  "h-8 w-full rounded-lg px-2 hover:bg-foreground/5 data-popup-open:bg-foreground/5";

interface Option<T> {
  value: T;
  label: ReactNode;
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
  return (
    <>
      <Label className={NAME} htmlFor={id}>
        {label}
      </Label>
      <Select items={options} onValueChange={onChange} value={value}>
        <SelectTrigger
          className={cn(
            VALUE,
            "border-transparent bg-transparent dark:bg-transparent"
          )}
          id={id}
        >
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

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function Person({ pubkey }: { pubkey: string }) {
  const { name } = useProfile(pubkey);
  return (
    <>
      <UserAvatar aria-hidden pubkey={pubkey} size="xs" />
      <span className="truncate">{name}</span>
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

  const people =
    card.assignee && !board.members.includes(card.assignee)
      ? [...board.members, card.assignee]
      : board.members;
  const sprints = content.sprints.filter(
    (sprint) => sprint.status !== "ended" || sprint.id === card.sprint
  );

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
        options={STATUSES.map(({ id: value, label }) => ({ label, value }))}
        value={card.status}
      />
      <PropertySelect
        id={`${id}-assignee`}
        label="Assignee"
        onChange={(assignee) => save({ assignee: assignee ?? undefined })}
        options={[
          { label: <Muted>Unassigned</Muted>, value: null },
          ...people.map((pubkey) => ({
            label: <Person pubkey={pubkey} />,
            value: pubkey,
          })),
        ]}
        value={card.assignee ?? null}
      />
      <PropertySelect
        id={`${id}-priority`}
        label="Priority"
        onChange={(priority) => save({ priority: priority ?? undefined })}
        options={[
          { label: <Muted>No priority</Muted>, value: null },
          ...PRIORITIES.map(({ id: value, label }) => {
            const { icon: Icon, className: tone } = PRIORITY_STYLES[value];
            return {
              label: (
                <>
                  <Icon className={tone} />
                  {label}
                </>
              ),
              value,
            };
          }),
        ]}
        value={card.priority ?? null}
      />
      <PropertySelect
        id={`${id}-sprint`}
        label="Sprint"
        onChange={(sprint) => save({ sprint: sprint ?? undefined })}
        options={[
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
        ]}
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
