import { EditorContent, useEditor } from "@tiptap/react";
import { cn } from "cn";
import { useEffect, useRef } from "react";

import type { MarkdownViewProps } from "@/components/markdown-editor";
import { MarkdownClipboard } from "@/components/markdown-editor/clipboard";
import { CONTENT, parseMarkdown } from "@/components/markdown-editor/content";

const EXTENSIONS = [...CONTENT, MarkdownClipboard];

export function MarkdownViewer({ value, className }: MarkdownViewProps) {
  const editor = useEditor({
    content: parseMarkdown(value),
    editable: false,
    editorProps: { attributes: { class: cn("rich-text", className) } },
    extensions: EXTENSIONS,
  });
  // The value the text shows, so it's only loaded again once it changes.
  const shown = useRef(value);

  useEffect(() => {
    if (editor && value !== shown.current) {
      shown.current = value;
      // As in the editor, plain addresses aren't linked up on load.
      editor
        .chain()
        .setMeta("preventAutolink", true)
        .setContent(parseMarkdown(value), { emitUpdate: false })
        .run();
    }
  }, [editor, value]);

  return <EditorContent editor={editor} />;
}
