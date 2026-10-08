import { Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { getDisplayName } from "applesauce-core/helpers/profile";

import { leadingMention, mentionReference } from "@/lib/mentions";
import { isPubkey } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { shortNpub } from "@/lib/utils";

const PROFILE_KIND = 0;
/** Looks like the mentions in comments. */
const CHIP = "bg-primary/20 rounded-md px-1 font-medium";

function label(name: string | undefined, pubkey: string): string {
  return `@${name ?? shortNpub(pubkey)}`;
}

// The name as known right now, for copied text.
function knownLabel(pubkey: string): string {
  const profile = eventStore.getReplaceable(PROFILE_KIND, pubkey);
  return label(profile && getDisplayName(profile), pubkey);
}

/** A mention as plain text: the name it shows. */
export function mentionText(node: ProseMirrorNode): string {
  return knownLabel(String(node.attrs.pubkey));
}

/**
 * Someone mentioned in the text, saved as a `nostr:npub1…` reference
 * (NIP-27) and shown as their name, which follows their profile.
 */
export const Mention = Node.create({
  addAttributes: () => ({
    pubkey: {
      default: null,
      parseHTML: (element) => {
        const pubkey = element.dataset.mention;
        return isPubkey(pubkey) ? pubkey : null;
      },
      renderHTML: (attributes) => ({ "data-mention": attributes.pubkey }),
    },
  }),
  addNodeView:
    () =>
    ({ node }) => {
      const pubkey = String(node.attrs.pubkey);
      const dom = document.createElement("span");
      dom.className = CHIP;
      dom.dataset.mention = pubkey;
      dom.textContent = knownLabel(pubkey);
      const subscription = eventStore.profile(pubkey).subscribe((profile) => {
        dom.textContent = label(getDisplayName(profile), pubkey);
      });
      return {
        destroy: () => subscription.unsubscribe(),
        dom,
        // The name changing is the view's own doing, not an edit.
        ignoreMutation: () => true,
      };
    },
  atom: true,
  group: "inline",
  inline: true,
  markdownTokenizer: {
    level: "inline",
    name: "mention",
    start: (src) => src.indexOf("nostr:"),
    tokenize: (src) => {
      const mention = leadingMention(src);
      return mention
        ? { pubkey: mention.pubkey, raw: mention.reference, type: "mention" }
        : undefined;
    },
  },
  // Formatting stays around a mention, so its reference is always written bare.
  marks: "",
  name: "mention",
  parseHTML: () => [
    {
      getAttrs: (element) => (isPubkey(element.dataset.mention) ? null : false),
      tag: "span[data-mention]",
    },
  ],
  parseMarkdown: (token, helpers) =>
    helpers.createNode("mention", { pubkey: token.pubkey }),
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    { ...HTMLAttributes, class: CHIP },
    mentionText(node),
  ],
  renderMarkdown: (node) => mentionReference(String(node.attrs?.pubkey)),
  renderText: ({ node }) => mentionText(node),
  selectable: false,
});
