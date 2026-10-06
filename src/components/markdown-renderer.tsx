import { MarkdownDocument } from "@comark/react";
import { createMarkdownParser } from "@comark/react/parse";
import breaks from "@comark/react/plugins/breaks";
import security from "@comark/react/plugins/security";
import taskList from "@comark/react/plugins/task-list";
import type { ComponentProps } from "react";
import { use, useDeferredValue } from "react";

// Plain markdown only. Without the default plugins raw HTML stays text and
// Comark components and attributes aren't parsed, so a card can't inject
// markup; links and images are limited to web and mail addresses.
const parse = createMarkdownParser({
  autoClose: false,
  headingIds: false,
  plugins: [
    taskList(),
    breaks(),
    security({
      allowDataImages: false,
      allowedProtocols: ["http", "https", "mailto"],
    }),
  ],
  registerDefaultPlugins: false,
});

type Parsed = Awaited<ReturnType<typeof parse>>;

const CACHE_SIZE = 50;
// React reads a promise it has seen settle without suspending again, so
// keeping them lets a shown description render straight away next time.
const documents = new Map<string, Promise<Parsed>>();

async function parseSafely(source: string): Promise<Parsed> {
  try {
    return await parse(source);
  } catch {
    return { frontmatter: {}, meta: {}, nodes: [["p", {}, source]] };
  }
}

function load(source: string): Promise<Parsed> {
  let document = documents.get(source);
  if (!document) {
    document = parseSafely(source);
    documents.set(source, document);
    for (const key of documents.keys()) {
      if (documents.size <= CACHE_SIZE) {
        break;
      }
      documents.delete(key);
    }
  }
  return document;
}

function ExternalLink({ children, ...props }: ComponentProps<"a">) {
  return (
    <a {...props} rel="noreferrer" target="_blank">
      {children}
    </a>
  );
}

const COMPONENTS = { a: ExternalLink };

export function MarkdownRenderer({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  // Keeps the previous render on screen while an edited text parses.
  const deferred = useDeferredValue(source);
  const document = use(load(deferred));
  return (
    <MarkdownDocument
      className={className}
      components={COMPONENTS}
      value={document}
    />
  );
}
