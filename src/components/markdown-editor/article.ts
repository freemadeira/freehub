import type { Extensions, JSONContent } from "@tiptap/core";
import { Extension, Node, textblockTypeInputRule } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { StarterKit } from "@tiptap/starter-kit";

import type { HeadingLevel } from "@/components/markdown-editor/blocks";
import {
  CommonMarkOrderedList,
  isFullAddress,
  MarkdownParagraph,
  markdownDialect,
} from "@/components/markdown-editor/content";
import {
  imageMarkdown,
  isImageAddress,
  isPublicLink,
  plainAlt,
} from "@/lib/blog";

/** The title is the page's only first-level heading. */
export const ARTICLE_HEADINGS: readonly HeadingLevel[] = [2, 3, 4];
const TOP = Math.min(...ARTICLE_HEADINGS);
const BOTTOM = Math.max(...ARTICLE_HEADINGS);

// Links go to web and mail addresses, never into the app: an article is
// read away from it, by people who can't open it.
function isWebLink(url: string): boolean {
  return isPublicLink(url, globalThis.location.origin);
}

function loads(src: unknown): boolean {
  return isImageAddress(String(src ?? ""));
}

/**
 * A picture on a line of its own, with alt text and a caption, written
 * `![alt](address "caption")`. While it uploads it has an upload's id and no
 * address yet, and isn't written at all.
 */
export const ArticleImage = Node.create({
  addAttributes: () => ({
    alt: { default: "" },
    src: { default: null },
    /** The caption, as Markdown calls a picture's title. */
    title: { default: "" },
    upload: { default: null, rendered: false },
  }),
  atom: true,
  draggable: true,
  group: "block",
  name: "image",
  parseHTML: () => [
    {
      getAttrs: (element) => {
        const image = element.querySelector("img");
        return image && loads(image.getAttribute("src"))
          ? {
              alt: image.getAttribute("alt") ?? "",
              src: image.getAttribute("src"),
              title:
                element.querySelector("figcaption")?.textContent?.trim() ?? "",
            }
          : false;
      },
      tag: "figure",
    },
    {
      getAttrs: (element) =>
        loads(element.getAttribute("src"))
          ? {
              alt: element.getAttribute("alt") ?? "",
              src: element.getAttribute("src"),
              title: element.getAttribute("title") ?? "",
            }
          : false,
      tag: "img[src]",
    },
  ],
  parseMarkdown: (token, helpers) =>
    helpers.createNode("image", {
      alt: plainAlt(token.tokens),
      src: token.href,
      title: token.title ?? "",
    }),
  renderHTML: ({ node }) => {
    const { src, alt, title } = node.attrs;
    const image = ["img", { alt, src: loads(src) ? src : null }];
    return title
      ? ["figure", {}, image, ["figcaption", {}, title]]
      : ["figure", {}, image];
  },
  renderMarkdown: (node) =>
    imageMarkdown({
      alt: String(node.attrs?.alt ?? ""),
      caption: String(node.attrs?.title ?? ""),
      url: String(node.attrs?.src ?? ""),
    }),
});

/** "# " starts the largest heading an article has, as "## " does. */
const TopHeading = Extension.create({
  addInputRules() {
    const { heading } = this.editor.schema.nodes;
    return heading
      ? [
          textblockTypeInputRule({
            find: /^#\s$/u,
            getAttributes: { level: TOP },
            type: heading,
          }),
        ]
      : [];
  },
  name: "topHeading",
});

/**
 * What a blog post's text can hold: what the website shows, and nothing that
 * points into the app. Headings from the second level down, since the title
 * is the first; links to the web and mail only; no mentions, references or
 * to-do lists; and pictures on lines of their own.
 */
