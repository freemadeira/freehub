/**
 * What a notification says. The inbox shows it after the name of whoever did
 * it; system notifications show it as plain text. No browser APIs here: the
 * notifier words its pushes the same way.
 */
import { differenceInCalendarDays, format, parseISO } from "date-fns";

import type { CardChange } from "@/lib/card-activity";
import { recordTitle } from "@/lib/crm";
import { mentionExcerpt, pageTitle } from "@/lib/docs";
import { excerptText, splitMentions } from "@/lib/mentions";
import { cardKey, priorityLabel, statusLabel } from "@/lib/model";
import type { NotificationTarget } from "@/lib/notification-targets";

/** Characters of a comment quoted in a system notification. */
const QUOTE_LENGTH = 140;

/** Display names, by pubkey. */
export type Names = (pubkey: string) => string;

/** "A", "A and B", or "A, B and C". */
export function joinWords(words: string[]): string {
  if (words.length <= 1) {
    return words.join("");
  }
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function day(due: string): string {
  return format(parseISO(due), "MMM d");
}

/** The card's changes as the recipient reads them, what's about them first. */
function changeWords(
  changes: CardChange[],
  recipient: string,
  names: Names
): string[] {
  const mine: string[] = [];
  const rest: string[] = [];
  for (const change of changes) {
    switch (change.field) {
      case "status": {
        rest.push(`moved it to ${statusLabel(change.to)}`);
        break;
      }
      case "assignees": {
        const others = (people: string[]) =>
          joinWords(people.filter((pubkey) => pubkey !== recipient).map(names));
        if (change.added.includes(recipient)) {
          mine.push("assigned you");
        }
        if (change.removed.includes(recipient)) {
          mine.push("unassigned you");
        }
        const added = others(change.added);
        const removed = others(change.removed);
        if (added) {
          rest.push(`assigned ${added}`);
        }
        if (removed) {
          rest.push(`unassigned ${removed}`);
        }
        break;
      }
      case "priority": {
        rest.push(
          change.to
            ? `set the priority to ${priorityLabel(change.to)}`
            : "removed the priority"
        );
        break;
      }
      case "due": {
        rest.push(
          change.to
            ? `set the due date to ${day(change.to)}`
            : "removed the due date"
        );
        break;
      }
      default: {
        rest.push("renamed it");
      }
    }
  }
  return [...mine, ...rest];
}

/** "Due tomorrow", "Due today", "Overdue", or the day it's due. */
export function dueWords(due: string, now = new Date()): string {
  const days = differenceInCalendarDays(parseISO(due), now);
  if (days < 0) {
    return "Overdue";
  }
  if (days === 0) {
    return "Due today";
  }
  return days === 1 ? "Due tomorrow" : `Due ${day(due)}`;
}

/**
 * What happened, after the name of whoever did it: "mentioned you",
 * "moved it to Done and assigned you". A reminder has no one, so it reads
 * whole: "Due tomorrow".
 */
export function notificationWords(
  { notification, ...target }: NotificationTarget,
  recipient: string,
  names: Names
): string {
  switch (notification.type) {
    case "card": {
      switch (notification.reason) {
        case "mention": {
          return "mentioned you";
        }
        case "comment": {
          return "commented";
        }
        case "description": {
          return "mentioned you in the description";
        }
        case "due": {
          return dueWords(notification.due);
        }
        default: {
          return joinWords(changeWords(notification.changes, recipient, names));
        }
      }
    }
    case "record": {
      if (notification.reason === "mention" || !("table" in target)) {
        return "mentioned you";
      }
      const field = target.table.fields.find(
        ({ id }) => id === notification.field
      );
      return field ? `assigned you as ${field.name}` : "assigned you";
    }
    default: {
      return "mentioned you";
    }
  }
}

/**
 * The words quoted with the notification, with mentions as `nostr:`
 * references: the comment, or where the text mentions the recipient.
 */
export function notificationQuote(
  target: NotificationTarget,
  recipient: string
): string | undefined {
  const { notification } = target;
  if (
    "card" in target &&
    notification.type === "card" &&
    notification.reason === "description"
  ) {
    return mentionExcerpt(target.card.description, recipient);
  }
  return "content" in notification ? notification.content : undefined;
}

/** What the notification is about: the card by its key and title, or the page, file or record by name. */
export function notificationTitle(target: NotificationTarget): string {
  if ("card" in target) {
    return `${cardKey(target.board, target.card)} ${target.card.title || "Untitled"}`;
  }
  if ("page" in target) {
    return pageTitle(target.page);
  }
  if ("file" in target) {
    return target.file.name;
  }
  return recordTitle(target.record);
}

/** Text with each mention as `@Name`, for places that only show plain text. */
export function plainMentions(content: string, names: Names): string {
  return splitMentions(content)
    .map((segment) =>
      segment.type === "text" ? segment.text : `@${names(segment.pubkey)}`
    )
    .join("");
}

/** A system notification's text: the subject as the title, then who did what. */
export function notificationMessage(
  target: NotificationTarget,
  recipient: string,
  names: Names
): { title: string; body: string } {
  const { actor } = target.notification;
  const words = notificationWords(target, recipient, names);
  const quote = notificationQuote(target, recipient);
  const said = actor ? `${names(actor)} ${words}` : words;
  const text = quote
    ? excerptText(
        plainMentions(quote, names).replaceAll(/\s+/gu, " "),
        0,
        QUOTE_LENGTH
      )
    : "";
  return {
    body: text ? `${said}: ${text}` : said,
    title: notificationTitle(target),
  };
}
