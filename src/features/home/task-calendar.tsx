import type { DragEndEvent } from "@dnd-kit/react";
import {
  DragDropProvider,
  DragOverlay,
  useDraggable,
  useDroppable,
} from "@dnd-kit/react";
import { cn } from "cn";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfToday,
  startOfWeek,
} from "date-fns";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useState } from "react";

import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { BoardScope } from "@/features/board/board-context";
import { BoardContext, useBoard } from "@/features/board/board-context";
import { CardLink } from "@/features/board/card-tile";
import { SENSORS } from "@/features/board/use-card-drag";
import { STATUS_STYLES } from "@/features/card/card-fields";
import { TaskRow, taskKey } from "@/features/home/task-list";
import { compareTasks, WEEK_STARTS_ON } from "@/features/home/tasks";
import { useIsMobile } from "@/hooks/use-mobile";
import type { MyCard } from "@/hooks/use-my-cards";
import { updateCard } from "@/lib/actions";
import type { Card } from "@/lib/model";
import { plural, readStorage, writeStorage } from "@/lib/utils";

/** The tray's id as a drop target: a card dropped there loses its date. */
const NO_DATE = "no-date";
/** Cards a day shows before the rest fold into "N more". */
const MAX_CHIPS = 3;
const TRAY_KEY = "home:no-date-tray";

function isoDay(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

/** Whether the tray of cards without a date shows, remembered on this device. */
function useTray(): [boolean, () => void] {
  const [open, setOpen] = useState(() => readStorage(TRAY_KEY) !== "closed");
  const toggle = () => {
    setOpen(!open);
    writeStorage(TRAY_KEY, open ? "closed" : null);
  };
  return [open, toggle];
}

function ChipBody({ card, overdue }: { card: Card; overdue: boolean }) {
  const { icon: Icon, className } = STATUS_STYLES[card.status];
  return (
    <>
      <Icon aria-hidden className={cn("size-3.5 shrink-0", className)} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          overdue && "text-destructive",
          !card.title && "text-muted-foreground"
        )}
      >
        {card.title || "Untitled"}
      </span>
    </>
  );
}

const CHIP = "flex shrink-0 items-center gap-1.5 rounded-md px-1.5";

function DraggableChip({
  item,
  overdue,
  className,
}: {
  item: MyCard;
  overdue: boolean;
  className?: string;
}) {
  const { canEdit } = useBoard();
  const { ref, isDragSource } = useDraggable({
    disabled: !canEdit,
    id: taskKey(item),
    type: "card",
  });
  return (
    <CardLink
      card={item.card}
      className={cn(CHIP, className, isDragSource && "opacity-40")}
      ref={ref}
    >
      <ChipBody card={item.card} overdue={overdue} />
    </CardLink>
  );
}

interface ChipProps {
  item: MyCard;
  scopes: Map<string, BoardScope>;
  /** Due before today, while still open. */
  overdue?: boolean;
  className?: string;
}

/** A card on the calendar: opens it, and drags to another day. */
function Chip({ item, scopes, overdue = false, className }: ChipProps) {
  return (
    <BoardContext value={scopes.get(item.board.address) ?? null}>
      <DraggableChip className={className} item={item} overdue={overdue} />
    </BoardContext>
  );
}

function DayNumber({
  day,
  today,
  inMonth,
}: {
  day: Date;
  today: Date;
  inMonth: boolean;
}) {
  const isToday = isSameDay(day, today);
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums",
        isToday && "bg-primary text-primary-foreground font-medium",
        !(isToday || inMonth) && "text-muted-foreground"
      )}
    >
      <time dateTime={isoDay(day)}>{format(day, "d")}</time>
    </span>
  );
}

