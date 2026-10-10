import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { unixNow } from "applesauce-core/helpers/time";
import { useEffect, useState } from "react";

import { useObservableValue } from "@/hooks/use-observable-value";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import type { CrmTable } from "@/lib/crm";
import type { DocsContent } from "@/lib/docs";
import { inboxStore } from "@/lib/inbox";
import { isArchived, isRead } from "@/lib/inbox-marks";
import type { Board } from "@/lib/model";
import {
  CARD_KIND,
  CRM_RECORD_KIND,
  DELETE_KIND,
  DOC_PAGE_KIND,
  DRIVE_FILE_KIND,
} from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type {
  NotificationScope,
  NotificationTarget,
} from "@/lib/notification-targets";
import { locateNotification } from "@/lib/notification-targets";
import type { Notification } from "@/lib/notifications";
import {
  deriveNotifications,
  hasArrived,
  notificationFilters,
  notificationSubject,
} from "@/lib/notifications";
import type { Project } from "@/lib/project";
import { sync } from "@/lib/relays";
import { cardSubject } from "@/lib/subscriptions";

/** How often reminders that came due are looked for. */
const CLOCK = 60_000;

export type InboxItem = NotificationTarget & { read: boolean };

/** Notifications about one card, page, file or record, shown as one row. */
export interface InboxGroup {
  subject: string;
  /** Newest first. */
  items: InboxItem[];
  /** The newest, which the row tells. */
  latest: InboxItem;
  read: boolean;
}

export interface Inbox {
  groups: InboxGroup[];
  /** Rows with something unread. */
  unread: number;
  loaded: boolean;
  setRead: (items: InboxItem[], read: boolean) => void;
  setArchived: (items: InboxItem[], archived: boolean) => void;
}

/** Where notifications point: the boards and projects the user is in. */
export interface InboxScope {
  boards: Board[];
  projects: Project[];
  /** Every project's pages, keyed by project address. */
  docs: Map<string, DocsContent>;
  /** Every project's tables, keyed by project address. */
  tables: Map<string, CrmTable[]>;
  /** Whether they have all loaded. */
  loaded: boolean;
}

/** The time, in seconds, a minute at a time. */
function useClock(): number {
  const [now, setNow] = useState(unixNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(unixNow()), CLOCK);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function versionKey(kind: number, id: string): string {
  return `${kind}:${id}`;
}

/** Filters for every version of the cards, files and records notifications point at. */
function versionFilters(notifications: Notification[]): Filter[] {
  const ids = (type: Notification["type"]) => [
    ...new Set(
      notifications.flatMap((notification) => {
        if (notification.type !== type) {
          return [];
        }
        if (notification.type === "card") {
          return [notification.cardId];
        }
        if (notification.type === "file") {
          return [notification.fileId];
        }
        return notification.type === "record" ? [notification.recordId] : [];
      })
    ),
  ];
  return [
    { "#d": ids("card"), kinds: [CARD_KIND] },
    { "#d": ids("file"), kinds: [DRIVE_FILE_KIND] },
    { "#d": ids("record"), kinds: [CRM_RECORD_KIND] },
  ].filter((filter) => filter["#d"].length > 0);
}

/** Each thing's versions by kind and `d` tag, pages from the docs already loaded. */
function useVersions(
  notifications: Notification[],
  docs: Map<string, DocsContent>
): Map<string, NostrEvent[]> {
  const filters = versionFilters(notifications);
  const key = JSON.stringify(filters);
  useObservableValue(() => sync(filters), [key]);
  const events = useObservableValue(
    () => (filters.length > 0 ? eventStore.timeline(filters) : undefined),
    [key]
  );
  const found = new Map<string, NostrEvent[]>();
  for (const event of events ?? []) {
    const id = getTagValue(event, "d");
    if (id) {
      const at = versionKey(event.kind, id);
      found.set(at, [...(found.get(at) ?? []), event]);
    }
  }
  for (const content of docs.values()) {
    for (const [id, versions] of content.versions) {
      found.set(versionKey(DOC_PAGE_KIND, id), versions);
    }
  }
  return found;
}

/** Ids of the comments notifications come from, so deleting one takes its notification. */
function commentIds(notifications: Notification[]): string[] {
  return notifications.flatMap((notification) =>
    notification.type !== "page" && !notification.id.startsWith("due:")
      ? [notification.id]
      : []
  );
}

function group(items: InboxItem[]): InboxGroup[] {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) {
    const subject = notificationSubject(item.notification);
    groups.set(subject, [...(groups.get(subject) ?? []), item]);
  }
  return [...groups].flatMap(([subject, grouped]) => {
    const [latest] = grouped;
    return latest
      ? [
          {
            items: grouped,
            latest,
            read: grouped.every((item) => item.read),
            subject,
          },
        ]
      : [];
  });
}

const ids = (items: InboxItem[]) => items.map((item) => item.notification.id);

/** Notifications for the user on boards and projects they're in, newest first. */
export function useInbox(pubkey: string, scope: InboxScope): Inbox {
  const filters = notificationFilters(pubkey);
  const loaded = useObservableValue(() => sync(filters), [pubkey]);
  const events = useObservableValue(
    () => eventStore.timeline(filters),
    [pubkey]
  );
  const marks = useObservableValue(() => inboxStore(pubkey).marks$, [pubkey]);
  const unsubscribed = useSubscriptions(pubkey).off;
  const now = useClock();
  // Reminders wait for their time; news about cards unsubscribed from stops.
  const notifications = deriveNotifications(events ?? [], pubkey).filter(
    (notification) =>
      hasArrived(notification, now) &&
      (notification.direct ||
        notification.type !== "card" ||
        !unsubscribed.has(cardSubject({ id: notification.cardId })))
  );

  const comments = commentIds(notifications).join(",");
  useObservableValue(
    () =>
      comments
        ? sync([{ "#e": comments.split(","), kinds: [DELETE_KIND] }])
        : undefined,
    [comments]
  );

  const versions = useVersions(notifications, scope.docs);
  const known: NotificationScope = {
    boards: scope.boards,
    projects: scope.projects,
    tables: (project) => scope.tables.get(project.address) ?? [],
    versions: (kind, id) => versions.get(versionKey(kind, id)) ?? [],
  };
  const items = notifications.flatMap((notification): InboxItem[] => {
    if (marks && isArchived(marks, notification.id)) {
      return [];
    }
    const target = locateNotification(notification, pubkey, known);
    return target
      ? [{ ...target, read: marks ? isRead(marks, notification.id) : false }]
      : [];
  });
  const groups = group(items);
  const store = inboxStore(pubkey);

  return {
    groups,
    loaded: (loaded ?? false) && scope.loaded,
    setArchived: (changed, archived) =>
      store.setArchived(ids(changed), archived),
    setRead: (changed, read) => store.setRead(ids(changed), read),
    unread: groups.filter((item) => !item.read).length,
  };
}
