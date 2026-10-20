import { Extension, Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { ReactNodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { navigate } from "wouter/use-browser-location";

import {
  AppLink as AppLinkView,
  appPath,
  appTarget,
} from "@/components/app-link";
import { leadingAddress } from "@/lib/links";

/** The address, if the text starts with one that goes somewhere in the app. */
function leadingAppAddress(text: string): string | undefined {
  const address = leadingAddress(text);
  return address && appTarget(address) ? address : undefined;
}

// `<address>` and `[address](address)` hold the address whole; a bare one ends
// where GitHub would end it.
function tokenizeAddress(
  src: string
): { href: string; raw: string } | undefined {
  if (src.startsWith("<")) {
    const href = leadingAppAddress(src.slice(1));
    return href && src[href.length + 1] === ">"
      ? { href, raw: `<${href}>` }
      : undefined;
  }
  if (src.startsWith("[")) {
    const href = leadingAppAddress(src.slice(1));
    const raw = `[${href}](${href})`;
    return href && src.startsWith(raw) ? { href, raw } : undefined;
  }
  const href = leadingAppAddress(src);
  return href ? { href, raw: href } : undefined;
}

export function appLinkText(node: ProseMirrorNode): string {
  return String(node.attrs.href);
}

function AppLinkNodeView({ node }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper as="span">
      <AppLinkView href={appLinkText(node)} />
    </NodeViewWrapper>
  );
}

/**
 * A link to somewhere in the app, saved as the address in angle brackets and
 * shown as what it goes to. Pasting or typing an app address turns it into one.
 */
export const AppLink = Node.create({
  addAttributes: () => ({
    href: {
      default: null,
      parseHTML: (element) => element.getAttribute("href"),
    },
  }),
  addNodeView: () => ReactNodeViewRenderer(AppLinkNodeView, { as: "span" }),
  addProseMirrorPlugins() {
    const { type } = this;
    return [
      new Plugin({
        // An address linked up as typed or pasted, its text the address itself.
        appendTransaction: (transactions, _, state) => {
          if (!transactions.some((tr) => tr.docChanged)) {
            return null;
          }
          const found: { from: number; to: number; href: string }[] = [];
          state.doc.descendants((node, pos) => {
            const link = node.marks.find((mark) => mark.type.name === "link");
            const href = String(link?.attrs.href ?? "");
            if (node.text === href && appTarget(href)) {
              found.push({ from: pos, href, to: pos + node.nodeSize });
            }
          });
          if (found.length === 0) {
            return null;
          }
          const { tr } = state;
          for (const { from, to, href } of found.toReversed()) {
            tr.replaceWith(from, to, type.create({ href }));
          }
          return tr;
        },
      }),
    ];
  },
  atom: true,
  group: "inline",
  inline: true,
  markdownTokenizer: {
    level: "inline",
    name: "appLink",
    start: (src) => {
      const index = src.indexOf(globalThis.location.origin);
      return index > 0 && "<[".includes(src.charAt(index - 1))
        ? index - 1
        : index;
    },
    tokenize: (src) => {
      const address = tokenizeAddress(src);
      return address ? { ...address, type: "appLink" } : undefined;
    },
  },
  // Formatting stays around the link, so its address is always written bare.
  marks: "",
  name: "appLink",
  parseHTML: () => [
    {
      getAttrs: (element) =>
        appTarget(element.getAttribute("href") ?? "") ? null : false,
      tag: "a[data-app-link]",
    },
  ],
  parseMarkdown: (token, helpers) =>
    helpers.createNode("appLink", { href: token.href }),
  renderHTML: ({ node }) => [
    "a",
    { "data-app-link": "", href: appLinkText(node) },
    appLinkText(node),
  ],
  renderMarkdown: (node) => `<${String(node.attrs?.href)}>`,
  renderText: ({ node }) => appLinkText(node),
  selectable: false,
});

function linkPath(view: EditorView, event: MouseEvent): string | undefined {
  const plain =
    event.button === 0 &&
    !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
  const anchor =
    event.target instanceof Element ? event.target.closest("a[href]") : null;
  return plain && anchor && view.dom.contains(anchor)
    ? appPath(anchor.getAttribute("href") ?? "")
    : undefined;
}

/** Links within the app open in place, not in a new tab. */
export const InternalLinks = Extension.create({
  addProseMirrorPlugins: () => [
    new Plugin({
      props: {
        handleClick: (view, _, event) => linkPath(view, event) !== undefined,
        handleDOMEvents: {
          click: (view, event) => {
            const path = linkPath(view, event);
            if (path === undefined) {
              return false;
            }
            event.preventDefault();
            navigate(path);
            return true;
          },
        },
      },
    }),
  ],
  name: "internalLinks",
  // Ahead of the link's own click, which opens a new tab.
  priority: 1001,
});
