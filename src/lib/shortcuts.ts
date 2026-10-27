import type { AppHotkey, Hotkey } from "@tanstack/react-hotkeys";
import {
  defineAppHotkeys,
  formatForDisplay,
  isAppHotkey,
} from "@tanstack/react-hotkeys";

/** How long after a sequence's first key the next one still counts. */
const SEQUENCE_MS = 1500;
const SEQUENCE = { timeout: SEQUENCE_MS };

const APPLE = /Mac|iPhone|iPad/u.test(navigator.userAgent);

/** The cheat sheet's sections, in the order it lists them. */
export const SHORTCUT_GROUPS = ["General", "Navigation", "Cards"] as const;

/**
 * Every shortcut the app answers to, by what it does. The keys pressed, the
 * cheat sheet, and the hints in tooltips and menus all come from here. Listed
 * in the order the cheat sheet shows them.
 */
// oxlint-disable-next-line sort-keys
export const SHORTCUTS = defineAppHotkeys({
  "palette.open": {
    hotkey: "Mod+K",
    meta: { group: "General", name: "Command palette" },
    options: { requireReset: true },
  },
  "search.open": {
    hotkey: "/",
    meta: {
      description: "Or the page's own search, where it has one",
      group: "General",
      name: "Search",
    },
  },
  "card.new": { hotkey: "C", meta: { group: "General", name: "New card" } },
  "shortcuts.show": {
    hotkey: "?",
    meta: { group: "General", name: "Keyboard shortcuts" },
  },
  "sidebar.toggle": {
    hotkey: "Mod+B",
    meta: { group: "General", name: "Show or hide the sidebar" },
    // Held down, it toggles once.
    options: { requireReset: true },
  },
  "go.project": {
    hotkey: ["G", "P"],
    meta: { group: "Navigation", name: "Project…" },
    options: SEQUENCE,
  },
  "go.board": {
    hotkey: ["G", "B"],
    meta: { group: "Navigation", name: "Board…" },
    options: SEQUENCE,
  },
  "go.home": {
    hotkey: ["G", "H"],
    meta: { group: "Navigation", name: "Home" },
    options: SEQUENCE,
  },
  "go.inbox": {
    hotkey: ["G", "I"],
    meta: { group: "Navigation", name: "Inbox" },
    options: SEQUENCE,
  },
  "go.map": {
    hotkey: ["G", "M"],
    meta: { group: "Navigation", name: "Map" },
    options: SEQUENCE,
  },
  "go.docs": {
    hotkey: ["G", "D"],
    meta: {
      description: "Of the project you're in",
      group: "Navigation",
      name: "Docs",
    },
    options: SEQUENCE,
  },
  "go.drive": {
    hotkey: ["G", "F"],
    meta: {
      description: "Of the project you're in",
      group: "Navigation",
      name: "Drive",
    },
    options: SEQUENCE,
  },
  "card.next": { hotkey: "J", meta: { group: "Cards", name: "Next card" } },
  "card.previous": {
    hotkey: "K",
    meta: { group: "Cards", name: "Previous card" },
  },
  "card.leave": {
    hotkey: "Escape",
    meta: { group: "Cards", name: "Back to the board" },
  },
  "card.status": {
    hotkey: "S",
    meta: { group: "Cards", name: "Change status…" },
  },
  "card.priority": {
    hotkey: "P",
    meta: { group: "Cards", name: "Set priority…" },
  },
  "card.assign": {
    hotkey: "A",
    meta: { group: "Cards", name: "Assign…" },
  },
  "card.related": {
    hotkey: ["M", "R"],
    meta: { group: "Cards", name: "Mark as related to…" },
    options: SEQUENCE,
  },
  "card.blockedBy": {
    hotkey: ["M", "B"],
    meta: { group: "Cards", name: "Mark as blocked by…" },
    options: SEQUENCE,
  },
  "card.blocking": {
    hotkey: ["M", "X"],
    meta: { group: "Cards", name: "Mark as blocking…" },
    options: SEQUENCE,
  },
});

/** Ctrl or ⌘ and a number go to that project, in the sidebar's order. */
export const PROJECT_KEYS = [
  "Mod+1",
  "Mod+2",
  "Mod+3",
  "Mod+4",
  "Mod+5",
  "Mod+6",
  "Mod+7",
  "Mod+8",
  "Mod+9",
] as const satisfies readonly Hotkey[];

/** A shortcut from the list above, or keys of its own. */
export type Keys = AppHotkey | Hotkey;

function hotkeyOf(keys: Keys): Hotkey | null {
  return isAppHotkey(keys) ? keys.hotkey : keys;
}

/**
 * The keys to press, one list per step, as the keyboard labels them:
 * `[["⌘", "K"]]`, or `[["G"], ["H"]]` for G then H.
 */
export function keySteps(keys: Keys): string[][] {
  const hotkey = hotkeyOf(keys);
  if (hotkey === null) {
    return [];
  }
  return typeof hotkey === "string"
    ? [formatForDisplay(hotkey, { parts: true })]
    : formatForDisplay(hotkey, { parts: true });
}

/** The keys in a few characters, as hints write them: ⌘B on Apple, Ctrl+B elsewhere, G then H. */
export function keysText(keys: Keys): string {
  return keySteps(keys)
    .map((step) => step.join(APPLE ? "" : "+"))
    .join(" then ");
}
