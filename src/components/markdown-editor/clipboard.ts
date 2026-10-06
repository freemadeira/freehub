import { Extension } from "@tiptap/core";
import type { Node, ResolvedPos, Schema } from "@tiptap/pm/model";
import { Fragment, Slice } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";

import {
  parseMarkdown,
  serializeMarkdown,
} from "@/components/markdown-editor/content";

const LINE_BREAKS = /(?:\r\n?|\n)+/u;

function markdownSlice(text: string, schema: Schema): Slice {
  return new Slice(schema.nodeFromJSON(parseMarkdown(text)).content, 0, 0);
}

// Pasting as plain text keeps the characters as they are, a paragraph per line.
function plainSlice(text: string, $context: ResolvedPos): Slice {
  const { schema } = $context.doc.type;
  const marks = $context.marks();
  const paragraphs = text
    .split(LINE_BREAKS)
    .map((line) =>
      schema.node(
        "paragraph",
        null,
        line ? schema.text(line, marks) : undefined
      )
    );
  return new Slice(Fragment.from(paragraphs), 0, 0);
}

function isParagraph(node: Node | null): boolean {
  return node?.type.name === "paragraph";
}

// Markdown pasted into a line keeps its headings, lists and code as blocks of
// their own instead of merging their first and last lines into it.
function keepBlocks(slice: Slice, $from: ResolvedPos): Slice {
  if ($from.depth !== 1 || $from.parent.content.size === 0) {
    return slice;
  }
  return new Slice(
    slice.content,
    isParagraph(slice.content.firstChild) ? slice.openStart : 0,
    isParagraph(slice.content.lastChild) ? slice.openEnd : 0
  );
}

/** The text of a copied selection that stays within one block. */
function textWithin(slice: Slice): Fragment | undefined {
  let fragment = slice.content;
  while (fragment.childCount === 1) {
    const node = fragment.child(0);
    if (node.isInline) {
      break;
    }
    if (node.isTextblock) {
      return node.content;
    }
    fragment = node.content;
  }
  return fragment.childCount > 0 &&
    fragment.content.every((node) => node.isInline)
    ? fragment
    : undefined;
}

function leafText(node: Node): string {
  return node.type.name === "hardBreak" ? "\n" : "";
}

/** VS Code names the language of the code it copies. */
function vscodeLanguage(data: DataTransfer): string | undefined {
  try {
    const editorData: { mode?: string } = JSON.parse(
      data.getData("vscode-editor-data")
    );
    return editorData.mode;
  } catch {
    return undefined;
  }
}

/**
 * Pasted markdown turns into formatting, and copied text reads as markdown
 * elsewhere: plain text from within a block, markdown across blocks.
 */
export const MarkdownClipboard = Extension.create({
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          clipboardTextParser: (text, $context, plain) =>
            plain
              ? plainSlice(text, $context)
              : markdownSlice(text, $context.doc.type.schema),
          clipboardTextSerializer: (slice) => {
            const text = textWithin(slice);
            return text
              ? text.textBetween(0, text.size, "\n\n", leafText)
              : serializeMarkdown({
                  content: slice.content.toJSON(),
                  type: "doc",
                });
          },
          // VS Code copies markdown as highlighted code; the text is what was written.
          handlePaste: (view, event) => {
            const { $from } = view.state.selection;
            const data = event.clipboardData;
            if (
              !data ||
              $from.parent.type.spec.code ||
              vscodeLanguage(data) !== "markdown"
            ) {
              return false;
            }
            const pasted = markdownSlice(
              data.getData("text/plain"),
              view.state.schema
            );
            const slice = keepBlocks(Slice.maxOpen(pasted.content), $from);
            view.dispatch(
              view.state.tr
                .replaceSelection(slice)
                .scrollIntoView()
                .setMeta("paste", true)
                .setMeta("uiEvent", "paste")
            );
            return true;
          },
          transformPasted: (slice, view, plain) => {
            const { $from } = view.state.selection;
            return plain && !$from.parent.type.spec.code
              ? keepBlocks(slice, $from)
              : slice;
          },
        },
      }),
    ];
  },
  name: "markdownClipboard",
  // Runs before the code block's own VS Code paste handling.
  priority: 101,
});
