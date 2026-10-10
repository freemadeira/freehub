/**
 * Notifications are read from relay events, not sent as events of their own.
 * Each rule names the events that may notify someone, as relay filters, and
 * what one of them means for that person. Every way of delivering them shares
 * these rules: the in-app inbox and the push notifier. No browser APIs here,
 * so they run anywhere.
 *
 * A rule only reads the event. Whoever delivers a notification still checks
 * it against what it points at, with `locateNotification`.
 */
import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { subDays } from "date-fns";

import type { CardChange } from "@/lib/card-activity";
import { parseCardActivity } from "@/lib/card-activity";
import { ASSIGNED, isLoggedActivity } from "@/lib/crm";
import { mentionExcerpt, parsePageMentions } from "@/lib/docs";
import { mentions } from "@/lib/mentions";
import {
  addressOf,
  CARD_KIND,
  COMMENT_KIND,
  CRM_RECORD_KIND,
  date,
  DOC_PAGE_KIND,
  DRIVE_FILE_KIND,
  isClosed,
  isDeleted,
  isPubkey,
  parseStatus,
  PROJECT_KIND,
  toSubscriber,
} from "@/lib/model";

/** Newest events each rule asks the relays for. */
const LIMIT = 200;
/** When a due date is near enough to remind its assignees: this hour, the day before. */
const REMIND_HOUR = 9;

interface NotificationFields {
  /** Keys whether it was read, and stays the same until there's news again. */
  id: string;
  /** Who did it; a reminder has no one. */
  actor?: string;
  createdAt: number;
  /**
   * About the recipient themselves, like a mention, an assignment or a
   * reminder, rather than about something they subscribe to.
   */
  direct: boolean;
}

/** What happened on a card. */
export type CardNews =
  /** A comment mentions the recipient. */
  | { reason: "mention"; content: string }
  /** A comment on a card the recipient subscribes to. */
  | { reason: "comment"; content: string }
  /** The description mentions the recipient. */
  | { reason: "description" }
  | { reason: "change"; changes: CardChange[] }
  /** The recipient's card is due soon. */
  | { reason: "due"; due: string };

export type CardNotification = NotificationFields &
  CardNews & {
    type: "card";
    /** The card's `d` tag; its board comes from the card itself. */
    cardId: string;
  };

/** Someone mentioned the recipient in a doc page. */
export interface PageNotification extends NotificationFields {
  type: "page";
  /** Address of the page's project. */
  project: string;
  /** The page's `d` tag. */
  pageId: string;
  /** The words that mention the recipient, with mentions as `nostr:` references. */
  content: string;
}

/** Someone mentioned the recipient in a comment on a Drive file. */
export interface FileNotification extends NotificationFields {
  type: "file";
  /** The file's `d` tag; its project comes from the file itself. */
  fileId: string;
  content: string;
}

/** What happened on a CRM record. */
export type RecordNews =
  /** An entry logged on the record mentions the recipient. */
  | { reason: "mention"; content: string }
  /** Someone put the recipient in one of the record's member fields. */
  | { reason: "assigned"; field: string };

export type RecordNotification = NotificationFields &
  RecordNews & {
    type: "record";
    /** The record's `d` tag; its table comes from the record itself. */
    recordId: string;
  };

/** Everything that can reach someone. A new rule adds its own member. */
export type Notification =
  | CardNotification
  | PageNotification
  | FileNotification
  | RecordNotification;

export interface NotificationRule {
  /** Relay filters for the events that may notify the recipient. */
  filters: (recipient: string) => Filter[];
  /** What the event means for the recipient, if anything. */
  derive: (event: NostrEvent, recipient: string) => Notification | undefined;
}

/** The `d` tag of the thing a comment on the given kind is on. */
function commentedOn(event: NostrEvent, kind: number): string | undefined {
  if (event.kind !== COMMENT_KIND || getTagValue(event, "K") !== String(kind)) {
    return undefined;
  }
  const root = parseReplaceableAddress(getTagValue(event, "A") ?? "");
  return root?.kind === kind ? root.identifier : undefined;
}

/** Comments on things of one kind that carry a `p` tag for the recipient. */
function commentFilters(kind: number) {
  return (recipient: string): Filter[] => [
    {
      "#K": [String(kind)],
      "#p": [recipient],
      kinds: [COMMENT_KIND],
      limit: LIMIT,
    },
  ];
}

/** What a comment on a card, or an activity entry on it, means for the recipient. */
function cardNews(event: NostrEvent, recipient: string): CardNews | undefined {
  if (getTagValue(event, "activity") === undefined) {
    if (mentions(event.content, recipient)) {
      return { content: event.content, reason: "mention" };
    }
    return toSubscriber(event, recipient)
      ? { content: event.content, reason: "comment" }
      : undefined;
  }
  const activity = parseCardActivity(event);
  if (activity?.mentioned.includes(recipient)) {
    return { reason: "description" };
  }
  const assigned = activity?.changes.some(
    (change) =>
      change.field === "assignees" &&
      (change.added.includes(recipient) || change.removed.includes(recipient))
  );
  return activity &&
    activity.changes.length > 0 &&
    (assigned || toSubscriber(event, recipient))
    ? { changes: activity.changes, reason: "change" }
    : undefined;
}

