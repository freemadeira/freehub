import type { ChainedCommands, Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import {
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  PilcrowIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  TextQuoteIcon,
  UnlinkIcon,
} from "lucide-react";
import type { RefObject } from "react";
import { useEffect, useEffectEvent, useState } from "react";

import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Separator } from "@/components/ui/separator";

const TOOL =
  "rounded-lg text-muted-foreground hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground";

const SELECTION_TOOLBAR = new PluginKey("selectionToolbar");
const LINK_TARGET = new PluginKey<DecorationSet>("linkTarget");

const APPLE = /Mac|iPhone|iPad/u.test(navigator.userAgent);
const APPLE_KEYS: Record<string, string> = { Alt: "⌥", Mod: "⌘", Shift: "⇧" };

/** "Mod-Shift-s" as the platform writes it: ⇧⌘S on Apple, Ctrl+Shift+S elsewhere. */
function shortcut(keys: string): string {
  const modifiers = keys.split("-");
  const key = (modifiers.pop() ?? "").toUpperCase();
  if (APPLE) {
    const symbols = ["Alt", "Shift", "Mod"]
      .filter((modifier) => modifiers.includes(modifier))
      .map((modifier) => APPLE_KEYS[modifier]);
    return [...symbols, key].join("");
  }
  return [
    ...modifiers.map((modifier) => (modifier === "Mod" ? "Ctrl" : modifier)),
    key,
  ].join("+");
}

/** A typed address, made absolute: example.com links to https://example.com. */
function toHref(value: string): string {
  const text = value.trim();
  if (!text || /^[a-z][a-z\d+.-]*:/iu.test(text) || /^[/#?]/u.test(text)) {
    return text;
  }
  return text.includes("@") && !text.includes("/")
    ? `mailto:${text}`
    : `https://${text}`;
}

const STYLES = [
  { icon: PilcrowIcon, label: "Text", level: 0 },
  { icon: Heading1Icon, label: "Heading 1", level: 1 },
  { icon: Heading2Icon, label: "Heading 2", level: 2 },
  { icon: Heading3Icon, label: "Heading 3", level: 3 },
] as const;

const LISTS: {
  icon: LucideIcon;
  label: string;
  name: string;
  toggle: (chain: ChainedCommands) => ChainedCommands;
}[] = [
  {
    icon: ListIcon,
    label: "Bulleted list",
    name: "bulletList",
    toggle: (chain) => chain.toggleBulletList(),
  },
  {
    icon: ListOrderedIcon,
    label: "Numbered list",
    name: "orderedList",
    toggle: (chain) => chain.toggleOrderedList(),
  },
  {
    icon: ListTodoIcon,
    label: "Checklist",
    name: "taskList",
    toggle: (chain) => chain.toggleTaskList(),
  },
];

/** Keeps the text being linked highlighted while focus is in the link field. */
export const LinkTarget = Extension.create({
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: LINK_TARGET,
        props: {
          decorations: (state) => LINK_TARGET.getState(state),
        },
        state: {
          apply: (tr, set) => {
            const range: { from: number; to: number } | null | undefined =
              tr.getMeta(LINK_TARGET);
            if (range === undefined) {
              // oxlint-disable-next-line unicorn/no-array-method-this-argument -- DecorationSet.map, not Array#map
              return set.map(tr.mapping, tr.doc);
            }
            return range
              ? DecorationSet.create(tr.doc, [
                  Decoration.inline(range.from, range.to, {
                    class: "link-target",
                  }),
                ])
              : DecorationSet.empty;
          },
          init: () => DecorationSet.empty,
        },
      }),
    ];
  },
  name: "linkTarget",
});

function markLinkTarget(
  editor: Editor,
  range: { from: number; to: number } | null
) {
  editor.view.dispatch(editor.state.tr.setMeta(LINK_TARGET, range));
}

/**
 * Hides the toolbar once focus has left the text and the toolbar. The menu's
 * own blur handling skips the first blur after a tool was clicked.
 */
export function hideSelectionToolbar(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(SELECTION_TOOLBAR, "hide"));
}

const POSITION = { offset: 8, placement: "top" } as const;

// Shown for selected text the editor or its toolbar has focus on, except code.
function shouldShow({
  editor,
  element,
  view,
  state,
  from,
  to,
}: {
  editor: Editor;
  element: HTMLElement;
  view: EditorView;
  state: EditorState;
  from: number;
  to: number;
}): boolean {
  const focused = view.hasFocus() || element.contains(document.activeElement);
  return (
    focused &&
    !state.selection.empty &&
    !editor.isActive("codeBlock") &&
    state.doc.textBetween(from, to).trim().length > 0
  );
}

