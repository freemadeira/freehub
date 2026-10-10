/**
 * What someone read or archived in their inbox, kept on the relay as a NIP-78
 * app data event so every device agrees. The list is encrypted (NIP-44) to
 * the team's notifier when there is one, so it can skip what was already
 * read, or else to the person themselves. No browser APIs here.
 */
import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import type { Template } from "@/lib/model";
import { APP_DATA_KIND, isPubkey } from "@/lib/model";

export const INBOX_D = "freehub/inbox";
/**
 * Marks kept of each kind, oldest dropped first: well over what the inbox
 * asks the relays for, and well under NIP-44's 64 KB of text.
 */
const MAX_MARKS = 1000;
const EVENT_ID = /^[0-9a-f]{64}$/u;

/** Notification ids, shortened by `markKey`, in the order they were marked. */
export interface InboxMarks {
  read: ReadonlySet<string>;
  archived: ReadonlySet<string>;
}

/** One change to the marks, kept until it reaches the relay. */
export interface MarkChange {
  /** Tells a change apart from the same one made again. */
  id: string;
  mark: "read" | "archived";
  on: boolean;
  keys: string[];
}

export const NO_MARKS: InboxMarks = { archived: new Set(), read: new Set() };

/** A notification id as marks keep it: event ids shortened, so more fit. */
export function markKey(id: string): string {
  return EVENT_ID.test(id) ? id.slice(0, 16) : id;
}

export function isRead(marks: InboxMarks, id: string): boolean {
  return marks.read.has(markKey(id));
}

export function isArchived(marks: InboxMarks, id: string): boolean {
  return marks.archived.has(markKey(id));
}

function newest(keys: Iterable<string>): Set<string> {
  return new Set([...keys].slice(-MAX_MARKS));
}

/** The marks with the changes made, in order. A key marked again counts as new. */
export function applyMarkChanges(
  marks: InboxMarks,
  changes: readonly MarkChange[]
): InboxMarks {
  const read = new Set(marks.read);
  const archived = new Set(marks.archived);
  for (const { mark, on, keys } of changes) {
    const set = mark === "read" ? read : archived;
    for (const key of keys) {
      set.delete(key);
      if (on) {
        set.add(key);
      }
    }
  }
  return { archived: newest(archived), read: newest(read) };
}

function keyList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function parseMarks(text: string): InboxMarks {
  try {
    const saved: unknown = JSON.parse(text);
    const fields: Record<string, unknown> =
      typeof saved === "object" && saved !== null ? { ...saved } : {};
    return {
      archived: newest(keyList(fields.archived).map(markKey)),
      read: newest(keyList(fields.read).map(markKey)),
    };
  } catch {
    return NO_MARKS;
  }
}

export function serializeMarks(marks: InboxMarks): string {
  return JSON.stringify({
    archived: [...marks.archived],
    read: [...marks.read],
  });
}

/** The marks event, its content already encrypted to `reader`. */
export function marksTemplate(content: string, reader: string): Template {
  return {
    content,
    kind: APP_DATA_KIND,
    tags: [
      ["d", INBOX_D],
      // Names who can read it besides its author, and routes it to them.
      ["p", reader],
    ],
  };
}

/** Whom the event's content is encrypted to, besides its author. */
export function marksReader(event: NostrEvent): string {
  const reader = getTagValue(event, "p");
  return isPubkey(reader) ? reader : event.pubkey;
}
