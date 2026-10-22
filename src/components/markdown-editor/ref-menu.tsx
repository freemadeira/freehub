import type { Editor, Range } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import type { SuggestionProps } from "@tiptap/suggestion";
import { exitSuggestion, Suggestion } from "@tiptap/suggestion";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { AppLink } from "@/components/markdown-editor/app-link";
import { useComboboxPopup } from "@/components/markdown-editor/suggestion-menu";
import type { RefOption } from "@/components/ref-options";
import { RefOptionRow } from "@/components/ref-options";
import { RefSearch } from "@/features/search/ref-search";

const REF_MENU = new PluginKey("refMenu");
/** What a "#" needs right after it to start a reference, so "# " and "##" still make headings. */
const WORD_START = /^[\p{L}\p{N}]/u;

interface OpenMenu {
  /** What's typed after the "#". */
  query: string;
  /** Highlighted option, moved with the arrow keys or the pointer. */
  index: number;
  /** Where the menu renders, positioned under the "#" by the suggestion plugin. */
  element: HTMLElement;
  pick: (option: RefOption) => void;
}

/**
 * The "#" menu's state, shared by the editor plugin and the menu it renders.
 * The menu searches for what's typed, and tells the store what it lists.
 */
export class RefMenuStore {
  #open: OpenMenu | null = null;
  #items: readonly RefOption[] = [];
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  snapshot = () => this.#open;

  set(open: OpenMenu | null): void {
    this.#open = open;
    if (!open) {
      this.#items = [];
    }
    for (const listener of this.#listeners) {
      listener();
    }
  }

  // The highlight stays while the words do, and goes back to the top when they change.
  show(props: SuggestionProps<RefOption, RefOption>, element: HTMLElement) {
    const was = this.#open;
    const index = was?.query === props.query ? was.index : 0;
    this.set({ element, index, pick: props.command, query: props.query });
  }

  /** What the menu lists now, which the keys move through and pick from. */
  listed(items: readonly RefOption[]): void {
    this.#items = items;
  }

  highlight(index: number): void {
    const open = this.#open;
    const count = this.#items.length;
    if (open && count > 0) {
      this.set({ ...open, index: (index + count) % count });
    }
  }

  /**
   * Arrow keys move through the menu and Enter picks; the editor gets the
   * rest, and everything while nothing's listed.
   */
  keyDown(event: KeyboardEvent, view: Editor["view"]): boolean {
    const open = this.#open;
    const items = this.#items;
    if (!open || items.length === 0) {
      return false;
    }
    const index = Math.min(open.index, items.length - 1);
    switch (event.key) {
      case "ArrowDown": {
        this.highlight(index + 1);
        return true;
      }
      case "ArrowUp": {
        this.highlight(index - 1);
        return true;
      }
      case "Enter":
      case "Tab": {
        const item = items[index];
        if (item) {
          open.pick(item);
          return true;
        }
        return false;
      }
      case "Escape": {
        exitSuggestion(view, REF_MENU);
        return true;
      }
      default: {
        return false;
      }
    }
  }
}

// The link goes in with one space after it, unless one follows already.
function insertReference(editor: Editor, range: Range, item: RefOption) {
  const after = editor.state.doc.resolve(range.to).nodeAfter;
  const spaced = after?.text?.startsWith(" ") ?? false;
  editor
    .chain()
    .focus()
    .insertContentAt({ from: range.from, to: range.to + (spaced ? 1 : 0) }, [
      { attrs: { href: item.url }, type: AppLink.name },
      { text: " ", type: "text" },
    ])
    .run();
}

/**
 * Typing "#" at the start of a word, and a letter or digit after it, opens a
 * menu of things to reference, which go in as links to them. "# " still
 * starts a heading.
 */
export const RefCommand = Extension.create<{ store: RefMenuStore | null }>({
  addOptions: () => ({ store: null }),
  addProseMirrorPlugins() {
    const { store } = this.options;
    if (!store) {
      return [];
    }
    return [
      Suggestion<RefOption, RefOption>({
        // Code is written as is.
        allow: ({ state, range }) => {
          const { code } = state.schema.marks;
          return !(
            state.doc.resolve(range.from).parent.type.spec.code ||
            (code && state.doc.rangeHasMark(range.from, range.to, code))
          );
        },
        // Titles have spaces, as "#Launch plan".
        allowSpaces: true,
        char: "#",
        command: ({ editor, range, props }) =>
          insertReference(editor, range, props),
        editor: this.editor,
        offset: { mainAxis: 6 },
        pluginKey: REF_MENU,
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
        shouldShow: ({ query }) => WORD_START.test(query),
      }),
    ];
  },
  name: "refMenu",
});

interface MenuItemProps {
  id: string;
  item: RefOption;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

function MenuItem({ id, item, active, onHover, onPick }: MenuItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [active]);
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- picked from the keyboard through the text, which keeps focus
    <div
      aria-selected={active}
      className="aria-selected:bg-accent aria-selected:text-accent-foreground flex h-8 cursor-default items-center gap-2 rounded-lg px-2 text-sm select-none"
      id={id}
      onClick={onPick}
      // Keeps focus, and the "#" being typed, in the text.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onHover}
      ref={ref}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a combobox option with an icon
      role="option"
      tabIndex={-1}
    >
      <RefOptionRow option={item} />
    </div>
  );
}

/** The menu while it's open: it searches for what's typed after the "#". */
function OpenRefMenu({
  editor,
  store,
  open,
  project,
}: {
  editor: Editor;
  store: RefMenuStore;
  open: OpenMenu;
  project?: string;
}) {
  const id = useId();
  const [items, setItems] = useState<RefOption[]>([]);
  const index = Math.min(open.index, items.length - 1);
  const optionId = (position: number) => `${id}-${position}`;
  const shown = items.length > 0;

  useEffect(() => {
    store.listed(items);
  });
  useComboboxPopup(editor, id, shown, shown ? optionId(index) : undefined);

  const search = (
    <RefSearch onOptions={setItems} project={project} query={open.query} />
  );
  // Nothing found for what's typed: the menu steps aside, and the "#" stays text.
  if (!shown) {
    return search;
  }
  return createPortal(
    <div
      aria-label="References"
      className="bg-popover text-popover-foreground shadow-raised flex max-h-80 w-80 flex-col overflow-y-auto rounded-xl p-1 transition-[opacity,scale] duration-150 ease-out starting:scale-[0.96] starting:opacity-0"
      id={id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the popup of the text's "#" combobox
      role="listbox"
    >
      {items.map((item, position) => (
        <MenuItem
          active={position === index}
          id={optionId(position)}
          item={item}
          key={item.key}
          onHover={() => {
            if (position !== index) {
              store.highlight(position);
            }
          }}
          onPick={() => open.pick(item)}
        />
      ))}
      {search}
    </div>,
    open.element
  );
}

/**
 * The "#" menu of an editor with the RefCommand extension, offering what's
 * in the project, or everywhere without one.
 */
export function RefMenu({
  editor,
  store,
  project,
}: {
  editor: Editor;
  store: RefMenuStore;
  project?: string;
}) {
  const open = useSyncExternalStore(store.subscribe, store.snapshot);
  return open ? (
    <OpenRefMenu editor={editor} open={open} project={project} store={store} />
  ) : null;
}
