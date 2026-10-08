import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { DocPage, DocsContent } from "@/lib/docs";
import { inboxStore } from "@/lib/inbox";
import type { Board, Card } from "@/lib/model";
import { CARD_KIND, DELETE_KIND, resolveCard } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type {
  CommentNotification,
  PageNotification,
} from "@/lib/notifications";
import {
  deriveNotifications,
  notificationFilters,
  pageNotification,
} from "@/lib/notifications";
import type { Project } from "@/lib/project";
import { sync } from "@/lib/relays";

export type InboxItem = (
  | { notification: CommentNotification; board: Board; card: Card }
  | { notification: PageNotification; project: Project; page: DocPage }
) & { read: boolean };

export interface Inbox {
  items: InboxItem[];
  unread: number;
  loaded: boolean;
  setRead: (items: InboxItem[], read: boolean) => void;
  archive: (items: InboxItem[]) => void;
}

/** Where notifications point: the boards and projects the user is in. */
export interface InboxScope {
  boards: Board[];
  projects: Project[];
  /** Every project's pages, keyed by project address. */
  docs: Map<string, DocsContent>;
  /** Whether they have all loaded. */
  loaded: boolean;
}

function byCard(events: NostrEvent[]): Map<string, NostrEvent[]> {
  const cards = new Map<string, NostrEvent[]>();
  for (const event of events) {
    const id = getTagValue(event, "d");
    if (id) {
      cards.set(id, [...(cards.get(id) ?? []), event]);
    }
  }
  return cards;
}

/** The card a notification points at, on a board its author belongs to. */
function locateCard(
  notification: CommentNotification,
  boards: Board[],
  versions: NostrEvent[]
): { board: Board; card: Card } | undefined {
  for (const board of boards) {
    if (board.members.includes(notification.actor)) {
      const card = resolveCard(board, versions, notification.cardId);
      if (card) {
        return { board, card };
      }
    }
  }
  return undefined;
}

/**
 * The page a notification points at, if its newest version still mentions
 * the recipient as the notification says, by a member of its project. The
 * notification is read again from that version, with the words as they are now.
 */
function locatePage(
  notification: PageNotification,
  recipient: string,
  { projects, docs }: InboxScope
):
  | { notification: PageNotification; project: Project; page: DocPage }
  | undefined {
  const project = projects.find(
    (item) => item.address === notification.project
  );
  const page = docs.get(notification.project)?.byId.get(notification.pageId);
  const current = page && pageNotification(page.event, recipient);
  return project?.members.includes(notification.actor) &&
    page &&
    current?.id === notification.id
    ? { notification: current, page, project }
    : undefined;
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
  const notifications = deriveNotifications(events ?? [], pubkey);
  const comments = notifications.filter(
    (item): item is CommentNotification => item.type === "comment"
  );

  // Deleted comments drop out of the store, and with them their notification.
  const commentKey = comments.map((item) => item.id).join(",");
  useObservableValue(
    () =>
      commentKey
        ? sync([{ "#e": commentKey.split(","), kinds: [DELETE_KIND] }])
        : undefined,
    [commentKey]
  );

  const cardKey = [...new Set(comments.map((item) => item.cardId))].join(",");
  const cardFilters = [{ "#d": cardKey.split(","), kinds: [CARD_KIND] }];
  useObservableValue(
    () => (cardKey ? sync(cardFilters) : undefined),
    [cardKey]
  );
  const cardEvents = useObservableValue(
    () => (cardKey ? eventStore.timeline(cardFilters) : undefined),
    [cardKey]
  );

  const versions = byCard(cardEvents ?? []);
  const items = notifications.flatMap((notification): InboxItem[] => {
    if (marks?.archived.has(notification.id)) {
      return [];
    }
    const read = marks?.read.has(notification.id) ?? false;
    if (notification.type === "page") {
      const found = locatePage(notification, pubkey, scope);
      return found ? [{ ...found, read }] : [];
    }
    const found = locateCard(
      notification,
      scope.boards,
      versions.get(notification.cardId) ?? []
    );
    return found ? [{ ...found, notification, read }] : [];
  });
  const store = inboxStore(pubkey);

  return {
    archive: (archived) => store.archive(ids(archived)),
    items,
    loaded: (loaded ?? false) && scope.loaded,
    setRead: (changed, read) => store.setRead(ids(changed), read),
    unread: items.filter((item) => !item.read).length,
  };
}
