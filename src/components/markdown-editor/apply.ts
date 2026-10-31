import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Fragment } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { diffIndices } from "node-diff3";

import type { MarkdownDialect } from "@/components/markdown-editor/content";
import { CONTENT_MARKDOWN } from "@/components/markdown-editor/content";

/** Marks a change that shows Markdown from elsewhere, like a teammate's edit: not one to save. */
export const SHOWN = "shownMarkdown";

function blocks(doc: Node): Node[] {
  return Array.from({ length: doc.childCount }, (_, index) => doc.child(index));
}

function keys(nodes: Node[]): string[] {
  return nodes.map((node) => JSON.stringify(node.toJSON()));
}

function isBlank(node: Node): boolean {
  return node.type.name === "paragraph" && node.content.size === 0;
}

/**
 * The new blocks with the current blocks that Markdown can't hold yet, like a
 * picture still uploading, kept after the block they followed, or where they
 * were when that block is gone.
 */
function keepUnwritten(
  current: Node[],
  next: Node[],
  unwritten: (node: Node) => boolean
): Node[] {
  const written = current.filter((node) => !unwritten(node));
  if (written.length === current.length) {
    return next;
  }
  // Where what follows each written block goes among the new ones: right
  // after it when it's unchanged, after whatever replaced it otherwise.
  const after: number[] = [];
  let a = 0;
  let b = 0;
  for (const hunk of diffIndices(keys(written), keys(next))) {
    const [from, removed] = hunk.buffer1;
    const [start, added] = hunk.buffer2;
    for (; a < from; a += 1, b += 1) {
      after[a] = b + 1;
    }
    for (let offset = 0; offset < removed; offset += 1) {
      after[from + offset] = start + added;
    }
    a = from + removed;
    b = start + added;
  }
  for (; a < written.length; a += 1, b += 1) {
    after[a] = b + 1;
  }
  const kept = [...next];
  let seen = -1;
  for (const node of current) {
    if (unwritten(node)) {
      const inserted = kept.length - next.length;
      kept.splice(
        (seen < 0 ? 0 : (after[seen] ?? next.length)) + inserted,
        0,
        node
      );
    } else {
      seen += 1;
    }
  }
  return kept;
}

// Where the `index`th block of the document starts.
function blockStart(doc: Node, index: number): number {
  let pos = 0;
  for (let child = 0; child < index; child += 1) {
    pos += doc.child(child).nodeSize;
  }
  return pos;
}

// Within one block, only what differs is replaced, so a cursor elsewhere in
// it (say in another item of the same list) stays put.
function replaceWithin(tr: Transaction, at: number, before: Node, after: Node) {
  if (!before.sameMarkup(after)) {
    tr.replaceWith(at, at + before.nodeSize, after);
    return;
  }
  const start = before.content.findDiffStart(after.content);
  const end = before.content.findDiffEnd(after.content);
  if (start === null || !end) {
    return;
  }
  let { a: endBefore, b: endAfter } = end;
  const overlap = start - Math.min(endBefore, endAfter);
  if (overlap > 0) {
    endBefore += overlap;
    endAfter += overlap;
  }
  tr.replace(at + 1 + start, at + 1 + endBefore, after.slice(start, endAfter));
}

/**
 * Shows new markdown in the editor by changing only the blocks that differ,
 * so the cursor and the rest of the text stay where they are. The change
 * isn't undoable: undo still steps back through the person's own edits.
 */
export function replaceMarkdown(
  editor: Editor,
  markdown: string,
  dialect: MarkdownDialect = CONTENT_MARKDOWN
): void {
  const { state } = editor;
  const current = blocks(state.doc);
  let next = keepUnwritten(
    current,
    blocks(state.schema.nodeFromJSON(dialect.parse(markdown))),
    (node) => dialect.unwritten(node.toJSON())
  );
  if (next.every(isBlank)) {
    next = [];
  }
  // Markdown has no blank lines at either end; the ones being typed in stay.
  if (!current.every(isBlank)) {
    const lead = current.findIndex((node) => !isBlank(node));
    const trail =
      current.length - 1 - current.findLastIndex((node) => !isBlank(node));
    next = [
      ...current.slice(0, lead),
      ...next,
      ...current.slice(current.length - trail),
    ];
  }
  if (next.length === 0) {
    next = [state.schema.node("paragraph")];
  }
  const { tr } = state;
  // From the end back, so the positions of earlier blocks still hold.
  for (const hunk of diffIndices(keys(current), keys(next)).toReversed()) {
    const [from, removed] = hunk.buffer1;
    const [start, added] = hunk.buffer2;
    const at = blockStart(state.doc, from);
    const before = current[from];
    const after = next[start];
    if (removed === 1 && added === 1 && before && after) {
      replaceWithin(tr, at, before, after);
    } else {
      tr.replaceWith(
        at,
        blockStart(state.doc, from + removed),
        Fragment.fromArray(next.slice(start, start + added))
      );
    }
  }
  if (tr.docChanged) {
    editor.view.dispatch(
      tr
        .setMeta("addToHistory", false)
        .setMeta("preventAutolink", true)
        .setMeta(SHOWN, true)
    );
  }
}
