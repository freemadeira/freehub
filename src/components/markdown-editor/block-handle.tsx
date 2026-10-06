import type { ComputePositionConfig, VirtualElement } from "@floating-ui/dom";
import { offset } from "@floating-ui/dom";
import type { Editor } from "@tiptap/core";
import type {
  DragHandleRule,
  NestedOptions,
} from "@tiptap/extension-drag-handle";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { NodeSelection, Selection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import {
  CheckIcon,
  CopyIcon,
  GripVerticalIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import type { MouseEvent } from "react";
import { useRef, useState } from "react";

import type { BlockTarget } from "@/components/markdown-editor/block-actions";
import {
  deleteBlock,
  duplicateBlock,
  selectBlockText,
} from "@/components/markdown-editor/block-actions";
import { BLOCK_TYPES } from "@/components/markdown-editor/blocks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Height of the handle's buttons, to center them on a block's first line. */
const HANDLE = 24;
/** Room between the handle and its block. */
const GAP = 6;
const ITEMS = new Set(["listItem", "taskItem"]);
const CONTAINERS = new Set([
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
]);
const TEXT_LINE = "p, h1, h2, h3, h4, h5, h6, pre, th, td";
/**
 * What the handle grabs, as in Notion: a top-level block, or a list item on
 * its own. The text inside a quote, a table cell or a list item moves with it.
 */
const BLOCKS_ONLY: DragHandleRule = {
  evaluate: ({ node, depth }) =>
    depth === 1 || ITEMS.has(node.type.name) ? 0 : 1000,
  id: "blocksOnly",
};
const NESTED: NestedOptions = { rules: [BLOCKS_ONLY] };
const POSITION: ComputePositionConfig = {
  middleware: [offset(GAP)],
  placement: "left-start",
};

const BUTTON =
  "text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-ring/50 flex h-6 w-5 items-center justify-center rounded-md outline-none transition-colors duration-150 focus-visible:ring-3 [&_svg]:size-4";

// Keeps the handle where it is while its menu is open. The React handle has
// no lock command of its own; its plugin reads this meta.
function lockHandle(editor: Editor, locked: boolean) {
  editor.view.dispatch(editor.state.tr.setMeta("lockDragHandle", locked));
}

function px(value: string): number {
  return Number(value.replace(/px$/u, "")) || 0;
}

/**
 * Where the handle goes for a block: centered on its first line, and left of
 * a list item's bullet.
 */
function handleAnchor(
  editor: Editor,
  target: BlockTarget
): VirtualElement | null {
  const dom = editor.view.nodeDOM(target.pos);
  if (!(dom instanceof HTMLElement)) {
    return null;
  }
  const line = dom.matches(TEXT_LINE)
    ? dom
    : (dom.querySelector<HTMLElement>(TEXT_LINE) ?? dom);
  const bulleted =
    ITEMS.has(target.node.type.name) && target.node.type.name !== "taskItem";
  return {
    getBoundingClientRect: () => {
      const style = getComputedStyle(line);
      const height = px(style.lineHeight) || px(style.fontSize) * 1.5;
      const top = line.getBoundingClientRect().top + px(style.paddingTop);
      const box = dom.getBoundingClientRect();
      const bullet = bulleted
        ? px(getComputedStyle(dom.parentElement ?? dom).paddingLeft)
        : 0;
      return new DOMRect(
        box.left - bullet,
        top + (height - HANDLE) / 2,
        box.width + bullet,
        HANDLE
      );
    },
  };
}

/** An empty line after (or, with Alt, before) the block, with "/" typed to pick what it becomes. */
function addBlock(editor: Editor, target: BlockTarget, above: boolean) {
  const { node, pos } = target;
  const { state } = editor;
  if (state.doc.nodeAt(pos) !== node) {
    return;
  }
  const chain = editor.chain().focus();
  if (node.type.name === "paragraph" && node.content.size === 0) {
    chain
      .setTextSelection(pos + 1)
      .insertContent("/")
      .run();
    return;
  }
  const at = above ? pos : pos + node.nodeSize;
  if (ITEMS.has(node.type.name)) {
    chain
      .insertContentAt(at, {
        attrs: node.type.name === "taskItem" ? { checked: false } : undefined,
        content: [{ type: "paragraph" }],
        type: node.type.name,
      })
      .setTextSelection(at + 2)
      .insertContent("/")
      .run();
    return;
  }
  chain
    .insertContentAt(at, { type: "paragraph" })
    .setTextSelection(at + 1)
    .insertContent("/")
    .run();
}

/**
 * Notion's block controls, shown beside the block under the pointer: "+" adds
 * a block below it and the grip drags it elsewhere, or opens its menu.
 */
export function BlockHandle({ editor }: { editor: Editor }) {
  const hovered = useRef<BlockTarget | null>(null);
  const grip = useRef<HTMLButtonElement>(null);
  // The block the menu acts on, while it's open.
  const [menu, setMenu] = useState<BlockTarget | null>(null);
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      menu ? BLOCK_TYPES.find((type) => type.isActive(current))?.id : undefined,
  });

  const openMenu = () => {
    const target = hovered.current;
    if (!target) {
      return;
    }
    lockHandle(editor, true);
    // Shows which block the menu is for.
    if (NodeSelection.isSelectable(target.node)) {
      editor.view.dispatch(
        editor.state.tr.setSelection(
          NodeSelection.create(editor.state.doc, target.pos)
        )
      );
    }
    setMenu(target);
  };

  const closeMenu = (refocus: boolean) => {
    setMenu(null);
    if (!editor.isDestroyed) {
      lockHandle(editor, false);
    }
    if (!refocus || editor.isDestroyed) {
      return;
    }
    // Back to the text with a cursor, so typing can't replace the selected block.
    const { selection, doc } = editor.state;
    if (selection instanceof NodeSelection) {
      const end = selection.from + selection.node.nodeSize;
      editor.view.dispatch(
        editor.state.tr.setSelection(Selection.near(doc.resolve(end), -1))
      );
    }
    editor.view.focus();
  };

  const act = (action: (target: BlockTarget) => unknown) => () => {
    if (menu) {
      action(menu);
    }
    closeMenu(true);
  };

  return (
    <>
      <DragHandle
        className="drag-handle flex items-center gap-px transition-opacity duration-150 data-[dragging=true]:opacity-0 max-sm:hidden pointer-coarse:hidden"
        computePositionConfig={POSITION}
        editor={editor}
        getReferencedVirtualElement={() =>
          hovered.current ? handleAnchor(editor, hovered.current) : null
        }
        nested={NESTED}
        onNodeChange={({ node, pos }) => {
          hovered.current = node ? { node, pos } : null;
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                aria-label="Add a block below"
                className={BUTTON}
                onClick={(event: MouseEvent) => {
                  if (hovered.current) {
                    addBlock(editor, hovered.current, event.altKey);
                  }
                }}
                // Keeps the cursor where it is until the new block takes it.
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent>Add below</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                aria-expanded={menu !== null}
                aria-haspopup="menu"
                aria-label="Block options"
                className={`${BUTTON} cursor-grab active:cursor-grabbing`}
                onClick={openMenu}
                ref={grip}
                type="button"
              />
            }
          >
            <GripVerticalIcon />
          </TooltipTrigger>
          <TooltipContent>Drag to move</TooltipContent>
        </Tooltip>
      </DragHandle>
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (!open) {
            closeMenu(true);
          }
        }}
        open={menu !== null}
      >
        <DropdownMenuContent
          align="start"
          anchor={grip}
          finalFocus={false}
          side="left"
        >
          {menu &&
            (menu.node.isTextblock || CONTAINERS.has(menu.node.type.name)) && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Turn into</DropdownMenuLabel>
                  {BLOCK_TYPES.map((type) => (
                    <DropdownMenuItem
                      key={type.id}
                      onClick={act((target) => {
                        if (selectBlockText(editor, target)) {
                          type.run(editor.chain(), editor).run();
                        }
                      })}
                    >
                      <type.icon />
                      {type.label}
                      {active === type.id && <CheckIcon className="ml-auto" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
          <DropdownMenuItem
            onClick={act((target) => duplicateBlock(editor, target))}
          >
            <CopyIcon />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={act((target) => deleteBlock(editor, target))}
            variant="destructive"
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
