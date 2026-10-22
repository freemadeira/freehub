import { cn } from "cn";
import type { ComponentProps, KeyboardEvent } from "react";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { RefOption } from "@/components/ref-options";
import { RefOptionRow } from "@/components/ref-options";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { RefSearch } from "@/features/search/ref-search";
import { useProfileNames } from "@/hooks/use-profile-names";
import type { Mention } from "@/lib/mentions";
import { mentionNames } from "@/lib/mentions";
import type { PickedRef } from "@/lib/refs";
import { labelFor } from "@/lib/refs";

const MAX_SUGGESTIONS = 8;
const MAX_QUERY = 40;
const WHITESPACE = /\s/u;
/** What a `#` needs right after it to start a reference, so `# ` and `##` stay text. */
const WORD_START = /^[\p{L}\p{N}]/u;

// What the hidden copy of the textarea needs to wrap text exactly like it.
const MIRRORED = [
  "box-sizing",
  "width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "line-height",
  "text-transform",
  "word-spacing",
  "text-indent",
  "tab-size",
] as const;

/** `@` lists people to mention, `#` things to reference. */
type TriggerChar = "@" | "#";

interface Found {
  char: TriggerChar;
  /** Index of the `@` or `#`. */
  start: number;
  query: string;
}

interface Trigger extends Found {
  element: HTMLTextAreaElement;
  /** Where the `@` or `#` sits inside the textarea, for placing the list. */
  offset: { left: number; top: number; height: number };
}

/**
 * The `@query` or `#query` the caret is in, if any. Either must start a word,
 * so emails and `C#` don't count, and a `#` needs a letter or digit after it.
 */
function findQuery(
  text: string,
  caret: number,
  char: TriggerChar
): Found | undefined {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf(char);
  if (
    start === -1 ||
    (start > 0 && !WHITESPACE.test(before[start - 1] ?? ""))
  ) {
    return undefined;
  }
  const query = before.slice(start + 1);
  return query.length > MAX_QUERY ||
    query.includes("\n") ||
    query.startsWith(" ") ||
    (char === "#" && !WORD_START.test(query))
    ? undefined
    : { char, query, start };
}

/** The `@` or `#` nearest the caret, of those the field offers. */
function findTrigger(
  text: string,
  caret: number,
  withRefs: boolean
): Found | undefined {
  const mention = findQuery(text, caret, "@");
  const ref = withRefs ? findQuery(text, caret, "#") : undefined;
  return ref && !(mention && mention.start > ref.start) ? ref : mention;
}

// Measures the character with a hidden copy of the textarea that wraps the same way.
function offsetOf(textarea: HTMLTextAreaElement, index: number) {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement("div");
  for (const property of MIRRORED) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  Object.assign(mirror.style, {
    left: "-9999px",
    overflowWrap: "break-word",
    position: "absolute",
    top: "0",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
  });
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = "@";
  mirror.append(marker);
  document.body.append(mirror);
  const offset = {
    height: marker.offsetHeight,
    left: marker.offsetLeft,
    top: marker.offsetTop - textarea.scrollTop,
  };
  mirror.remove();
  return offset;
}

type MentionTextareaProps = Omit<
  ComponentProps<typeof Textarea>,
  "value" | "onChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** People who can be mentioned. */
  people: string[];
  /** Someone was picked; their name now sits in the text as `@Name`. */
  onMention: (mention: Mention) => void;
  /**
   * With it, `#` offers what there is to reference: catalog links, cards,
   * doc pages, Drive files and CRM records, in the project given if any.
   */
  refs?: { project?: string };
  /** Something was picked from the `#` list; it now sits in the text as `#Label`. */
  onRef?: (picked: PickedRef) => void;
};

/**
 * A textarea that suggests people after `@` and inserts the picked name.
 * With `refs`, `#` suggests things to reference and inserts the picked title.
 */
