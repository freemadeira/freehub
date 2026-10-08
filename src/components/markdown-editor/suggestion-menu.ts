import type { Editor } from "@tiptap/core";
import type { PluginKey } from "@tiptap/pm/state";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { exitSuggestion } from "@tiptap/suggestion";
import { useEffect } from "react";

export interface OpenMenu<T> {
  items: T[];
  /** Highlighted item, moved with the arrow keys or the pointer. */
  index: number;
  /** Where the menu renders, positioned under the trigger by the suggestion plugin. */
  element: HTMLElement;
  pick: (item: T) => void;
}

/**
 * The state of a menu opened by typing a character, like "/" or "@", shared
 * by the editor plugin and the menu it renders.
 */
export class SuggestionMenuStore<T> {
  readonly #key: PluginKey;
  #open: OpenMenu<T> | null = null;
  readonly #listeners = new Set<() => void>();

  constructor(key: PluginKey) {
    this.#key = key;
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  snapshot = () => this.#open;

  set(open: OpenMenu<T> | null): void {
    this.#open = open;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  show(props: SuggestionProps<T, T>, element: HTMLElement) {
    this.set({ element, index: 0, items: props.items, pick: props.command });
  }

  highlight(index: number): void {
    const open = this.#open;
    if (open && open.items.length > 0) {
      const count = open.items.length;
      this.set({ ...open, index: (index + count) % count });
    }
  }

  /**
   * Arrow keys move through the menu and Enter picks; the editor gets the
   * rest, and every key while nothing matches and the menu is hidden.
   */
  keyDown(event: KeyboardEvent, view: Editor["view"]): boolean {
    const open = this.#open;
    if (!open || open.items.length === 0) {
      return false;
    }
    switch (event.key) {
      case "ArrowDown": {
        this.highlight(open.index + 1);
        return true;
      }
      case "ArrowUp": {
        this.highlight(open.index - 1);
        return true;
      }
      case "Enter":
      case "Tab": {
        const item = open.items[open.index];
        if (item) {
          open.pick(item);
          return true;
        }
        return false;
      }
      case "Escape": {
        exitSuggestion(view, this.#key);
        return true;
      }
      default: {
        return false;
      }
    }
  }

  /** The suggestion plugin's `render`: the menu shows in an element it places. */
  render: NonNullable<SuggestionOptions<T, T>["render"]> = () => {
    let unmount: (() => void) | undefined;
    return {
      onExit: () => {
        unmount?.();
        unmount = undefined;
        this.set(null);
      },
      onKeyDown: ({ event, view }) => this.keyDown(event, view),
      onStart: (props) => {
        const element = document.createElement("div");
        element.className = "z-50";
        unmount = props.mount(element);
        this.show(props, element);
      },
      onUpdate: (props) => {
        const open = this.#open;
        if (open) {
          this.show(props, open.element);
        }
      },
    };
  };
}

/**
 * The text keeps focus and points at the highlighted option, as a combobox
 * does, while the menu with this id is open.
 */
export function useComboboxPopup(
  editor: Editor,
  id: string,
  open: boolean,
  activeId: string | undefined
): void {
  useEffect(() => {
    // Only once open: the view isn't mounted during the first effects.
    if (!open) {
      return;
    }
    const { dom } = editor.view;
    dom.setAttribute("aria-controls", id);
    dom.setAttribute("aria-expanded", "true");
    if (activeId) {
      dom.setAttribute("aria-activedescendant", activeId);
    }
    return () => {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-expanded");
      dom.removeAttribute("aria-activedescendant");
    };
  }, [editor, id, open, activeId]);
}
