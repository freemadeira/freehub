import { cn } from "cn";
import type { KeyboardEventHandler } from "react";
import { lazy, Suspense } from "react";

// The editor is the heaviest part of a card, so it loads with the first card
// opened; until then the text shows as written.
const MarkdownEditorView = lazy(async () => {
  const module = await import("@/components/markdown-editor/editor");
  return { default: module.MarkdownEditorView };
});

const MarkdownViewer = lazy(async () => {
  const module = await import("@/components/markdown-editor/viewer");
  return { default: module.MarkdownViewer };
});

export interface MarkdownEditorProps {
  /** Markdown to show. A new value replaces the text unless it's being edited. */
  value: string;
  /**
   * The edited markdown, once the editor loses focus or closes, or on submit,
   * with the people picked from the "@" list since the last commit.
   */
  onValueCommitted: (markdown: string, picked: ReadonlySet<string>) => void;
  /** People who can be mentioned with "@". Without them, "@" is just text. */
  people?: string[];
  /** Mod+Enter, with the markdown as it stands. */
  onSubmit?: (markdown: string) => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  placeholder?: string;
  className?: string;
  "aria-label": string;
}

export type MarkdownViewProps = Pick<
  MarkdownEditorProps,
  "value" | "className"
>;

function AsWritten({
  value,
  placeholder,
  className,
}: Pick<MarkdownEditorProps, "value" | "placeholder" | "className">) {
  return (
    <p
      className={cn(
        "rich-text wrap-break-word whitespace-pre-wrap",
        !value && "text-muted-foreground",
        className
      )}
    >
      {value || placeholder}
    </p>
  );
}

/** Rich text stored as markdown. Markdown typed or pasted turns into formatting. */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const { value, placeholder, className } = props;
  return (
    <Suspense
      fallback={
        <AsWritten
          className={className}
          placeholder={placeholder}
          value={value}
        />
      }
    >
      <MarkdownEditorView {...props} />
    </Suspense>
  );
}

/** The same rich text, for people who can only read it. */
export function MarkdownView({ value, className }: MarkdownViewProps) {
  return (
    <Suspense fallback={<AsWritten className={className} value={value} />}>
      <MarkdownViewer className={className} value={value} />
    </Suspense>
  );
}
