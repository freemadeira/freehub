import type { Editor, Range } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { Mention } from "@/components/markdown-editor/mention";
import {
  SuggestionMenuStore,
  useComboboxPopup,
} from "@/components/markdown-editor/suggestion-menu";
import { UserAvatar } from "@/components/user-avatar";

const MENTION_MENU = new PluginKey("mentionMenu");
const MAX_SUGGESTIONS = 8;
const MAX_QUERY = 40;

/**
 * The "@" menu's state: who can be mentioned, by the names they're offered
 * by, and who was picked from it since the text last saved.
 */
export class MentionMenuStore extends SuggestionMenuStore<string> {
  #names: ReadonlyMap<string, string> = new Map();
  #picked = new Set<string>();

  constructor() {
    super(MENTION_MENU);
  }

  setNames(names: ReadonlyMap<string, string>): void {
    this.#names = names;
  }

  addPicked(people: Iterable<string>): void {
    for (const pubkey of people) {
      this.#picked.add(pubkey);
    }
  }

  /** Who was picked since this was last called. */
  takePicked(): ReadonlySet<string> {
    const picked = this.#picked;
    this.#picked = new Set();
    return picked;
  }

  /** People whose name has what's typed after the "@" in it. */
  match(query: string): string[] {
    if (query.length > MAX_QUERY || query.startsWith(" ")) {
      return [];
    }
    const needle = query.toLowerCase();
    return [...this.#names]
      .filter(([, name]) => name.toLowerCase().includes(needle))
      .map(([pubkey]) => pubkey)
      .slice(0, MAX_SUGGESTIONS);
  }
}

// The mention and a space after it, unless one is there already.
function insertMention(editor: Editor, range: Range, pubkey: string) {
  const after = editor.state.doc.resolve(range.to).nodeAfter;
  const spaced = after?.text?.startsWith(" ") ?? false;
  editor
    .chain()
    .focus()
    .insertContentAt(spaced ? { ...range, to: range.to + 1 } : range, [
      { attrs: { pubkey }, type: Mention.name },
      { text: " ", type: "text" },
    ])
    .run();
}

/** Typing "@" at the start of a word suggests people to mention. */
export const MentionCommand = Extension.create<{
  store: MentionMenuStore | null;
}>({
  addOptions: () => ({ store: null }),
  addProseMirrorPlugins() {
    const { store } = this.options;
    if (!store) {
      return [];
    }
    return [
      Suggestion<string, string>({
        // Code is written as is.
        allow: ({ state, range }) =>
          !state.doc.resolve(range.from).parent.type.spec.code,
        // Names can have spaces; the list steps aside once none matches.
        allowSpaces: true,
        char: "@",
        command: ({ editor, range, props: pubkey }) => {
          insertMention(editor, range, pubkey);
          store.addPicked([pubkey]);
        },
        editor: this.editor,
        items: ({ query }) => store.match(query),
        offset: { mainAxis: 6 },
        pluginKey: MENTION_MENU,
        render: store.render,
      }),
    ];
  },
  name: "mentionMenu",
});

interface PersonProps {
  id: string;
  pubkey: string;
  name: string;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

function Person({ id, pubkey, name, active, onHover, onPick }: PersonProps) {
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
      // Keeps focus, and the "@" being typed, in the text.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onHover}
      ref={ref}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a combobox option with an avatar
      role="option"
      tabIndex={-1}
    >
      <UserAvatar aria-hidden pubkey={pubkey} size="xs" />
      <span className="truncate">{name}</span>
    </div>
  );
}

/** The "@" menu of an editor with the MentionCommand extension. */
export function MentionMenu({
  editor,
  store,
  names,
}: {
  editor: Editor;
  store: MentionMenuStore;
  /** Who can be mentioned, by the names they're offered by. */
  names: ReadonlyMap<string, string>;
}) {
  const id = useId();
  const open = useSyncExternalStore(store.subscribe, store.snapshot);
  const optionId = (index: number) => `${id}-${index}`;

  useEffect(() => {
    store.setNames(names);
  }, [store, names]);

  // Nobody matches what's typed: the list steps aside.
  const shown = open !== null && open.items.length > 0;
  useComboboxPopup(editor, id, shown, shown ? optionId(open.index) : undefined);

  if (!(open && shown)) {
    return null;
  }
  const { items, index, element, pick } = open;
  return createPortal(
    <div
      aria-label="People"
      className="bg-popover text-popover-foreground shadow-raised flex max-h-80 w-60 flex-col overflow-y-auto rounded-xl p-1 transition-[opacity,scale] duration-150 ease-out starting:scale-[0.96] starting:opacity-0"
      id={id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the popup of the text's "@" combobox
      role="listbox"
    >
      {items.map((pubkey, position) => (
        <Person
          active={position === index}
          id={optionId(position)}
          key={pubkey}
          name={names.get(pubkey) ?? ""}
          onHover={() => {
            if (position !== index) {
              store.highlight(position);
            }
          }}
          onPick={() => pick(pubkey)}
          pubkey={pubkey}
        />
      ))}
    </div>,
    element
  );
}
