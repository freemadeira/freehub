import type { Editor, JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { cn } from "cn";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";

import type { MarkdownEditorProps } from "@/components/markdown-editor";
import { MarkdownClipboard } from "@/components/markdown-editor/clipboard";
import {
  CONTENT,
  parseMarkdown,
  serializeMarkdown,
} from "@/components/markdown-editor/content";
import {
  hideSelectionToolbar,
  LinkTarget,
  SelectionToolbar,
} from "@/components/markdown-editor/toolbar";

function isSubmit(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    !event.isComposing
  );
}

export function MarkdownEditorView({
  value,
  onValueCommitted,
  onSubmit,
  onKeyDown,
  placeholder = "",
  className,
  "aria-label": label,
}: MarkdownEditorProps) {
  const extensions = useMemo(
    () => [
      ...CONTENT,
      MarkdownClipboard,
      LinkTarget,
      Placeholder.configure({ placeholder }),
    ],
    [placeholder]
  );
  // The value from outside, as editor content and as the markdown that saves.
  const incoming = useMemo(() => {
    const doc = parseMarkdown(value);
    return { doc, markdown: serializeMarkdown(doc), value };
  }, [value]);
  // The text as of its last load or commit, and the outside value at that point.
  const synced = useRef({ markdown: incoming.markdown, value });
  const focused = useRef(false);
  const toolbar = useRef<HTMLDivElement>(null);

  const commit = (doc: JSONContent): string => {
    const markdown = serializeMarkdown(doc);
    if (markdown !== synced.current.markdown) {
      synced.current = { markdown, value };
      onValueCommitted(markdown);
    }
    return markdown;
  };

  // A new value from outside replaces the text, but never while it's being
  // edited, so teammates' changes can't overwrite typing mid-sentence.
  const load = (editor: Editor, next: typeof incoming) => {
    const { current } = synced;
    if (focused.current || next.value === current.value) {
      return;
    }
    // The committed text coming back from the store.
    if (next.value === current.markdown) {
      synced.current = { ...current, value: next.value };
      return;
    }
    // Loaded as written: not undoable, and plain addresses aren't linked up.
    editor
      .chain()
      .setMeta("addToHistory", false)
      .setMeta("preventAutolink", true)
      .setContent(next.doc, { emitUpdate: false })
      .run();
    synced.current = {
      markdown: serializeMarkdown(editor.getJSON()),
      value: next.value,
    };
  };

  // Focus left both the text and its toolbar: editing is done.
  const leave = (editor: Editor) => {
    focused.current = false;
    hideSelectionToolbar(editor);
    commit(editor.getJSON());
    load(editor, incoming);
  };

  const editor = useEditor({
    content: incoming.doc,
    editorProps: {
      attributes: {
        "aria-label": label,
        "aria-multiline": "true",
        class: cn("rich-text", className),
        role: "textbox",
      },
      handleKeyDown: (view, event) => {
        if (!(onSubmit && isSubmit(event))) {
          return false;
        }
        onSubmit(commit(view.state.doc.toJSON()));
        return true;
      },
    },
    extensions,
    onBlur: ({ editor: blurred, event }) => {
      // Moving into the toolbar, to type a link or pick a style, is still editing.
      const next = event.relatedTarget;
      if (!(next instanceof Node && toolbar.current?.contains(next))) {
        leave(blurred);
      }
    },
    onFocus: () => {
      focused.current = true;
    },
  });

  const onIncoming = useEffectEvent((next: typeof incoming) => {
    if (editor) {
      load(editor, next);
    }
  });
  useEffect(() => {
    onIncoming(incoming);
  }, [incoming]);

  // Closing the card or dialog mid-edit keeps the edit.
  const onUnmount = useEffectEvent(() => {
    if (editor && !editor.isDestroyed) {
      commit(editor.getJSON());
    }
  });
  useEffect(() => () => onUnmount(), []);

  return (
    <>
      <EditorContent editor={editor} onKeyDown={onKeyDown} />
      {editor && (
        <SelectionToolbar
          editor={editor}
          onLeave={() => leave(editor)}
          ref={toolbar}
        />
      )}
    </>
  );
}