/** Whether the news is about the recipient themselves. */
function isDirect(news: CardNews, recipient: string): boolean {
  if (news.reason === "change") {
    return news.changes.some(
      (change) =>
        change.field === "assignees" &&
        (change.added.includes(recipient) || change.removed.includes(recipient))
    );
  }
  return news.reason !== "comment";
}

const cardThread: NotificationRule = {
  derive(event, recipient) {
    const cardId = commentedOn(event, CARD_KIND);
    const news =
      cardId && event.pubkey !== recipient
        ? cardNews(event, recipient)
        : undefined;
    if (!(cardId && news)) {
      return;
    }
    return {
      ...news,
      actor: event.pubkey,
      cardId,
      createdAt: event.created_at,
      direct: isDirect(news, recipient),
      id: event.id,
      type: "card",
    };
  },
  // Mentions and subscribers each carry a `p` tag, so the relay can do the routing.
  filters: commentFilters(CARD_KIND),
};

/** When the assignees of a card due that day hear about it: the morning before. */
export function dueReminderAt(due: string): number {
  const day = new Date(`${due}T00:00:00`);
  day.setHours(REMIND_HOUR);
  return Math.floor(subDays(day, 1).getTime() / 1000);
}

/**
 * A reminder that a card assigned to the recipient is due. It keeps its id
 * until the date changes, and is only news from `dueReminderAt` on.
 */
const dueSoon: NotificationRule = {
  derive(event, recipient) {
    const cardId = getTagValue(event, "d");
    const due = date(getTagValue(event, "due"));
    const open = !isClosed(parseStatus(getTagValue(event, "s")));
    const assigned = event.tags.some(
      ([name, pubkey]) => name === "p" && pubkey === recipient
    );
    if (
      event.kind !== CARD_KIND ||
      !(cardId && due && open && assigned) ||
      isDeleted(event)
    ) {
      return;
    }
    return {
      cardId,
      createdAt: dueReminderAt(due),
      direct: true,
      due,
      id: `due:${cardId}:${due}`,
      reason: "due",
      type: "card",
    };
  },
  // Assignees are a card's `p` tags.
  filters: (recipient) => [
    { "#p": [recipient], kinds: [CARD_KIND], limit: LIMIT },
  ],
};

const fileMention: NotificationRule = {
  derive(event, recipient) {
    const fileId = commentedOn(event, DRIVE_FILE_KIND);
    if (
      !fileId ||
      event.pubkey === recipient ||
      !mentions(event.content, recipient)
    ) {
      return;
    }
    return {
      actor: event.pubkey,
      content: event.content,
      createdAt: event.created_at,
      direct: true,
      fileId,
      id: event.id,
      type: "file",
    };
  },
  filters: commentFilters(DRIVE_FILE_KIND),
};

const recordThread: NotificationRule = {
  derive(event, recipient) {
    const recordId = commentedOn(event, CRM_RECORD_KIND);
    if (!recordId || event.pubkey === recipient) {
      return;
    }
    const fields = {
      actor: event.pubkey,
      createdAt: event.created_at,
      direct: true,
      id: event.id,
      recordId,
      type: "record",
    } as const;
    const field = getTagValue(event, "field");
    const named = event.tags.some(
      ([name, pubkey]) => name === "p" && pubkey === recipient
    );
    if (getTagValue(event, "activity") === ASSIGNED && field && named) {
      return { ...fields, field, reason: "assigned" };
    }
    return isLoggedActivity(event) && mentions(event.content, recipient)
      ? { ...fields, content: event.content, reason: "mention" }
      : undefined;
  },
  filters: commentFilters(CRM_RECORD_KIND),
};

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
    direct: true,
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
  cardThread,
  dueSoon,
  docMention,
  fileMention,
  recordThread,
];

export function notificationFilters(recipient: string): Filter[] {
  return NOTIFICATION_RULES.flatMap((rule) => rule.filters(recipient));
}

/** The recipient's notifications among the events, newest first. */
export function deriveNotifications(
  events: Iterable<NostrEvent>,
  recipient: string
): Notification[] {
  const found = new Map<string, Notification>();
  if (!isPubkey(recipient)) {
    return [];
  }
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

/**
 * Whether the notification is news yet. A reminder waits for its time;
 * anything else is news once it's there, even from a clock a little ahead.
 */
export function hasArrived(notification: Notification, now: number): boolean {
  return (
    notification.type !== "card" ||
    notification.reason !== "due" ||
    notification.createdAt <= now
  );
}

/** A card, page, file or record, as notifications about it name it. */
export function subjectOf(kind: number, id: string): string {
  return `${kind}:${id}`;
}

/** What a notification is about, so several about one thing show as one. */
export function notificationSubject(notification: Notification): string {
  switch (notification.type) {
    case "card": {
      return subjectOf(CARD_KIND, notification.cardId);
    }
    case "page": {
      return subjectOf(DOC_PAGE_KIND, notification.pageId);
    }
    case "file": {
      return subjectOf(DRIVE_FILE_KIND, notification.fileId);
    }
    default: {
      return subjectOf(CRM_RECORD_KIND, notification.recordId);
    }
  }
}