export const ARTICLE: Extensions = [
  StarterKit.configure({
    dropcursor: { class: "drop-cursor", color: false, width: 3 },
    heading: { levels: [...ARTICLE_HEADINGS] },
    link: {
      isAllowedUri: (url, { defaultValidate }) =>
        defaultValidate(url) && isWebLink(url),
      shouldAutoLink: (url) => isFullAddress(url) && isWebLink(url),
    },
    orderedList: false,
    paragraph: false,
    // Markdown has no way to write it.
    underline: false,
  }),
  MarkdownParagraph,
  CommonMarkOrderedList,
  TableKit.configure({ table: { resizable: false } }),
  ArticleImage,
  TopHeading,
];

/** The article's extensions with the picture drawn by a view of its own, like one that uploads. */
export function articleWith(image: Node): Extensions {
  return ARTICLE.map((extension) =>
    extension.name === ArticleImage.name ? image : extension
  );
}

function isImage(node: JSONContent): boolean {
  return node.type === ArticleImage.name;
}

/** The nodes without the line breaks that set a picture apart from them. */
function trimBreaks(nodes: JSONContent[]): JSONContent[] {
  let start = 0;
  let end = nodes.length;
  while (start < end && nodes[start]?.type === "hardBreak") {
    start += 1;
  }
  while (end > start && nodes[end - 1]?.type === "hardBreak") {
    end -= 1;
  }
  return nodes.slice(start, end);
}

/** A line of text holding pictures, as the lines and pictures it reads as. */
function splitAroundImages(block: JSONContent): JSONContent[] {
  const blocks: JSONContent[] = [];
  let line: JSONContent[] = [];
  const endLine = () => {
    const text = trimBreaks(line);
    if (text.length > 0) {
      blocks.push({ ...block, content: text });
    }
    line = [];
  };
  for (const node of block.content ?? []) {
    if (isImage(node)) {
      endLine();
      // A picture from where it can't be shown safely, like plain http, goes.
      if (loads(node.attrs?.src)) {
        blocks.push({ attrs: node.attrs, type: node.type });
      }
    } else {
      line.push(node);
    }
  }
  endLine();
  return blocks;
}

function clampLevel(level: unknown): number {
  return Math.min(BOTTOM, Math.max(TOP, Number(level) || TOP));
}

function isWebLinkMark(mark: {
  type: string;
  attrs?: Record<string, unknown>;
}) {
  return mark.type !== "link" || isWebLink(String(mark.attrs?.href ?? ""));
}

/** A heading at a level an article has, and text without links it can't hold. */
function fitNode(node: JSONContent): JSONContent {
  if (node.type === "heading") {
    return {
      ...node,
      attrs: { ...node.attrs, level: clampLevel(node.attrs?.level) },
    };
  }
  // A link it refused, like a script, stays as its text.
  return node.marks && !node.marks.every(isWebLinkMark)
    ? { ...node, marks: node.marks.filter(isWebLinkMark) }
    : node;
}

/**
 * Markdown read into an article: a picture written inside a line gets one of
 * its own, headings fit the levels an article has, and links go only to the
 * web and mail.
 */
function fitArticle(node: JSONContent): JSONContent[] {
  const fitted = fitNode(node);
  if (
    (fitted.type === "paragraph" || fitted.type === "heading") &&
    fitted.content?.some(isImage)
  ) {
    return splitAroundImages(fitted);
  }
  if (!fitted.content) {
    // A picture from where it can't be shown safely, like plain http, goes.
    return isImage(fitted) && !loads(fitted.attrs?.src) ? [] : [fitted];
  }
  const content = fitted.content.flatMap(fitArticle);
  // A list item starts with a line of text, even an empty one.
  if (fitted.type === "listItem" && content[0]?.type !== "paragraph") {
    content.unshift({ type: "paragraph" });
  }
  return [{ ...fitted, content }];
}

/** A blog post's Markdown, as the website reads it. Pictures still uploading have no address to write yet. */
export const ARTICLE_MARKDOWN = markdownDialect(ARTICLE, {
  read: (doc) => fitArticle(doc)[0] ?? doc,
  unwritten: (node) => isImage(node) && !node.attrs?.src,
});