function Hint({ label, keys }: { label: string; keys: string }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      <span className="text-background/60">{shortcut(keys)}</span>
    </span>
  );
}

interface ToolProps {
  label: string;
  keys: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}

function Tool({ label, keys, icon: Icon, active, onClick }: ToolProps) {
  return (
    <IconButton
      aria-pressed={active}
      className={TOOL}
      label={label}
      onClick={onClick}
      tooltip={<Hint keys={keys} label={label} />}
    >
      <Icon />
    </IconButton>
  );
}

interface LinkFieldProps {
  href: string;
  onApply: (value: string) => boolean;
  onRemove: () => void;
}

function LinkField({ href, onApply, onRemove }: LinkFieldProps) {
  const [value, setValue] = useState(href);
  const [invalid, setInvalid] = useState(false);
  return (
    <>
      <LinkIcon aria-hidden className="text-muted-foreground mx-2 size-4" />
      <input
        aria-invalid={invalid}
        aria-label="Link"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened on purpose, to type the link
        autoFocus
        className="placeholder:text-muted-foreground aria-invalid:text-destructive h-8 w-64 bg-transparent pr-2 text-sm outline-none"
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            setInvalid(!onApply(value));
          }
        }}
        placeholder="Paste or type a link…"
        value={value}
      />
      {href && (
        <IconButton className={TOOL} label="Remove link" onClick={onRemove}>
          <UnlinkIcon />
        </IconButton>
      )}
    </>
  );
}

interface SelectionToolbarProps {
  editor: Editor;
  ref: RefObject<HTMLDivElement | null>;
  /** Focus left both the text and the toolbar. */
  onLeave: () => void;
}

