import { EditorContent, useEditor } from "@tiptap/react";
import { format, fromUnixTime } from "date-fns";
import { useEffect, useRef } from "react";

import {
  ARTICLE,
  ARTICLE_MARKDOWN,
} from "@/components/markdown-editor/article";
import { People } from "@/features/card/card-parts";
import type { PostFields } from "@/lib/blog";
import { postTitle, usedImages } from "@/lib/blog";

/** An article's text as the website shows it, read with the same Markdown rules. */
function ArticleText({ content }: { content: string }) {
  const editor = useEditor({
    content: ARTICLE_MARKDOWN.parse(content),
    editable: false,
    editorProps: { attributes: { class: "rich-text page-text article-text" } },
    extensions: ARTICLE,
  });
  // The text shown, so it's only loaded again once it changes.
  const shown = useRef(content);
  useEffect(() => {
    if (editor && content !== shown.current) {
      shown.current = content;
      editor
        .chain()
        .setMeta("preventAutolink", true)
        .setContent(ARTICLE_MARKDOWN.parse(content), { emitUpdate: false })
        .run();
    }
  }, [editor, content]);
  return <EditorContent editor={editor} />;
}

/**
 * One language of a post the way its website lays it out: the title,
 * summary, byline and date over the cover, then the text.
 */
export function PostPreview({ fields }: { fields: PostFields }) {
  const cover = usedImages(fields).find((image) => image.url === fields.cover);
  const date =
    fields.publishedAt === undefined
      ? undefined
      : fromUnixTime(fields.publishedAt);
  return (
    <article className="flex flex-col gap-6" lang={fields.locale}>
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">
          {postTitle(fields)}
        </h1>
        {fields.summary && (
          <p className="text-muted-foreground text-lg text-pretty">
            {fields.summary}
          </p>
        )}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <People pubkeys={fields.authors} />
          </span>
          {date && (
            <time dateTime={date.toISOString()}>{format(date, "PP")}</time>
          )}
        </div>
      </header>
      {fields.cover && (
        <img
          alt={fields.coverAlt}
          className="aspect-video w-full rounded-xl object-cover"
          sizes="(min-width: 48rem) 48rem, 100vw"
          src={fields.cover}
          srcSet={cover?.sizes
            .map(({ url, width }) => `${url} ${width}w`)
            .join(", ")}
        />
      )}
      <ArticleText content={fields.content} />
      {fields.topics.length > 0 && (
        <ul aria-label="Topics" className="flex flex-wrap gap-1.5">
          {fields.topics.map((topic) => (
            <li
              className="bg-foreground/6 rounded-md px-2 py-0.5 text-sm"
              key={topic}
            >
              {topic}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
