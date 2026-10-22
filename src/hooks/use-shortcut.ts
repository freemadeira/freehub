import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { isAppHotkey, useHotkeys } from "@tanstack/react-hotkeys";

import type { Keys } from "@/lib/shortcuts";
import { isTyping } from "@/lib/utils";

export interface Shortcut {
  keys: Keys;
  run: (event: KeyboardEvent) => void;
  /** Off for now, like a shortcut for something the user can't do. */
  enabled?: boolean;
}

export interface ShortcutOptions {
  /** Also from fields and popups, as shortcuts with Ctrl or ⌘ are. */
  inFields?: boolean;
}

function definition(
  { keys, run, enabled = true }: Shortcut,
  { inFields = false }: ShortcutOptions
): UseHotkeyDefinition {
  const callback = (event: KeyboardEvent) => {
    if (event.defaultPrevented || (!inFields && isTyping(event.target))) {
      return;
    }
    event.preventDefault();
    run(event);
  };
  // The same either way: TypeScript just takes each kind of keys on its own.
  return isAppHotkey(keys)
    ? { callback, hotkey: keys, options: { enabled } }
    : { callback, hotkey: keys, options: { enabled } };
}

/**
 * Runs each shortcut's `run` when its keys are pressed: not while typing, nor
 * for keys something on the page already answered.
 */
export function useShortcuts(
  shortcuts: Shortcut[],
  options: ShortcutOptions = {}
): void {
  useHotkeys(
    shortcuts.map((shortcut) => definition(shortcut, options)),
    {
      // Fields and popups are told apart above, by `isTyping`: the library's
      // own check takes a select's button for a field, and keys would stop
      // working after picking a status.
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
      // On the window, after the page's own listeners, so keys they took stay
      // theirs: like ⌘B in the editor, which makes text bold.
      target: window,
    }
  );
}

export function useShortcut(
  keys: Keys,
  run: (event: KeyboardEvent) => void,
  { enabled, ...options }: ShortcutOptions & Pick<Shortcut, "enabled"> = {}
): void {
  useShortcuts([{ enabled, keys, run }], options);
}
