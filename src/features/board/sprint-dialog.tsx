import { format, parseISO } from "date-fns";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBoard } from "@/features/board/board-context";
import { updateSprint } from "@/lib/actions";
import type { Sprint } from "@/lib/model";

function day(date: Date | undefined): string | undefined {
  return date && format(date, "yyyy-MM-dd");
}

function SprintForm({
  sprint,
  onDone,
}: {
  sprint: Sprint;
  onDone: () => void;
}) {
  const id = useId();
  const { board } = useBoard();
  const [title, setTitle] = useState(sprint.title);
  const [range, setRange] = useState<DateRange | undefined>(() =>
    sprint.start
      ? {
          from: parseISO(sprint.start),
          to: sprint.end ? parseISO(sprint.end) : undefined,
        }
      : undefined
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    updateSprint(board, sprint, {
      end: day(range?.to),
      start: day(range?.from),
      title: title.trim() || sprint.title,
    });
    onDone();
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Edit sprint</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-title`}>Name</Label>
        <Input
          autoComplete="off"
          id={`${id}-title`}
          onChange={(event) => setTitle(event.target.value)}
          value={title}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium" id={`${id}-dates`}>
          Dates
        </span>
        <Calendar
          aria-labelledby={`${id}-dates`}
          className="mx-auto"
          defaultMonth={range?.from}
          mode="range"
          onSelect={setRange}
          selected={range}
        />
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  );
}

interface SprintDialogProps {
  sprint: Sprint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SprintDialog({
  sprint,
  open,
  onOpenChange,
}: SprintDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <SprintForm onDone={() => onOpenChange(false)} sprint={sprint} />
      </DialogContent>
    </Dialog>
  );
}
