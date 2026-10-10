/**
 * Notifications are read from relay events, not sent as events of their own.
 * Each rule names the events that may notify someone, as relay filters, and
 * what one of them means for that person. Every way of delivering them shares
 * these rules: the in-app inbox today, an email bridge or a bot subscribed to
 * the relay later. No browser APIs here, so they run anywhere.
 *
 * A rule only reads the event. Whoever delivers a notification still checks
 * that its author belongs to the board or project, as the inbox does.
 */
import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";

import { mentionExcerpt, parsePageMentions } from "@/lib/docs";
import { mentions } from "@/lib/mentions";
import {
  addressOf,
  CARD_KIND,
  COMMENT_KIND,
  DOC_PAGE_KIND,
  DRIVE_FILE_KIND,
  isDeleted,
  PROJECT_KIND,
} from "@/lib/model";

/** Newest events each rule asks the relays for. */
const LIMIT = 200;

interface MentionFields {
  /** Keys whether it was read, and stays the same until they're mentioned anew. */
  id: string;
  actor: string;
  createdAt: number;
  /** The words that mention the recipient, with mentions as `nostr:` references. */
  content: string;
}

/** Someone mentioned the recipient in a comment on a card. */
export interface CommentNotification extends MentionFields {
  type: "comment";
  /** The card's `d` tag; its board comes from the card itself. */
  cardId: string;
}

/** Someone mentioned the recipient in a doc page. */
export interface PageNotification extends MentionFields {
  type: "page";
  /** Address of the page's project. */
  project: string;
  /** The page's `d` tag. */
  pageId: string;
}

/** Someone mentioned the recipient in a comment on a Drive file. */
export interface FileNotification extends MentionFields {
  type: "file";
  /** The file's `d` tag; its project comes from the file itself. */
  fileId: string;
}

/** Everything that can reach someone. A new rule adds its own member. */
export type Notification =
  | CommentNotification
  | PageNotification
  | FileNotification;

export interface NotificationRule {
  /** Relay filters for the events that may notify the recipient. */
  filters: (recipient: string) => Filter[];
  /** What the event means for the recipient, if anything. */
  derive: (event: NostrEvent, recipient: string) => Notification | undefined;
}

/**
 * Mentions of the recipient in comments on things of one kind, with the
 * commented thing's `d` tag as `about` makes it into a notification.
 */
function commentMention(
  kind: number,
  about: (id: string, mention: MentionFields) => Notification
): NotificationRule {
  return {
    derive(event, recipient) {
      if (
        event.kind !== COMMENT_KIND ||
        event.pubkey === recipient ||
        getTagValue(event, "K") !== String(kind) ||
        !mentions(event.content, recipient)
      ) {
        return;
      }
      const root = parseReplaceableAddress(getTagValue(event, "A") ?? "");
      if (root?.kind !== kind) {
        return;
      }
      return about(root.identifier, {
        actor: event.pubkey,
        content: event.content,
        createdAt: event.created_at,
        id: event.id,
      });
    },
    // Mentions carry a `p` tag per person, so the relay can do the routing.
    filters: (recipient) => [
      {
        "#K": [String(kind)],
        "#p": [recipient],
        kinds: [COMMENT_KIND],
        limit: LIMIT,
      },
    ],
  };
}

const cardMention = commentMention(CARD_KIND, (cardId, mention) => ({
  ...mention,
  cardId,
  type: "comment",
}));

const fileMention = commentMention(DRIVE_FILE_KIND, (fileId, mention) => ({
  ...mention,
  fileId,
  type: "file",
}));

/**
 * The mention of the recipient in this version of a page. Every member saves
 * versions of their own, over and over, but each carries who mentioned whom
 * and when, so all of them name the same notification until someone picks
 * the recipient again. Check it against the page's newest version: an older
 * one may still mention someone since taken out.
 */
export function pageNotification(
  event: NostrEvent,
  recipient: string
): PageNotification | undefined {
  const pageId = getTagValue(event, "d");
  const project = addressOf(event, PROJECT_KIND);
  const mention = parsePageMentions(event).find(
    (item) => item.pubkey === recipient
  );
  if (
    event.kind !== DOC_PAGE_KIND ||
    !(pageId && project && mention) ||
    mention.by === recipient ||
    isDeleted(event) ||
    !mentions(event.content, recipient)
  ) {
    return;
  }
  return {
    actor: mention.by,
    content: mentionExcerpt(event.content, recipient),
    createdAt: mention.at,
    id: `${pageId}:${mention.at}`,
    pageId,
    project,
    type: "page",
  };
}

const docMention: NotificationRule = {
  derive: pageNotification,
  filters: (recipient) => [
    { "#p": [recipient], kinds: [DOC_PAGE_KIND], limit: LIMIT },
  ],
};

export const NOTIFICATION_RULES: readonly NotificationRule[] = [
  cardMention,
  docMention,
  fileMention,
];

export function notificationFilters(recipient: string): Filter[] {
  return NOTIFICATION_RULES.flatMap((rule) => rule.filters(recipient));
}

/** The recipient's notifications among the events, newest first. */
export function deriveNotifications(
  events: NostrEvent[],
  recipient: string
): Notification[] {
  const found = new Map<string, Notification>();
  for (const event of events) {
    for (const rule of NOTIFICATION_RULES) {
      const notification = rule.derive(event, recipient);
      if (notification && !found.has(notification.id)) {
        found.set(notification.id, notification);
      }
    }
  }
  return [...found.values()].toSorted((a, b) => b.createdAt - a.createdAt);
}
