import { cn } from "cn";
import { lazy, Suspense } from "react";

// The parser is the heaviest part of a card, so it loads with the first
// description shown; until then the text shows as written.
const MarkdownRenderer = lazy(async () => {
  const module = await import("@/components/markdown-renderer");
  return { default: module.MarkdownRenderer };
});

export function Markdown({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  return (
    <Suspense
      fallback={
        <p className={cn("wrap-break-word whitespace-pre-wrap", className)}>
          {source}
        </p>
      }
    >
      <MarkdownRenderer className={cn("markdown", className)} source={source} />
    </Suspense>
  );
}
