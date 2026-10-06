import { cn } from "cn";
import { format, parseISO } from "date-fns";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  MailIcon,
  PhoneIcon,
  SearchIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useCrm } from "@/features/crm/crm-context";
import { OptionChip, Person, webHref } from "@/features/crm/values";
import type { Field } from "@/lib/crm";
import { findOption, recordTitle, relationTarget } from "@/lib/crm";
import {
  formatCurrency,
  formatDay,
  formatNumber,
  isChecked,
  parseCell,
  toNumber,
} from "@/lib/crm-values";

/** Looks like plain text until hovered, like the card properties. */
export const VALUE =
  "h-8 w-full min-w-0 rounded-lg px-2 text-sm outline-none transition-[background-color,box-shadow] duration-150 hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/30 data-popup-open:bg-foreground/5";
const MAX_MATCHES = 50;

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

interface FieldInputProps {
  id: string;
  field: Field;
  values: string[];
  onChange: (values: string[]) => void;
}

function displayText(field: Field, value: string | undefined): string {
  const number = toNumber(value);
  if (field.type === "currency" && number !== undefined) {
    return formatCurrency(number, field.config || "EUR");
  }
  if (field.type === "number" && number !== undefined) {
    return formatNumber(number);
  }
  return value ?? "";
}

function linkFor(field: Field, value: string): string | undefined {
  if (field.type === "url") {
    return webHref(value);
  }
  if (field.type === "email") {
    return `mailto:${value}`;
  }
  if (field.type === "phone") {
    return `tel:${value.replaceAll(/\s/gu, "")}`;
  }
  return undefined;
}

const LINK_ICONS = { email: MailIcon, phone: PhoneIcon, url: ExternalLinkIcon };

// Typing stays local until the field loses focus, so teammates' edits never overwrite it mid-word.
function TextInput({ id, field, values, onChange }: FieldInputProps) {
  const [draft, setDraft] = useState<string>();
  const [value] = values;
  const numeric = field.type === "number" || field.type === "currency";
  const href = value ? linkFor(field, value) : undefined;
  const LinkIcon =
    field.type === "url" || field.type === "email" || field.type === "phone"
      ? LINK_ICONS[field.type]
      : undefined;

  const commit = () => {
    if (draft === undefined) {
      return;
    }
    const next = numeric
      ? parseCell(field, draft)
      : [draft.trim()].filter(Boolean);
    // Text that isn't a number leaves the old value alone rather than clearing it.
    const unreadable = numeric && next.length === 0 && draft.trim() !== "";
    if (!unreadable && JSON.stringify(next) !== JSON.stringify(values)) {
      onChange(next);
    }
    setDraft(undefined);
  };

  let type = "text";
  if (field.type === "email") {
    type = "email";
  } else if (field.type === "phone") {
    type = "tel";
  } else if (field.type === "url") {
    type = "url";
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <input
        autoComplete="off"
        className={cn(
          VALUE,
          "placeholder:text-muted-foreground bg-transparent"
        )}
        id={id}
        inputMode={numeric ? "decimal" : undefined}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setDraft(value ?? "")}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.currentTarget.blur();
          }
        }}
        placeholder="Empty"
        spellCheck={field.type === "text"}
        type={type}
        value={draft ?? displayText(field, value)}
      />
      {href && LinkIcon && (
        <Button
          className="text-muted-foreground shrink-0"
          nativeButton={false}
          render={
            <a
              aria-label={`Open ${field.name}`}
              href={href}
              rel="noreferrer"
              target={field.type === "url" ? "_blank" : undefined}
            />
          }
          size="icon-sm"
          variant="ghost"
        >
          <LinkIcon />
        </Button>
      )}
    </div>
  );
}

function LongTextInput({ id, values, onChange }: FieldInputProps) {
  const [draft, setDraft] = useState<string>();
  const value = values[0] ?? "";
  return (
    <textarea
      className={cn(
        VALUE,
        "placeholder:text-muted-foreground field-sizing-content h-auto min-h-8 resize-none bg-transparent py-1.5 leading-relaxed"
      )}
      id={id}
      onBlur={() => {
        if (draft !== undefined && draft.trim() !== value) {
          onChange([draft.trim()].filter(Boolean));
        }
        setDraft(undefined);
      }}
      onChange={(event) => setDraft(event.target.value)}
      placeholder="Empty"
      rows={1}
      value={draft ?? value}
    />
  );
}

interface Option<T> {
  value: T;
  label: ReactNode;
}

function SingleSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string | null;
  options: Option<string>[];
  onChange: (value: string | null) => void;
}) {
  const items: Option<string | null>[] = [
    { label: <Muted>Empty</Muted>, value: null },
    ...options,
  ];
  const known = options.some((option) => option.value === value);
  return (
    <Select
      items={items}
      onValueChange={(next: string | null) => onChange(next)}
      value={known ? value : null}
    >
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
        {items.map((item) => (
          <SelectItem key={item.value ?? "none"} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OptionsInput({ id, field, values, onChange }: FieldInputProps) {
  return (
    <SingleSelect
      id={id}
      onChange={(next) => onChange(next ? [next] : [])}
      options={field.options.map((option) => ({
        label: <OptionChip dot={field.type === "stage"} option={option} />,
        value: option.id,
      }))}
      value={values[0] ?? null}
    />
  );
}

function MultiInput({ id, field, values, onChange }: FieldInputProps) {
  const selected = values.filter((value) => findOption(field, value));
  return (
    <Select
      multiple
      onValueChange={(next: string[]) =>
        onChange(
          field.options.flatMap((option) =>
            next.includes(option.id) ? [option.id] : []
          )
        )
      }
      value={selected}
    >
      <SelectTrigger
        className={cn(
          VALUE,
          "h-auto min-h-8 border-transparent bg-transparent py-1 dark:bg-transparent"
        )}
        id={id}
      >
        <SelectValue className="flex-wrap items-center gap-1 whitespace-normal">
          {(current: string[]) =>
            current.length > 0 ? (
              current.map((value) => {
                const option = findOption(field, value);
                return option ? (
                  <OptionChip key={value} option={option} />
                ) : null;
              })
            ) : (
              <Muted>Empty</Muted>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {field.options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            <OptionChip option={option} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MemberInput({ id, values, onChange }: FieldInputProps) {
  const { project } = useCrm();
  const [value] = values;
  const people =
    value && !project.members.includes(value)
      ? [...project.members, value]
      : project.members;
  return (
    <SingleSelect
      id={id}
      onChange={(next) => onChange(next ? [next] : [])}
      options={people.map((pubkey) => ({
        label: <Person pubkey={pubkey} />,
        value: pubkey,
      }))}
      value={value ?? null}
    />
  );
}

function RelationInput({ id, field, values, onChange }: FieldInputProps) {
  const { content } = useCrm();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const target = relationTarget(field, content);
  const candidates = target ? (content.byTable.get(target.id) ?? []) : [];
  const needle = query.trim().toLowerCase();
  const matches = candidates
    .filter((record) => recordTitle(record).toLowerCase().includes(needle))
    .slice(0, MAX_MATCHES);
  const current = values[0] ? content.byId.get(values[0]) : undefined;

  const pick = (next?: string) => {
    onChange(next ? [next] : []);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        className={cn(
          VALUE,
          "flex items-center justify-between gap-2 text-left select-none"
        )}
        disabled={!target}
        id={id}
      >
        {current ? (
          <span className="truncate">{recordTitle(current)}</span>
        ) : (
          <Muted>{target ? "Empty" : "Table was deleted"}</Muted>
        )}
        <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-1 p-1">
        <label className="flex items-center gap-2 px-2">
          <SearchIcon className="text-muted-foreground size-4 shrink-0" />
          <input
            aria-label={`Search ${target?.title ?? "records"}`}
            autoComplete="off"
            className="placeholder:text-muted-foreground h-9 min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${target?.title.toLowerCase() ?? ""}…`}
            value={query}
          />
        </label>
        <div className="bg-border -mx-1 h-px" />
        <ul className="flex max-h-64 flex-col overflow-y-auto">
          {current && (
            <li>
              <button
                className="hover:bg-accent text-muted-foreground focus-visible:bg-accent flex h-8 w-full items-center rounded-lg px-2 text-left text-sm outline-none"
                onClick={() => pick()}
                type="button"
              >
                Remove link
              </button>
            </li>
          )}
          {matches.map((record) => (
            <li key={record.id}>
              <button
                className={cn(
                  "hover:bg-accent focus-visible:bg-accent flex h-8 w-full items-center rounded-lg px-2 text-left text-sm outline-none",
                  record.id === current?.id && "font-medium"
                )}
                onClick={() => pick(record.id)}
                type="button"
              >
                <span className="truncate">{recordTitle(record)}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="text-muted-foreground px-2 py-3 text-center text-sm">
              {candidates.length === 0
                ? `No ${target?.title.toLowerCase() ?? "records"} yet`
                : "No matches"}
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function DateInput({ id, values, onChange }: FieldInputProps) {
  const [open, setOpen] = useState(false);
  const [value] = values;
  const day = value ? parseISO(value) : undefined;
  const pick = (next?: Date) => {
    onChange(next ? [format(next, "yyyy-MM-dd")] : []);
    setOpen(false);
  };
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        className={cn(
          VALUE,
          "flex items-center justify-between gap-2 text-left select-none"
        )}
        id={id}
      >
        {value ? <span>{formatDay(value)}</span> : <Muted>Empty</Muted>}
        <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
      </PopoverTrigger>
      <PopoverContent align="start" className="flex flex-col gap-1 p-2">
        <Calendar
          defaultMonth={day}
          mode="single"
          onSelect={pick}
          selected={day}
        />
        {day && (
          <Button onClick={() => pick()} size="sm" variant="ghost">
            Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The right editor for a field's type, saving through `onChange`. */
export function FieldInput(props: FieldInputProps) {
  const { field, id, values, onChange } = props;
  switch (field.type) {
    case "select":
    case "stage": {
      return <OptionsInput {...props} />;
    }
    case "multiselect": {
      return <MultiInput {...props} />;
    }
    case "member": {
      return <MemberInput {...props} />;
    }
    case "relation": {
      return <RelationInput {...props} />;
    }
    case "date": {
      return <DateInput {...props} />;
    }
    case "checkbox": {
      return (
        <div className="flex h-8 items-center px-2">
          <Checkbox
            checked={isChecked(values)}
            id={id}
            onCheckedChange={(checked) => onChange(checked ? ["true"] : [])}
          />
        </div>
      );
    }
    case "longtext": {
      return <LongTextInput {...props} />;
    }
    default: {
      return <TextInput {...props} />;
    }
  }
}
