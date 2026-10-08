import type { JSONContent, MarkdownToken } from "@tiptap/core";
import { getSchema, InputRule, mergeAttributes } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import { OrderedList, TaskItem, TaskList } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { TableKit } from "@tiptap/extension-table";
import { MarkdownManager } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import type { marked, TokenizerExtension } from "marked";
import { Lexer, Marked } from "marked";

import { Mention } from "@/components/markdown-editor/mention";

const SCHEME = /^(?<scheme>[a-z][a-z\d+.-]*):/iu;
// Only addresses typed in full link up, so a file name like index.md stays text.
const FULL_ADDRESS = /^(?:[a-z][a-z\d+.-]*:|www\.)/iu;

function schemeOf(url: string): string | undefined {
  return SCHEME.exec(url.trim())?.groups?.scheme?.toLowerCase();
}

// Links go to web and mail addresses, or stay relative.
function isWebOrMail(url: string): boolean {
  const scheme = schemeOf(url);
  return (
    scheme === undefined ||
    scheme === "http" ||
    scheme === "https" ||
    scheme === "mailto"
  );
}

// Images only load from the web.
const WebImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const scheme = schemeOf(String(HTMLAttributes.src ?? ""));
    const loads = scheme === "http" || scheme === "https";
    return [
      "img",
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        loads ? {} : { src: null }
      ),
    ];
  },
});

const BLOCK_MARKER = /^(?=#{1,6}(?:[ \t]|$)|[-+](?:[ \t]|$)|[-=]+[ \t]*$)/gmu;
const LIST_NUMBER = /^(?<number>\d{1,9})(?=[.)](?:[ \t]|$))/gmu;

// A line of text that reads like a heading, list or rule keeps its marker
// escaped, so it comes back as the same text instead of turning into one.
function escapeBlockMarkers(markdown: string): string {
  return markdown
    .replace(BLOCK_MARKER, "\\")
    .replace(LIST_NUMBER, "$<number>\\");
}

const MarkdownParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const tokens = token.tokens ?? [];
    // Images are inline, so one alone on a line stays in its paragraph;
    // Tiptap would lift it out, where an inline node can't go.
    const loneImage = tokens.length === 1 && tokens[0]?.type === "image";
    return loneImage || !this.parent
      ? helpers.createNode("paragraph", undefined, helpers.parseInline(tokens))
      : this.parent(token, helpers);
  },
  renderMarkdown(node, helpers, context) {
    return escapeBlockMarkers(this.parent?.(node, helpers, context) ?? "");
  },
});

// A "[ ] " box only makes a task in a bulleted list; in a numbered one it
// stays text, as written, at the start of the item's first line.
function keepBox(item: MarkdownToken): MarkdownToken {
  const [box, first, ...rest] = item.tokens ?? [];
  if (box?.type !== "checkbox" || !first?.tokens) {
    return item;
  }
  const text = { raw: box.raw, text: box.raw, type: "text" };
  return {
    ...item,
    tokens: [{ ...first, tokens: [text, ...first.tokens] }, ...rest],
  };
}

// Tiptap reads ordered lists, typed or pasted, with a list parser of its own
// that misplaces what's nested in items: code gains a space on every save and
// blocks under a nested list vanish. Marked's CommonMark lists, and the
// markdown paste, read them like any other list.
const CommonMarkOrderedList = OrderedList.extend({
  addProseMirrorPlugins: () => [],
  markdownTokenizer: {
    level: "block",
    name: "orderedList",
    start: () => -1,
    tokenize: () => {
      // Matches nothing, so marked's own list tokenizer reads ordered lists.
    },
  },
  // Items are read as a bullet list's are. Tiptap's own reading keeps the
  // text of an item without blank lines as written, so its formatting and
  // mentions showed as markdown and were escaped on the next save.
  parseMarkdown: (token, helpers) => {
    if (token.type !== "list" || !token.ordered) {
      return [];
    }
    const content = helpers.parseChildren((token.items ?? []).map(keepBox));
    const start = Number(token.start) || 1;
    return start === 1
      ? { content, type: "orderedList" }
      : { attrs: { start }, content, type: "orderedList" };
  },
});

