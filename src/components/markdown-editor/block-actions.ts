import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { Selection, TextSelection } from "@tiptap/pm/state";

/** A block in the document and the position just before it. */
export interface BlockTarget {
  node: Node;
  pos: number;
}

const ITEMS = new Set(["listItem", "taskItem"]);

/** Whether the target still sits where it was found, e.g. after a teammate's edit. */
function current(state: EditorState, target: BlockTarget): boolean {
  return state.doc.nodeAt(target.pos) === target.node;
}

/** The list item the selection is in, or else its top-level block. */
export function selectedBlock(state: EditorState): BlockTarget | undefined {
  const { $from } = state.selection;
  for (let { depth } = $from; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (depth === 1 || ITEMS.has(node.type.name)) {
      return { node, pos: $from.before(depth) };
    }
  }
  const node = state.doc.nodeAt($from.pos);
  return node ? { node, pos: $from.pos } : undefined;
}

/** Selects the text of the block, so a command can change all of it. */
export function selectBlockText(editor: Editor, target: BlockTarget): boolean {
  const { state } = editor;
  if (!current(state, target) || target.node.isAtom) {
    return false;
  }
  const end = target.pos + target.node.nodeSize;
  const selection = TextSelection.between(
    state.doc.resolve(Math.min(target.pos + 1, end)),
    state.doc.resolve(Math.max(end - 1, target.pos))
  );
  editor.view.dispatch(state.tr.setSelection(selection));
  return true;
}

export function deleteBlock(editor: Editor, target: BlockTarget): boolean {
  const { state } = editor;
  if (!current(state, target)) {
    return false;
  }
  const { doc, schema, tr } = state;
  const only = doc.childCount === 1 && doc.firstChild === target.node;
  if (only) {
    // The document always holds a block: an empty line takes its place.
    tr.replaceWith(0, doc.content.size, schema.node("paragraph"));
  } else {
    tr.deleteRange(target.pos, target.pos + target.node.nodeSize);
  }
  const $near = tr.doc.resolve(Math.min(target.pos, tr.doc.content.size));
  editor.view.dispatch(
    tr.setSelection(Selection.near($near, -1)).scrollIntoView()
  );
  return true;
}

export function duplicateBlock(editor: Editor, target: BlockTarget): boolean {
  const { state } = editor;
  if (!current(state, target)) {
    return false;
  }
  const after = target.pos + target.node.nodeSize;
  const tr = state.tr.insert(after, target.node);
  editor.view.dispatch(
    tr.setSelection(Selection.near(tr.doc.resolve(after + 1))).scrollIntoView()
  );
  return true;
}

/** Swaps the block with the one before (-1) or after (1) it, keeping the selection in it. */
export function moveBlock(
  editor: Editor,
  target: BlockTarget,
  direction: -1 | 1
): boolean {
  const { state } = editor;
  if (!current(state, target)) {
    return false;
  }
  const $pos = state.doc.resolve(target.pos);
  const sibling = $pos.parent.maybeChild($pos.index() + direction);
  if (!sibling) {
    return false;
  }
  const { node, pos } = target;
  const to = direction < 0 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
  const tr = state.tr.delete(pos, pos + node.nodeSize).insert(to, node);
  const { from, to: end } = state.selection;
  const inside =
    state.selection instanceof TextSelection &&
    from > pos &&
    end < pos + node.nodeSize;
  const selection = inside
    ? TextSelection.create(tr.doc, from - pos + to, end - pos + to)
    : Selection.near(tr.doc.resolve(to + 1));
  editor.view.dispatch(tr.setSelection(selection).scrollIntoView());
  return true;
}

/** Mod+Shift+↑ and ↓ move the block or list item with the cursor, as in Notion. */
export const MoveBlock = Extension.create({
  addKeyboardShortcuts() {
    const move = (direction: -1 | 1) => () => {
      const target = selectedBlock(this.editor.state);
      return target ? moveBlock(this.editor, target, direction) : false;
    };
    return {
      "Mod-Shift-ArrowDown": move(1),
      "Mod-Shift-ArrowUp": move(-1),
    };
  },
  name: "moveBlock",
});