export function MentionTextarea({
  value,
  onValueChange,
  people,
  onMention,
  refs,
  onRef,
  onKeyDown,
  className,
  ...props
}: MentionTextareaProps) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const profileNames = useProfileNames(people);
  const names = mentionNames(people, profileNames);
  const [trigger, setTrigger] = useState<Trigger>();
  const [active, setActive] = useState(0);
  // Escape hides the list for this `@` or `#` only; typing a new one shows it again.
  const dismissed = useRef<number | null>(null);
  // What was picked from the `#` list here, so picking it again keeps its label.
  const picks = useRef<PickedRef[]>([]);
  const [refOptions, setRefOptions] = useState<RefOption[]>([]);

  const referencing = trigger?.char === "#";
  const options = referencing ? refOptions : [];
  const query = trigger?.query.toLowerCase() ?? "";
  const matches =
    trigger && !referencing
      ? people
          .filter((pubkey) =>
            (names.get(pubkey) ?? "").toLowerCase().includes(query)
          )
          .slice(0, MAX_SUGGESTIONS)
      : [];
  const count = referencing ? options.length : matches.length;
  const open = count > 0;
  const highlighted = Math.min(active, count - 1);

  const sync = () => {
    const element = textarea.current;
    const found = element
      ? findTrigger(element.value, element.selectionStart, refs !== undefined)
      : undefined;
    if (!(element && found) || found.start === dismissed.current) {
      setTrigger(undefined);
      if (!found) {
        dismissed.current = null;
      }
      return;
    }
    if (found.start !== trigger?.start) {
      setActive(0);
    }
    setTrigger({ ...found, element, offset: offsetOf(element, found.start) });
  };

  // What was typed after the `@` or `#` gives way to the pick and a space.
  const insert = (current: Trigger, inserted: string) => {
    const { element } = current;
    const caret = current.start + inserted.length;
    flushSync(() => {
      onValueChange(
        value.slice(0, current.start) +
          inserted +
          value.slice(element.selectionStart)
      );
      setTrigger(undefined);
    });
    element.setSelectionRange(caret, caret);
  };

  const pick = (pubkey: string) => {
    if (!trigger) {
      return;
    }
    const name = names.get(pubkey) ?? "";
    insert(trigger, `@${name} `);
    onMention({ name, pubkey });
  };

  const pickRef = (item: RefOption) => {
    if (!trigger) {
      return;
    }
    // The words being typed after the `#` aren't a label yet.
    const around =
      value.slice(0, trigger.start) +
      value.slice(trigger.element.selectionStart);
    const picked = {
      label: labelFor(item.title, item.url, around, picks.current),
      url: item.url,
    };
    insert(trigger, `#${picked.label} `);
    picks.current = [...picks.current, picked];
    onRef?.(picked);
  };

  const choose = (index: number) => {
    const item = options[index];
    const pubkey = matches[index];
    if (referencing && item) {
      pickRef(item);
    } else if (pubkey) {
      pick(pubkey);
    }
  };

  const dismiss = () => {
    dismissed.current = trigger?.start ?? null;
    setTrigger(undefined);
  };

  const navigate = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    switch (event.key) {
      case "ArrowDown": {
        setActive((highlighted + 1) % count);
        return true;
      }
      case "ArrowUp": {
        setActive((highlighted - 1 + count) % count);
        return true;
      }
      case "Enter":
      case "Tab": {
        choose(highlighted);
        return true;
      }
      case "Escape": {
        // Closes the list, not the dialog around the field.
        event.stopPropagation();
        dismiss();
        return true;
      }
      default: {
        return false;
      }
    }
  };

  const anchor = trigger && {
    contextElement: trigger.element,
    getBoundingClientRect: () => {
      const rect = trigger.element.getBoundingClientRect();
      return DOMRect.fromRect({
        height: trigger.offset.height,
        width: 0,
        x: rect.left + trigger.offset.left,
        y: rect.top + trigger.offset.top,
      });
    },
  };

  const rows = referencing
    ? options.map((item) => ({
        content: <RefOptionRow option={item} />,
        key: item.key,
      }))
    : matches.map((pubkey) => ({
        content: (
          <>
            <UserAvatar aria-hidden pubkey={pubkey} size="xs" />
            <span className="truncate">{names.get(pubkey)}</span>
          </>
        ),
        key: pubkey,
      }));

  return (
    <Popover
      onOpenChange={(next, { event }) => {
        // A click in the field only moves the caret; `onSelect` decides then.
        const inField =
          event.target instanceof Node &&
          trigger?.element.contains(event.target);
        if (!(next || inField)) {
          dismiss();
        }
      }}
      open={open}
    >
      <Textarea
        {...props}
        aria-activedescendant={open ? `${id}-${highlighted}` : undefined}
        aria-autocomplete="list"
        aria-controls={open ? id : undefined}
        className={className}
        onChange={(event) => {
          onValueChange(event.target.value);
          sync();
        }}
        onKeyDown={(event) => {
          if (open && !event.nativeEvent.isComposing && navigate(event)) {
            event.preventDefault();
            return;
          }
          onKeyDown?.(event);
        }}
        onSelect={sync}
        ref={textarea}
        value={value}
      />
      {referencing && trigger && (
        <RefSearch
          onOptions={setRefOptions}
          project={refs?.project}
          query={trigger.query}
        />
      )}
      <PopoverContent
        align="start"
        anchor={anchor}
        className={cn("p-1", referencing ? "w-80" : "w-60")}
        finalFocus={false}
        initialFocus={false}
        sideOffset={4}
      >
        <div
          aria-label={referencing ? "References" : "People"}
          className="flex flex-col"
          id={id}
          // A native select can't open at the caret, so this is an ARIA listbox.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="listbox"
        >
          {rows.map((row, index) => (
            <div
              aria-selected={index === highlighted}
              className={cn(
                "flex h-8 cursor-default items-center gap-2 rounded-lg px-2 text-sm select-none",
                index === highlighted && "bg-accent text-accent-foreground"
              )}
              id={`${id}-${index}`}
              key={row.key}
              // Picking on mousedown keeps focus, and the caret, in the field.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(index);
              }}
              onMouseEnter={() => setActive(index)}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
              role="option"
              tabIndex={-1}
            >
              {row.content}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
