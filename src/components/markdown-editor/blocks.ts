import type { ChainedCommands, Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MinusIcon,
  PilcrowIcon,
  SquareCodeIcon,
  Table2Icon,
  TextQuoteIcon,
} from "lucide-react";

/** Something to add to the text, offered in the "/" menu. */
export interface BlockCommand {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Other words the "/" menu finds it by. */
  keywords: readonly string[];
  /** The markdown typed at the start of a line that makes it, as a hint. */
  markdown?: string;
  /** Turns the selected blocks into this one, or adds it at the selection. */
  run: (chain: ChainedCommands, editor: Editor) => ChainedCommands;
}

/** A block the selected blocks can turn into, keeping their text. */
export interface BlockType extends BlockCommand {
  isActive: (editor: Editor) => boolean;
}

const LISTS = ["bulletList", "orderedList", "taskList"] as const;

/** The heading levels pages and articles use. */
export type HeadingLevel = 1 | 2 | 3 | 4;

/** Each heading level's icon. */
export const HEADING_ICONS: Record<HeadingLevel, LucideIcon> = {
  1: Heading1Icon,
  2: Heading2Icon,
  3: Heading3Icon,
  4: Heading4Icon,
};

// Into a list, unless the text already sits in one of that kind.
function toList(
  name: (typeof LISTS)[number],
  toggle: (chain: ChainedCommands) => ChainedCommands
) {
  return (chain: ChainedCommands, editor: Editor) =>
    editor.isActive(name) ? chain : toggle(chain.clearNodes());
}

const TEXT: BlockType = {
  icon: PilcrowIcon,
  id: "text",
  isActive: (editor) =>
    editor.isActive("paragraph") &&
    !LISTS.some((list) => editor.isActive(list)) &&
    !editor.isActive("blockquote"),
  keywords: ["paragraph", "plain"],
  label: "Text",
  run: (chain) => chain.clearNodes(),
};

function heading(level: HeadingLevel): BlockType {
  return {
    icon: HEADING_ICONS[level],
    id: `heading${level}`,
    isActive: (editor) => editor.isActive("heading", { level }),
    keywords: ["heading", "title", `h${level}`],
    label: `Heading ${level}`,
    markdown: "#".repeat(level),
    run: (chain) => chain.clearNodes().setHeading({ level }),
  };
}

const LIST_TYPES: readonly BlockType[] = [
  {
    icon: ListIcon,
    id: "bulletList",
    isActive: (editor) => editor.isActive("bulletList"),
    keywords: ["bullet", "unordered", "ul"],
    label: "Bulleted list",
    markdown: "-",
    run: toList("bulletList", (chain) => chain.toggleBulletList()),
  },
  {
    icon: ListOrderedIcon,
    id: "orderedList",
    isActive: (editor) => editor.isActive("orderedList"),
    keywords: ["numbered", "ordered", "ol"],
    label: "Numbered list",
    markdown: "1.",
    run: toList("orderedList", (chain) => chain.toggleOrderedList()),
  },
];

const TASK_LIST: BlockType = {
  icon: ListTodoIcon,
  id: "taskList",
  isActive: (editor) => editor.isActive("taskList"),
  keywords: ["todo", "task", "checkbox", "checklist"],
  label: "To-do list",
  markdown: "[]",
  run: toList("taskList", (chain) => chain.toggleTaskList()),
};

const QUOTE_AND_CODE: readonly BlockType[] = [
  {
    icon: TextQuoteIcon,
    id: "blockquote",
    isActive: (editor) => editor.isActive("blockquote"),
    keywords: ["quote", "citation"],
    label: "Quote",
    markdown: ">",
    run: (chain) => chain.clearNodes().setBlockquote(),
  },
  {
    icon: SquareCodeIcon,
    id: "codeBlock",
    isActive: (editor) => editor.isActive("codeBlock"),
    keywords: ["code", "snippet", "pre"],
    label: "Code",
    markdown: "```",
    run: (chain) => chain.clearNodes().setCodeBlock(),
  },
];

/** What a doc page's blocks can turn into. */
export const BLOCK_TYPES: readonly BlockType[] = [
  TEXT,
  heading(1),
  heading(2),
  heading(3),
  ...LIST_TYPES,
  TASK_LIST,
  ...QUOTE_AND_CODE,
];

/** What an article's blocks can turn into: its title is the only first-level heading, and it has no to-dos. */
export const ARTICLE_BLOCK_TYPES: readonly BlockType[] = [
  TEXT,
  heading(2),
  heading(3),
  heading(4),
  ...LIST_TYPES,
  ...QUOTE_AND_CODE,
];

export const INSERTS: readonly BlockCommand[] = [
  {
    icon: MinusIcon,
    id: "divider",
    keywords: ["divider", "rule", "separator", "hr", "line"],
    label: "Divider",
    markdown: "---",
    run: (chain) => chain.setHorizontalRule(),
  },
  {
    icon: Table2Icon,
    id: "table",
    keywords: ["table", "grid", "rows", "columns"],
    label: "Table",
    run: (chain) =>
      chain.insertTable({ cols: 3, rows: 3, withHeaderRow: true }),
  },
];

/**
 * Drops the line the "/" was typed on, when the command left it empty and
 * put nothing there, like one that opens another page.
 */
export function dropEmptyLine(chain: ChainedCommands): ChainedCommands {
  return chain.command(({ tr }) => {
    const { $from } = tr.selection;
    const empty = $from.parent.isTextblock && $from.parent.content.size === 0;
    if (empty && $from.depth === 1 && tr.doc.childCount > 1) {
      tr.delete($from.before(), $from.after());
    }
    return true;
  });
}

/** Commands with a word in their label, id or keywords starting with the query. */
export function matchCommands<T extends BlockCommand>(
  commands: readonly T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...commands];
  }
  return commands.filter((command) =>
    [command.label, command.id, ...command.keywords].some((word) =>
      word
        .toLowerCase()
        .split(/\s+/u)
        .some((part) => part.startsWith(needle))
    )
  );
}