const BOX = /^\[(?<mark>[ x])?\]\s$/u;

// "- [ ] " typed GitHub-style: the dash already made a bullet, so the box
// turns that bullet into a task instead of staying as text.
const BulletTaskItem = TaskItem.extend({
  addInputRules() {
    return [
      ...(this.parent?.() ?? []),
      new InputRule({
        find: BOX,
        handler: ({ state, range, match, chain }) => {
          const { $from } = state.selection;
          const startsBullet =
            $from.depth >= 3 &&
            $from.index(-1) === 0 &&
            $from.node(-1).type.name === "listItem" &&
            $from.node(-2).type.name === "bulletList";
          if (!startsBullet) {
            return null;
          }
          chain()
            .deleteRange(range)
            .toggleTaskList()
            .updateAttributes(this.name, {
              checked: match.groups?.mark === "x",
            })
            .run();
        },
      }),
    ];
  },
});

/** What a description can hold. */
export const CONTENT = [
  StarterKit.configure({
    dropcursor: { class: "drop-cursor", color: false, width: 3 },
    link: {
      isAllowedUri: (url, { defaultValidate }) =>
        defaultValidate(url) && isWebOrMail(url),
      shouldAutoLink: (url) => FULL_ADDRESS.test(url),
    },
    orderedList: false,
    paragraph: false,
    // Markdown has no way to write it.
    underline: false,
  }),
  MarkdownParagraph,
  CommonMarkOrderedList,
  TaskList,
  BulletTaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  WebImage.configure({ inline: true }),
  Mention,
];

// Raw HTML stays text, as written: an HTML block reads as a paragraph and a
// tag inside a line as plain characters.
const htmlBlockAsText: TokenizerExtension = {
  level: "block",
  name: "htmlBlockAsText",
  tokenizer(src) {
    const raw = Lexer.rules.block.gfm.html.exec(src)?.[0];
    if (!raw) {
      return;
    }
    const text = raw.trimEnd();
    return { raw, text, tokens: this.lexer.inline(text), type: "paragraph" };
  },
};

const htmlTagAsText: TokenizerExtension = {
  level: "inline",
  name: "htmlTagAsText",
  start: (src) => src.indexOf("<"),
  tokenizer(src) {
    const tag = Lexer.rules.inline.gfm.tag.exec(src)?.[0];
    return tag ? { raw: tag, text: tag, type: "text" } : undefined;
  },
};

// A single newline breaks the line, as descriptions have always shown it.
const parser = new Marked({
  breaks: true,
  extensions: [htmlBlockAsText, htmlTagAsText],
});

const markdown = new MarkdownManager({
  extensions: CONTENT,
  // Typed for the `marked` function; only the API a `Marked` instance shares is used.
  marked: parser as unknown as typeof marked,
});

const schema = getSchema(CONTENT);

function plainDoc(source: string): JSONContent {
  return {
    content: source.split("\n").map((line) => ({
      content: line ? [{ text: line, type: "text" }] : [],
      type: "paragraph",
    })),
    type: "doc",
  };
}

/** A description's markdown as editor content. */
export function parseMarkdown(source: string): JSONContent {
  try {
    const doc = markdown.parse(source);
    schema.nodeFromJSON(doc).check();
    return doc;
  } catch {
    // What the parser can't fit still shows, line by line.
    return plainDoc(source);
  }
}

function isBlank(node: JSONContent): boolean {
  return node.type === "paragraph" && !node.content?.length;
}

/** Editor content as a description's markdown, without blank lines around it. */
export function serializeMarkdown(doc: JSONContent): string {
  const content = doc.content ?? [];
  const first = content.findIndex((node) => !isBlank(node));
  const last = content.findLastIndex((node) => !isBlank(node));
  return markdown
    .serialize({ ...doc, content: content.slice(first, last + 1) })
    .trim();
}