/** The cards a full day has no room for, in a popover. */
function MoreChips({
  day,
  items,
  scopes,
  overdue,
}: {
  day: Date;
  items: MyCard[];
  scopes: Map<string, BoardScope>;
  overdue: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-ring/50 h-6 shrink-0 rounded-md px-1.5 text-left text-xs transition-colors duration-150 outline-none focus-visible:ring-3">
        {items.length} more
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-64 flex-col gap-1 p-1.5">
        <h3 className="text-muted-foreground px-1.5 py-1 text-xs font-medium">
          {format(day, "EEEE, MMMM d")}
        </h3>
        {items.map((item) => (
          <Chip
            className="h-8 text-sm"
            item={item}
            key={taskKey(item)}
            overdue={overdue}
            scopes={scopes}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

interface DayProps {
  day: Date;
  month: Date;
  today: Date;
  items: MyCard[];
  scopes: Map<string, BoardScope>;
}

function useDayDrop(day: Date) {
  return useDroppable({ accept: "card", id: isoDay(day), type: "day" });
}

const DROP_TARGET = "bg-accent inset-ring-2 inset-ring-primary/60";

function Day({ day, month, today, items, scopes }: DayProps) {
  const { ref, isDropTarget } = useDayDrop(day);
  const inMonth = isSameMonth(day, month);
  const overdue = isBefore(day, today);
  const folded = items.length > MAX_CHIPS;
  const shown = folded ? items.slice(0, MAX_CHIPS - 1) : items;
  return (
    <div
      className={cn(
        "flex min-h-28 min-w-0 flex-col gap-1 p-1.5 transition-[background-color,box-shadow] duration-150",
        inMonth ? "bg-card" : "bg-muted",
        isDropTarget && DROP_TARGET
      )}
      ref={ref}
    >
      <DayNumber day={day} inMonth={inMonth} today={today} />
      {shown.map((item) => (
        <Chip
          className="h-6 text-xs"
          item={item}
          key={taskKey(item)}
          overdue={overdue}
          scopes={scopes}
        />
      ))}
      {folded && (
        <MoreChips
          day={day}
          items={items.slice(MAX_CHIPS - 1)}
          overdue={overdue}
          scopes={scopes}
        />
      )}
    </div>
  );
}

/** On a phone a day is a button with a dot per card; the day picked lists them below. */
function CompactDay({
  day,
  month,
  today,
  items,
  selected,
  onSelect,
}: Omit<DayProps, "scopes"> & { selected: boolean; onSelect: () => void }) {
  const { ref, isDropTarget } = useDayDrop(day);
  const inMonth = isSameMonth(day, month);
  const overdue = isBefore(day, today);
  return (
    <button
      aria-label={`${format(day, "EEEE, MMMM d")}${items.length > 0 ? `, ${plural(items.length, "card")}` : ""}`}
      aria-pressed={selected}
      className={cn(
        "focus-visible:ring-ring/50 flex min-h-14 flex-col items-center gap-1 py-1.5 transition-[background-color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-inset",
        inMonth ? "bg-card" : "bg-muted",
        selected && "bg-accent",
        isDropTarget && DROP_TARGET
      )}
      onClick={onSelect}
      ref={ref}
      type="button"
    >
      <DayNumber day={day} inMonth={inMonth} today={today} />
      <span aria-hidden className="flex gap-0.5">
        {items.slice(0, MAX_CHIPS).map((item) => (
          <span
            className={cn(
              "size-1 rounded-full",
              overdue ? "bg-destructive" : "bg-foreground/40"
            )}
            key={taskKey(item)}
          />
        ))}
      </span>
    </button>
  );
}

/** Cards without a date, to drag onto a day; a dated card dropped here loses its date. */
function NoDateTray({
  items,
  scopes,
}: {
  items: MyCard[];
  scopes: Map<string, BoardScope>;
}) {
  const { ref, isDropTarget } = useDroppable({
    accept: "card",
    id: NO_DATE,
    type: "day",
  });
  return (
    <section
      aria-label="No date"
      className={cn(
        "bg-muted/60 flex flex-col gap-1 rounded-2xl p-1.5 transition-[background-color,box-shadow] duration-150 lg:min-h-32",
        isDropTarget && DROP_TARGET
      )}
      ref={ref}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 pl-1.5">
        <h3 className="text-sm font-medium">No date</h3>
        <span className="text-muted-foreground text-sm tabular-nums">
          {items.length}
        </span>
      </div>
      {/* Takes the calendar's height beside it, and scrolls within it. */}
      <div className="-m-1.5 flex flex-col gap-1 overflow-y-auto p-1.5 lg:h-0 lg:grow">
        {items.map((item) => (
          <Chip
            className="h-8 text-sm"
            item={item}
            key={taskKey(item)}
            scopes={scopes}
          />
        ))}
      </div>
    </section>
  );
}

function SelectedDay({
  day,
  items,
  scopes,
}: {
  day: Date;
  items: MyCard[];
  scopes: Map<string, BoardScope>;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-sm font-medium">
        {format(day, "EEEE, MMMM d")}
      </h3>
      {items.length > 0 ? (
        <ul className="flex flex-col">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <TaskRow item={item} key={taskKey(item)} scopes={scopes} />
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="text-muted-foreground px-1 text-sm">Nothing due</p>
      )}
    </section>
  );
}

interface TaskCalendarProps {
  tasks: MyCard[];
  scopes: Map<string, BoardScope>;
}

/** The cards on a month, by due date; dragging one to another day moves its date. */
export function TaskCalendar({ tasks, scopes }: TaskCalendarProps) {
  const compact = useIsMobile();
  const today = startOfToday();
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [selected, setSelected] = useState(() => isoDay(today));
  const [trayOpen, toggleTray] = useTray();

  const days = eachDayOfInterval({
    end: endOfWeek(endOfMonth(month), { weekStartsOn: WEEK_STARTS_ON }),
    start: startOfWeek(month, { weekStartsOn: WEEK_STARTS_ON }),
  });
  const sorted = tasks.toSorted(compareTasks);
  const byDay = new Map<string, MyCard[]>();
  for (const item of sorted) {
    if (item.card.due) {
      byDay.set(item.card.due, [...(byDay.get(item.card.due) ?? []), item]);
    }
  }
  const undated = sorted.filter((item) => !item.card.due);
  const byKey = new Map(tasks.map((item) => [taskKey(item), item]));

  const drop = (event: DragEndEvent) => {
    const { source, target } = event.operation;
    const item = source ? byKey.get(String(source.id)) : undefined;
    if (event.canceled || !item || !target) {
      return;
    }
    const due = target.id === NO_DATE ? undefined : String(target.id);
    if (due !== item.card.due) {
      updateCard(item.board, item.card, { due });
    }
  };

  return (
    <DragDropProvider onDragEnd={drop} sensors={SENSORS}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate font-medium">
            {format(month, "MMMM yyyy")}
          </h3>
          <Button
            disabled={isSameMonth(month, today)}
            onClick={() => setMonth(startOfMonth(today))}
            size="sm"
            variant="outline"
          >
            Today
          </Button>
          <FluidTooltip.Group>
            <IconButton
              label="Previous month"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <ChevronLeftIcon />
            </IconButton>
            <IconButton
              label="Next month"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <ChevronRightIcon />
            </IconButton>
            <IconButton
              aria-pressed={trayOpen}
              label="Cards without a date"
              onClick={toggleTray}
            >
              {trayOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
            </IconButton>
          </FluidTooltip.Group>
        </div>
        <div
          className={cn(
            "grid gap-3",
            trayOpen && "lg:grid-cols-[minmax(0,1fr)_14rem]"
          )}
        >
          <div className="bg-border shadow-surface grid grid-cols-7 gap-px overflow-hidden rounded-2xl">
            {days.slice(0, 7).map((day) => (
              <div
                className="bg-card text-muted-foreground flex h-8 items-center justify-center text-xs font-medium sm:justify-start sm:px-2.5"
                key={day.getDay()}
              >
                <abbr className="no-underline" title={format(day, "EEEE")}>
                  {format(day, compact ? "EEEEE" : "EEE")}
                </abbr>
              </div>
            ))}
            {days.map((day) => {
              const items = byDay.get(isoDay(day)) ?? [];
              return compact ? (
                <CompactDay
                  day={day}
                  items={items}
                  key={day.getTime()}
                  month={month}
                  onSelect={() => setSelected(isoDay(day))}
                  selected={isoDay(day) === selected}
                  today={today}
                />
              ) : (
                <Day
                  day={day}
                  items={items}
                  key={day.getTime()}
                  month={month}
                  scopes={scopes}
                  today={today}
                />
              );
            })}
          </div>
          {/* On a phone the picked day's cards come first, under the month. */}
          {compact && (
            <SelectedDay
              day={parseISO(selected)}
              items={byDay.get(selected) ?? []}
              scopes={scopes}
            />
          )}
          {trayOpen && <NoDateTray items={undated} scopes={scopes} />}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {(source) => {
          const item = byKey.get(String(source.id));
          return (
            item && (
              <div
                className={cn(
                  CHIP,
                  "bg-card shadow-raised h-full rotate-2 text-xs"
                )}
              >
                <ChipBody card={item.card} overdue={false} />
              </div>
            )
          );
        }}
      </DragOverlay>
    </DragDropProvider>
  );
}
