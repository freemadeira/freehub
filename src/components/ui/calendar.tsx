import { cn } from "cn";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
} from "lucide-react";
import * as React from "react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";
import type {
  ChevronProps,
  DayButtonProps,
  RootProps,
  WeekNumberProps,
} from "react-day-picker";

import { Button, buttonVariants } from "@/components/ui/button";

const CHEVRONS = {
  down: ChevronDownIcon,
  left: ChevronLeftIcon,
  right: ChevronRightIcon,
  up: ChevronUpIcon,
};

function CalendarChevron({
  className,
  orientation = "down",
  ...props
}: ChevronProps) {
  const Icon = CHEVRONS[orientation];
  return <Icon className={cn("size-4", className)} {...props} />;
}

function CalendarRoot({ className, rootRef, ...props }: RootProps) {
  return (
    <div className={className} data-slot="calendar" ref={rootRef} {...props} />
  );
}

function CalendarWeekNumber({ children, ...props }: WeekNumberProps) {
  return (
    <td {...props}>
      <div className="flex size-(--cell-size) items-center justify-center text-center">
        {children}
      </div>
    </td>
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: DayButtonProps) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) {
      ref.current?.focus();
    }
  }, [modifiers.focused]);

  return (
    <Button
      variant="ghost"
      size="icon"
      data-day={day.isoDate}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      ref={ref}
      className={cn(
        "group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:bg-muted data-[range-middle=true]:text-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground dark:hover:text-foreground relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-r-(--cell-radius) data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-l-(--cell-radius) [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "group/calendar [--cell-radius:9999px] [--cell-size:--spacing(9)]",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(locale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={{
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        caption_label: cn(
          "font-medium select-none",
          captionLayout === "label"
            ? "text-sm"
            : "[&>svg]:text-muted-foreground flex items-center gap-1 rounded-(--cell-radius) text-sm [&>svg]:size-3.5",
          defaultClassNames.caption_label
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)"
            : "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)",
          defaultClassNames.day
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        dropdown: cn(
          "bg-popover absolute inset-0 opacity-0",
          defaultClassNames.dropdown
        ),
        dropdown_root: cn(
          "relative rounded-(--cell-radius)",
          defaultClassNames.dropdown_root
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        range_end: cn(
          "bg-muted after:bg-muted relative isolate z-0 rounded-r-(--cell-radius) after:absolute after:inset-y-0 after:left-0 after:w-4",
          defaultClassNames.range_end
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_start: cn(
          "bg-muted after:bg-muted relative isolate z-0 rounded-l-(--cell-radius) after:absolute after:inset-y-0 after:right-0 after:w-4",
          defaultClassNames.range_start
        ),
        root: cn("w-fit", defaultClassNames.root),
        today: cn(
          "bg-muted text-foreground rounded-(--cell-radius) data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number: cn(
          "text-muted-foreground text-[0.8rem] select-none",
          defaultClassNames.week_number
        ),
        week_number_header: cn(
          "w-(--cell-size) select-none",
          defaultClassNames.week_number_header
        ),
        weekday: cn(
          "text-muted-foreground flex-1 rounded-(--cell-radius) text-[0.8rem] font-normal select-none",
          defaultClassNames.weekday
        ),
        weekdays: cn("flex", defaultClassNames.weekdays),
        ...classNames,
      }}
      components={{
        Chevron: CalendarChevron,
        DayButton: CalendarDayButton,
        Root: CalendarRoot,
        WeekNumber: CalendarWeekNumber,
        ...components,
      }}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
