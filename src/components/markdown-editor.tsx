import { cn } from "cn";
import type { KeyboardEventHandler } from "react";
import { lazy, Suspense } from "react";

// The editor is the heaviest part of a card, so it loads with the first card
// opened; until then the text shows as written.
const MarkdownEditorView = lazy(async () => {
  const module = await import("@/components/markdown-editor/editor");
  return { default: module.MarkdownEditorView };
});

export interface MarkdownEditorProps {
  /** Markdown to show. A new value replaces the text unless it's being edited. */
  value: string;
  /** The edited markdown, once the editor loses focus or closes, or on submit. */
  onValueCommitted: (markdown: string) => void;
  /** Mod+Enter, with the markdown as it stands. */
  onSubmit?: (markdown: string) => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  placeholder?: string;
  className?: string;
  "aria-label": string;
}

/** Rich text stored as markdown. Markdown typed or pasted turns into formatting. */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const { value, placeholder, className } = props;
  return (
    <Suspense
      fallback={
        <p
          className={cn(
            "rich-text wrap-break-word whitespace-pre-wrap",
            !value && "text-muted-foreground",
            className
          )}
        >
          {value || placeholder}
        </p>
      }
    >
      <MarkdownEditorView {...props} />
    </Suspense>
  );
}
