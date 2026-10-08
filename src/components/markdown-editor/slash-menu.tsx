import type { Editor, Range } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import type { BlockCommand } from "@/components/markdown-editor/blocks";
import {
  BLOCK_TYPES,
  INSERTS,
  matchCommands,
} from "@/components/markdown-editor/blocks";
import {
  SuggestionMenuStore,
  useComboboxPopup,
} from "@/components/markdown-editor/suggestion-menu";

const SLASH = new PluginKey("slashMenu");

/** The "/" menu's state, shared by the editor plugin and the menu it renders. */
export class SlashMenuStore extends SuggestionMenuStore<BlockCommand> {
  #commands: readonly BlockCommand[] = [...BLOCK_TYPES, ...INSERTS];

  constructor() {
    super(SLASH);
  }

  /** What the menu offers, filtered by what's typed after the "/". */
  setCommands(commands: readonly BlockCommand[]): void {
    this.#commands = commands;
  }

  match(query: string): BlockCommand[] {
    return matchCommands(this.#commands, query);
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
        render: store.render,
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

  // Nothing matches what's typed: the menu steps aside, as in Notion.
  const shown = open !== null && open.items.length > 0;
  useComboboxPopup(editor, id, shown, activeId);

  if (!(open && shown)) {
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
