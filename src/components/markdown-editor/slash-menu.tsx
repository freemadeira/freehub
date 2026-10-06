import type { Editor, Range } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import type { SuggestionProps } from "@tiptap/suggestion";
import { exitSuggestion, Suggestion } from "@tiptap/suggestion";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import type { BlockCommand } from "@/components/markdown-editor/blocks";
import {
  BLOCK_TYPES,
  INSERTS,
  matchCommands,
} from "@/components/markdown-editor/blocks";

const SLASH = new PluginKey("slashMenu");

interface OpenMenu {
  items: BlockCommand[];
  /** Highlighted item, moved with the arrow keys or the pointer. */
  index: number;
  /** Where the menu renders, positioned under the "/" by the suggestion plugin. */
  element: HTMLElement;
  pick: (command: BlockCommand) => void;
}

/** The "/" menu's state, shared by the editor plugin and the menu it renders. */
export class SlashMenuStore {
  #commands: readonly BlockCommand[] = [...BLOCK_TYPES, ...INSERTS];
  #open: OpenMenu | null = null;
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  snapshot = () => this.#open;

  /** What the menu offers, filtered by what's typed after the "/". */
  setCommands(commands: readonly BlockCommand[]): void {
    this.#commands = commands;
  }

  match(query: string): BlockCommand[] {
    return matchCommands(this.#commands, query);
  }

  set(open: OpenMenu | null): void {
    this.#open = open;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  show(
    props: SuggestionProps<BlockCommand, BlockCommand>,
    element: HTMLElement
  ) {
    this.set({ element, index: 0, items: props.items, pick: props.command });
  }

  highlight(index: number): void {
    const open = this.#open;
    if (open && open.items.length > 0) {
      const count = open.items.length;
      this.set({ ...open, index: (index + count) % count });
    }
  }

  /** Arrow keys move through the menu and Enter picks; the editor gets the rest. */
  keyDown(event: KeyboardEvent, view: Editor["view"]): boolean {
    const open = this.#open;
    if (!open) {
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
        const command = open.items[open.index];
        if (command) {
          open.pick(command);
          return true;
        }
        return false;
      }
      case "Escape": {
        exitSuggestion(view, SLASH);
        return true;
      }
      default: {
        return false;
      }
    }
  }
}

function runCommand(editor: Editor, range: Range, command: BlockCommand) {
  command.run(editor.chain().focus().deleteRange(range), editor).run();
}

/** Typing "/" at the start of a line or after a space opens the block menu. */
export const SlashCommand = Extension.create<{ store: SlashMenuStore | null }>({
  addOptions: () => ({ store: null }),
  addProseMirrorPlugins() {
    const { store } = this.options;
    if (!store) {
      return [];
    }
    return [
      Suggestion<BlockCommand, BlockCommand>({
        // Code is written as is.
        allow: ({ state, range }) =>
          !state.doc.resolve(range.from).parent.type.spec.code,
        char: "/",
        command: ({ editor, range, props }) => runCommand(editor, range, props),
        editor: this.editor,
        items: ({ query }) => store.match(query),
        offset: { mainAxis: 6 },
        pluginKey: SLASH,
        render: () => {
          let unmount: (() => void) | undefined;
          return {
            onExit: () => {
              unmount?.();
              unmount = undefined;
              store.set(null);
            },
            onKeyDown: ({ event, view }) => store.keyDown(event, view),
            onStart: (props) => {
              const element = document.createElement("div");
              element.className = "z-50";
              unmount = props.mount(element);
              store.show(props, element);
            },
            onUpdate: (props) => {
              const open = store.snapshot();
              if (open) {
                store.show(props, open.element);
              }
            },
          };
        },
      }),
    ];
  },
  name: "slashMenu",
});

interface MenuItemProps {
  id: string;
  command: BlockCommand;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

function MenuItem({ id, command, active, onHover, onPick }: MenuItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [active]);
  const Icon = command.icon;
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- picked from the keyboard through the text, which keeps focus
    <div
      aria-selected={active}
      className="aria-selected:bg-accent aria-selected:text-accent-foreground flex cursor-default items-center gap-2.5 rounded-lg px-1.5 py-1 text-sm select-none"
      id={id}
      onClick={onPick}
      // Keeps focus, and the "/" being typed, in the text.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onHover}
      ref={ref}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a combobox option with an icon and a hint
      role="option"
      tabIndex={-1}
    >
      <span className="bg-background shadow-surface flex size-8 shrink-0 items-center justify-center rounded-md">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate">{command.label}</span>
      {command.markdown && (
        <span className="text-muted-foreground font-mono text-xs">
          {command.markdown}
        </span>
      )}
    </div>
  );
}

/** The "/" menu of an editor with the SlashCommand extension. */
export function SlashMenu({
  editor,
  store,
}: {
  editor: Editor;
  store: SlashMenuStore;
}) {
  const id = useId();
  const open = useSyncExternalStore(store.subscribe, store.snapshot);
  const optionId = (command: BlockCommand) => `${id}-${command.id}`;
  const active = open?.items[open.index];
  const activeId = active ? optionId(active) : undefined;

  // The text keeps focus and points at the highlighted option, as a combobox does.
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

  // Nothing matches what's typed: the menu steps aside, as in Notion.
  if (!open || open.items.length === 0) {
    return null;
  }
  const { items, index, element, pick } = open;
  return createPortal(
    <div
      aria-label="Blocks"
      className="bg-popover text-popover-foreground shadow-raised flex max-h-80 w-72 flex-col overflow-y-auto rounded-xl p-1 transition-[opacity,scale] duration-150 ease-out starting:scale-[0.96] starting:opacity-0"
      id={id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the popup of the text's "/" combobox
      role="listbox"
    >
      {items.map((command, position) => (
        <MenuItem
          active={position === index}
          command={command}
          id={optionId(command)}
          key={command.id}
          onHover={() => {
            if (position !== index) {
              store.highlight(position);
            }
          }}
          onPick={() => pick(command)}
        />
      ))}
    </div>,
    element
  );
}