/** Formatting for selected text, floating above it like Linear's. */
export function SelectionToolbar({
  editor,
  ref,
  onLeave,
}: SelectionToolbarProps) {
  // The address of the link being edited, while the link field is open.
  const [link, setLink] = useState<string>();
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      blockquote: current.isActive("blockquote"),
      bold: current.isActive("bold"),
      code: current.isActive("code"),
      codeBlock: current.isActive("codeBlock"),
      heading:
        [1, 2, 3].find((level) => current.isActive("heading", { level })) ?? 0,
      italic: current.isActive("italic"),
      link: current.isActive("link"),
      list: LISTS.find((list) => current.isActive(list.name))?.name,
      strike: current.isActive("strike"),
    }),
  });

  const run = (command: (chain: ChainedCommands) => ChainedCommands) =>
    command(editor.chain().focus()).run();
  // Focus goes back to the text while the menu is still open, since a menu
  // removed with focus in it makes the dialog take focus for itself. Queued,
  // so it lands after the menu's own click handling, which focuses the item.
  const runFromMenu = (
    command: (chain: ChainedCommands) => ChainedCommands
  ) => {
    command(editor.chain()).run();
    queueMicrotask(() => {
      if (!editor.isDestroyed) {
        editor.view.focus();
      }
    });
  };

  const closeLink = () => {
    if (link !== undefined) {
      setLink(undefined);
      markLinkTarget(editor, null);
    }
  };

  const openLink = () => {
    // A selection inside a link edits all of it.
    editor.commands.extendMarkRange("link");
    const { from, to } = editor.state.selection;
    if (from === to) {
      return false;
    }
    markLinkTarget(editor, { from, to });
    setLink(editor.getAttributes("link").href ?? "");
    return true;
  };

  const applyLink = (value: string): boolean => {
    const href = toHref(value);
    if (href && !editor.can().setLink({ href })) {
      return false;
    }
    // Back to the text at once, before the field unmounts with focus in it.
    editor.view.focus();
    const linked = editor.chain().extendMarkRange("link");
    (href ? linked.setLink({ href }) : linked.unsetLink()).run();
    closeLink();
    return true;
  };

  // Mod+K links the selection from the keyboard, even before the toolbar shows.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const modK =
      event.key.toLowerCase() === "k" &&
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey;
    if (!(modK && editor.isFocused && openLink())) {
      return;
    }
    event.preventDefault();
    editor.view.dispatch(editor.state.tr.setMeta(SELECTION_TOOLBAR, "show"));
    editor.view.dispatch(
      editor.state.tr.setMeta(SELECTION_TOOLBAR, "updatePosition")
    );
  });
  // On the document: the editor's view may not be mounted yet on first render.
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const currentList = LISTS.find((list) => list.name === active.list);
  const ListTrigger = currentList?.icon ?? ListIcon;

  return (
    <BubbleMenu
      aria-label="Formatting"
      className="bg-popover text-popover-foreground shadow-raised z-10 rounded-xl transition-[opacity,scale] duration-150 ease-out outline-none starting:scale-[0.96] starting:opacity-0"
      editor={editor}
      options={POSITION}
      pluginKey={SELECTION_TOOLBAR}
      ref={ref}
      role="toolbar"
      shouldShow={shouldShow}
      updateDelay={100}
    >
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- keeps focus in the editor; the tools are the controls */}
      <div
        className="flex items-center gap-0.5 p-1"
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && ref.current?.contains(next)) {
            return;
          }
          // Once focus has landed: removing the field or the toolbar while
          // focus is still leaving it makes the dialog take focus for itself.
          setTimeout(() => {
            const now = document.activeElement;
            if (editor.isDestroyed || ref.current?.contains(now)) {
              return;
            }
            closeLink();
            if (!editor.view.dom.contains(now)) {
              onLeave();
            }
          }, 0);
        }}
        onKeyDown={(event) => {
          // Escape goes back to the text instead of closing the card.
          if (event.key === "Escape") {
            event.stopPropagation();
            editor.view.focus();
            closeLink();
          }
        }}
        // Clicking a tool keeps focus, and so the selection, in the text.
        onMouseDown={(event) => {
          if (!(event.target instanceof HTMLInputElement)) {
            event.preventDefault();
          }
        }}
      >
        {link === undefined ? (
          <FluidTooltip.Group>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label="Text style"
                    className={cn(TOOL, "gap-1 px-2")}
                    size="sm"
                    variant="ghost"
                  />
                }
              >
                Aa
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent container={ref} finalFocus={false}>
                {STYLES.map(({ icon: Icon, label, level }) => (
                  <DropdownMenuItem
                    key={label}
                    onClick={() =>
                      runFromMenu((chain) =>
                        level === 0
                          ? chain.setParagraph()
                          : chain.setHeading({ level })
                      )
                    }
                  >
                    <Icon />
                    {label}
                    {active.heading === level && !active.codeBlock && (
                      <CheckIcon className="ml-auto" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Separator className="mx-0.5 my-1.5" orientation="vertical" />
            <Tool
              active={active.bold}
              icon={BoldIcon}
              keys="Mod-b"
              label="Bold"
              onClick={() => run((chain) => chain.toggleBold())}
            />
            <Tool
              active={active.italic}
              icon={ItalicIcon}
              keys="Mod-i"
              label="Italic"
              onClick={() => run((chain) => chain.toggleItalic())}
            />
            <Tool
              active={active.strike}
              icon={StrikethroughIcon}
              keys="Mod-Shift-s"
              label="Strikethrough"
              onClick={() => run((chain) => chain.toggleStrike())}
            />
            <Tool
              active={active.link}
              icon={LinkIcon}
              keys="Mod-k"
              label="Link"
              onClick={openLink}
            />
            <Tool
              active={active.code}
              icon={CodeIcon}
              keys="Mod-e"
              label="Code"
              onClick={() => run((chain) => chain.toggleCode())}
            />
            <Tool
              active={active.blockquote}
              icon={TextQuoteIcon}
              keys="Mod-Shift-b"
              label="Quote"
              onClick={() => run((chain) => chain.toggleBlockquote())}
            />
            <Tool
              active={active.codeBlock}
              icon={SquareCodeIcon}
              keys="Mod-Alt-c"
              label="Code block"
              onClick={() => run((chain) => chain.toggleCodeBlock())}
            />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label="List"
                    className={cn(TOOL, "gap-1 px-2")}
                    size="sm"
                    variant="ghost"
                  />
                }
              >
                <ListTrigger />
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent container={ref} finalFocus={false}>
                {LISTS.map(({ icon: Icon, label, name, toggle }) => (
                  <DropdownMenuItem
                    key={name}
                    onClick={() => runFromMenu(toggle)}
                  >
                    <Icon />
                    {label}
                    {active.list === name && <CheckIcon className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </FluidTooltip.Group>
        ) : (
          <LinkField
            href={link}
            onApply={applyLink}
            onRemove={() => applyLink("")}
          />
        )}
      </div>
    </BubbleMenu>
  );
}
