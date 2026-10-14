import { cn } from "cn";
import type {
  EmojiPickerListCategoryHeaderProps,
  EmojiPickerListEmojiProps,
  EmojiPickerListRowProps,
  SkinTone,
} from "frimousse";
import { EmojiPicker as Picker } from "frimousse";
import type { ReactElement, RefObject } from "react";
import { useRef, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { readStorage, writeStorage } from "@/lib/utils";

/** Served with the app, so the picker works offline and asks no CDN. See vite.config.ts. */
const EMOJIBASE_URL = "/emojibase";
const RECENT_KEY = "emoji:recent";
const TONE_KEY = "emoji:tone";
const COLUMNS = 9;
/** Offered before any have been picked, and after those that have. */
const STARTERS = ["👍", "❤️", "😄", "🎉", "👀", "🚀", "🙏", "✅", "🔥"];
const TONES: SkinTone[] = [
  "none",
  "light",
  "medium-light",
  "medium",
  "medium-dark",
  "dark",
];

const EMOJI_BUTTON =
  "flex size-8 items-center justify-center rounded-lg text-xl leading-none transition-colors duration-100 outline-none";
const HEADER = "text-muted-foreground px-3 pt-3 pb-1 text-xs font-medium";

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(readStorage(RECENT_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item) => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** The emoji picked last, then the starters, a row's worth. */
function quickRow(): string[] {
  return [...new Set([...readRecent(), ...STARTERS])].slice(0, COLUMNS);
}

function remember(emoji: string) {
  const recent = [emoji, ...readRecent().filter((item) => item !== emoji)];
  writeStorage(RECENT_KEY, JSON.stringify(recent.slice(0, COLUMNS)));
}

function readTone(): SkinTone {
  return TONES.find((tone) => tone === readStorage(TONE_KEY)) ?? "none";
}

function CategoryHeader({
  category,
  ...props
}: EmojiPickerListCategoryHeaderProps) {
  return (
    <div {...props} className={cn("bg-popover", HEADER)}>
      {category.label}
    </div>
  );
}

function Row({ children, ...props }: EmojiPickerListRowProps) {
  return (
    <div {...props} className="scroll-my-1.5 px-1.5">
      {children}
    </div>
  );
}

function Emoji({ emoji, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(EMOJI_BUTTON, "data-active:bg-accent")}
    >
      {emoji.emoji}
    </button>
  );
}

const LIST = { CategoryHeader, Emoji, Row };

/** Cycles through the skin tones, and keeps the one landed on. */
function ToneButton() {
  return (
    <Picker.SkinTone emoji="👋">
      {({ skinTone, setSkinTone, skinToneVariations }) => {
        const at = skinToneVariations.findIndex(
          (variation) => variation.skinTone === skinTone
        );
        const next =
          skinToneVariations[(at + 1) % skinToneVariations.length]?.skinTone ??
          "none";
        return (
          <button
            aria-label="Change skin tone"
            className={cn(
              EMOJI_BUTTON,
              "hover:bg-accent focus-visible:bg-accent mr-1 shrink-0 text-lg"
            )}
            onClick={() => {
              setSkinTone(next);
              writeStorage(TONE_KEY, next);
            }}
            title="Skin tone"
            type="button"
          >
            {skinToneVariations[at]?.emoji ?? "👋"}
          </button>
        );
      }}
    </Picker.SkinTone>
  );
}

/** Every emoji there is, searchable by name, with the ones used lately first. */
function EmojiList({
  onPick,
  search,
}: {
  onPick: (emoji: string) => void;
  search: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState("");

  const pick = (emoji: string) => {
    remember(emoji);
    onPick(emoji);
  };

  return (
    <Picker.Root
      className="flex h-88 max-h-(--available-height) flex-col"
      columns={COLUMNS}
      emojibaseUrl={EMOJIBASE_URL}
      onEmojiSelect={({ emoji }) => pick(emoji)}
      skinTone={readTone()}
    >
      <div className="flex shrink-0 items-center border-b">
        <Picker.Search
          aria-label="Search emoji"
          autoCapitalize="off"
          autoCorrect="off"
          className="placeholder:text-muted-foreground h-10 min-w-0 flex-1 bg-transparent px-3 text-base outline-none md:text-sm"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search emoji…"
          ref={search}
          spellCheck={false}
          value={query}
        />
        <ToneButton />
      </div>
      {query.trim() === "" && (
        <div className="shrink-0">
          <div className={HEADER}>Frequently used</div>
          <div className="flex px-1.5">
            {quickRow().map((emoji) => (
              <button
                aria-label={emoji}
                className={cn(
                  EMOJI_BUTTON,
                  "hover:bg-accent focus-visible:bg-accent"
                )}
                key={emoji}
                onClick={() => pick(emoji)}
                type="button"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
      <Picker.Viewport className="relative min-h-0 flex-1 outline-none">
        <Picker.Loading className="text-muted-foreground absolute inset-0 flex items-center justify-center">
          <Spinner />
        </Picker.Loading>
        <Picker.Empty className="text-muted-foreground absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-balance">
          {({ search: text }) => `No emoji match “${text.trim()}”.`}
        </Picker.Empty>
        <Picker.List className="pb-1.5 select-none" components={LIST} />
      </Picker.Viewport>
    </Picker.Root>
  );
}

/**
 * Picks an emoji from a popover that `trigger` opens, and closes. The search
 * takes focus, except on touch, where a keyboard would cover the list.
 */
export function EmojiPicker({
  onPick,
  trigger,
}: {
  onPick: (emoji: string) => void;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="start"
        className="w-auto overflow-hidden p-0"
        initialFocus={(type) => type === "touch" || (search.current ?? true)}
      >
        <EmojiList
          onPick={(emoji) => {
            setOpen(false);
            onPick(emoji);
          }}
          search={search}
        />
      </PopoverContent>
    </Popover>
  );
}
