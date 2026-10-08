import { cn } from "cn";
import type { ComponentProps, KeyboardEvent } from "react";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { Popover, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { useProfileNames } from "@/hooks/use-profile-names";
import type { Mention } from "@/lib/mentions";
import { mentionNames } from "@/lib/mentions";

const MAX_SUGGESTIONS = 8;
const MAX_QUERY = 40;
const WHITESPACE = /\s/u;

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

interface Trigger {
  /** Index of the `@`. */
  start: number;
  query: string;
  element: HTMLTextAreaElement;
  /** Where the `@` sits inside the textarea, for placing the list. */
  offset: { left: number; top: number; height: number };
}

/** The `@query` the caret is in, if any. `@` must start a word, so emails don't count. */
function findQuery(
  text: string,
  caret: number
): { start: number; query: string } | undefined {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (
    start === -1 ||
    (start > 0 && !WHITESPACE.test(before[start - 1] ?? ""))
  ) {
    return undefined;
  }
  const query = before.slice(start + 1);
  return query.length > MAX_QUERY ||
    query.includes("\n") ||
    query.startsWith(" ")
    ? undefined
    : { query, start };
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
};

/** A textarea that suggests people after `@` and inserts the picked name. */
export function MentionTextarea({
  value,
  onValueChange,
  people,
  onMention,
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
  // Escape hides the list for this `@` only; typing a new one shows it again.
  const dismissed = useRef<number | null>(null);

  const query = trigger?.query.toLowerCase() ?? "";
  const matches = trigger
    ? people
        .filter((pubkey) =>
          (names.get(pubkey) ?? "").toLowerCase().includes(query)
        )
        .slice(0, MAX_SUGGESTIONS)
    : [];
  const open = matches.length > 0;
  const highlighted = Math.min(active, matches.length - 1);

  const sync = () => {
    const element = textarea.current;
    const found = element
      ? findQuery(element.value, element.selectionStart)
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

  const pick = (pubkey: string) => {
    if (!trigger) {
      return;
    }
    const { element } = trigger;
    const name = names.get(pubkey) ?? "";
    const inserted = `@${name} `;
    const caret = trigger.start + inserted.length;
    flushSync(() => {
      onValueChange(
        value.slice(0, trigger.start) +
          inserted +
          value.slice(element.selectionStart)
      );
      setTrigger(undefined);
    });
    element.setSelectionRange(caret, caret);
    onMention({ name, pubkey });
  };

  const dismiss = () => {
    dismissed.current = trigger?.start ?? null;
    setTrigger(undefined);
  };

  const navigate = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const count = matches.length;
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
        const pubkey = matches[highlighted];
        if (pubkey) {
          pick(pubkey);
        }
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
      <PopoverContent
        align="start"
        anchor={anchor}
        className="w-60 p-1"
        finalFocus={false}
        initialFocus={false}
        sideOffset={4}
      >
        <div
          aria-label="People"
          className="flex flex-col"
          id={id}
          // A native select can't open at the caret, so this is an ARIA listbox.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="listbox"
        >
          {matches.map((pubkey, index) => (
            <div
              aria-selected={index === highlighted}
              className={cn(
                "flex h-8 cursor-default items-center gap-2 rounded-lg px-2 text-sm select-none",
                index === highlighted && "bg-accent text-accent-foreground"
              )}
              id={`${id}-${index}`}
              key={pubkey}
              // Picking on mousedown keeps focus, and the caret, in the field.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(pubkey);
              }}
              onMouseEnter={() => setActive(index)}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
              role="option"
              tabIndex={-1}
            >
              <UserAvatar aria-hidden pubkey={pubkey} size="xs" />
              <span className="truncate">{names.get(pubkey)}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
