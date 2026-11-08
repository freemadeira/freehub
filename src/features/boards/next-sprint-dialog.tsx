import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { BoardScope } from "@/features/board/board-context";
import { upcomingTitle } from "@/features/board/sprint-view";
import type { SprintDates } from "@/lib/actions";
import {
  defaultSprintDates,
  startNextSprint,
  unfinishedCards,
} from "@/lib/actions";
import type { BoardContent } from "@/lib/model";
import { activeSprint } from "@/lib/model";
import { plural } from "@/lib/utils";

/** What moving on does to the board: which sprint ends and which starts. */
function plan(content: BoardContent): string {
  const next = upcomingTitle(content);
  const current = activeSprint(content);
  if (!current) {
    return `Starts ${next}`;
  }
  const unfinished = unfinishedCards(current, content).length;
  return unfinished === 0
    ? `${current.title} → ${next}`
    : `${current.title} → ${next} · ${plural(unfinished, "unfinished card")} ${unfinished === 1 ? "moves" : "move"}`;
}

function day(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Moves the board on to its next sprint: whether every change was saved. */
async function movedOn(
  { board, content }: BoardScope,
  dates: SprintDates
): Promise<boolean> {
  const saved = await startNextSprint(board, content, dates);
  return saved.every(Boolean);
}

/** The dates picked, once both ends are. */
function datesOf(range: DateRange | undefined): SprintDates | undefined {
  return range?.from && range.to
    ? { end: day(range.to), start: day(range.from) }
    : undefined;
}

function rangeLabel(range: DateRange | undefined): string {
  if (!range?.from) {
    return "Pick dates";
  }
  if (!range.to) {
    return `${format(range.from, "MMM d")} – Pick an end`;
  }
  const days = differenceInCalendarDays(range.to, range.from);
  return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d")} · ${plural(days, "day")}`;
}

/** When every board's next sprint runs: the same days on all of them. */
function DatesField({
  range,
  onChange,
}: {
  range: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium" id={id}>
        Dates
      </span>
      <Popover>
        <PopoverTrigger
          aria-describedby={id}
          render={<Button size="sm" type="button" variant="outline" />}
        >
          <CalendarIcon />
          <span className="tabular-nums">{rangeLabel(range)}</span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-2">
          <Calendar
            aria-labelledby={id}
            defaultMonth={range?.from}
            // A sprint ends on a later day than it starts.
            min={1}
            mode="range"
            onSelect={onChange}
            selected={range}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function NextSprintForm({
  scopes,
  filtered,
  onDone,
}: {
  scopes: BoardScope[];
  filtered: boolean;
  onDone: () => void;
}) {
  // Boards that never ran a sprint are likely not using them.
  const [picked, setPicked] = useState(
    () =>
      new Set(
        scopes.flatMap((scope) =>
          scope.content.sprints.length > 0 ? [scope.board.address] : []
        )
      )
  );
  const chosen = scopes.filter((scope) => picked.has(scope.board.address));
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const { start, end } = defaultSprintDates();
    return { from: parseISO(start), to: parseISO(end) };
  });
  const dates = datesOf(range);

  const pick = (address: string, on: boolean) => {
    const next = new Set(picked);
    if (on) {
      next.add(address);
    } else {
      next.delete(address);
    }
    setPicked(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dates) {
      return;
    }
    const started = chosen.map((scope) => movedOn(scope, dates));
    onDone();
    // Each change shows at once; the signer may still refuse some, which
    // tells of its own, so only the boards fully moved on are counted.
    const outcomes = await Promise.all(started);
    const count = outcomes.filter(Boolean).length;
    if (count > 0) {
      toast.success(`Next sprint started on ${plural(count, "board")}`);
    }
  };

  return (
    <form className="flex min-h-0 flex-col gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Start the next sprint</DialogTitle>
        <DialogDescription>
          Each board’s sprint ends and its next one runs on the same dates.
          {filtered
            ? " Unfinished cards move to the next sprint, everyone’s, not only those shown."
            : " Unfinished cards move to the next sprint."}
        </DialogDescription>
      </DialogHeader>
      <DatesField onChange={setRange} range={range} />
      <ul className="-mx-2 flex min-h-0 flex-col overflow-y-auto">
        {scopes.map(({ board, content }) => (
          <li key={board.address}>
            <label className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-150">
              <Checkbox
                checked={picked.has(board.address)}
                onCheckedChange={(on) => pick(board.address, on)}
              />
              <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm font-medium">
                  {board.title}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {plan(content)}
                </span>
              </span>
              <span className="bg-muted text-muted-foreground shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs">
                {board.code}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button disabled={chosen.length === 0 || !dates} type="submit">
          {chosen.length > 1
            ? `Start ${chosen.length} sprints`
            : "Start next sprint"}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface NextSprintDialogProps {
  /** The boards whose sprints can move on: those in view the user can edit. */
  scopes: BoardScope[];
  /** Whether the page shows only some people's cards, which this leaves aside. */
  filtered: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Ends every picked board's sprint and starts its next one, all at once. */
export function NextSprintDialog({
  scopes,
  filtered,
  open,
  onOpenChange,
}: NextSprintDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {/* The list scrolls on its own, so the buttons stay in sight. */}
      <DialogContent className="overflow-hidden" showCloseButton={false}>
        <NextSprintForm
          filtered={filtered}
          onDone={() => onOpenChange(false)}
          scopes={scopes}
        />
      </DialogContent>
    </Dialog>
  );
}
