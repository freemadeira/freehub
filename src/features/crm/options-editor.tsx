import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";

import { ColorPicker } from "@/components/color-picker";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
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
import type { Field, FieldOption, StageKind } from "@/lib/crm";
import { shortId } from "@/lib/crm";
import { COLORS, SWATCH_COLORS } from "@/lib/palette";

const KINDS: { value: StageKind; label: string }[] = [
  { label: "In progress", value: "open" },
  { label: "Won", value: "won" },
  { label: "Lost", value: "lost" },
];

export function swap<T>(items: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= items.length) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item !== undefined) {
    next.splice(target, 0, item);
  }
  return next;
}

function OptionRow({
  field,
  option,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  field: Field;
  option: FieldOption;
  index: number;
  count: number;
  onChange: (option: FieldOption) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger
          aria-label={`Color of ${option.label}`}
          className="hover:bg-foreground/5 focus-visible:ring-ring/50 flex size-8 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-3"
        >
          <span
            className={cn("size-3.5 rounded-full", SWATCH_COLORS[option.color])}
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <ColorPicker
            className="w-44"
            onChange={(color) => onChange({ ...option, color })}
            value={option.color}
          />
        </PopoverContent>
      </Popover>
      <input
        aria-label="Option name"
        className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 dark:bg-input/30 h-8 min-w-0 flex-1 rounded-lg border px-2.5 text-base outline-none focus-visible:ring-3 md:text-sm"
        onChange={(event) => onChange({ ...option, label: event.target.value })}
        value={option.label}
      />
      {field.type === "stage" && (
        <Select
          items={KINDS}
          onValueChange={(kind: StageKind | null) => {
            if (kind) {
              onChange({ ...option, kind });
            }
          }}
          value={option.kind}
        >
          <SelectTrigger
            aria-label={`What ${option.label} means`}
            className="h-8 w-32 shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((kind) => (
              <SelectItem key={kind.value} value={kind.value}>
                {kind.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="flex shrink-0 items-center max-sm:hidden">
        <IconButton
          disabled={index === 0}
          label="Move up"
          onClick={() => onMove(-1)}
          size="icon-xs"
        >
          <ArrowUpIcon />
        </IconButton>
        <IconButton
          disabled={index === count - 1}
          label="Move down"
          onClick={() => onMove(1)}
          size="icon-xs"
        >
          <ArrowDownIcon />
        </IconButton>
      </div>
      <IconButton
        label={`Remove ${option.label}`}
        onClick={onRemove}
        size="icon-xs"
      >
        <XIcon />
      </IconButton>
    </li>
  );
}

/** Edits the choices of a select, multi-select or stage field. */
export function OptionsEditor({
  field,
  onChange,
}: {
  field: Field;
  onChange: (options: FieldOption[]) => void;
}) {
  const { options } = field;
  const add = () => {
    const color = COLORS[(options.length + 1) % COLORS.length] ?? "gray";
    onChange([
      ...options,
      {
        color,
        id: shortId(),
        kind: "open",
        label: `Option ${options.length + 1}`,
      },
    ]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {options.length > 0 && (
        <ul className="flex flex-col gap-1">
          {options.map((option, index) => (
            <OptionRow
              count={options.length}
              field={field}
              index={index}
              key={option.id}
              onChange={(next) =>
                onChange(
                  options.map((item) => (item.id === option.id ? next : item))
                )
              }
              onMove={(offset) => onChange(swap(options, index, offset))}
              onRemove={() =>
                onChange(options.filter((item) => item.id !== option.id))
              }
              option={option}
            />
          ))}
        </ul>
      )}
      <Button
        className="self-start"
        onClick={add}
        size="sm"
        type="button"
        variant="ghost"
      >
        <PlusIcon />
        {field.type === "stage" ? "Add stage" : "Add option"}
      </Button>
    </div>
  );
}
