import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import { useObservableValue } from "@/hooks/use-observable-value";
import { inboxStore } from "@/lib/inbox";
import type { Board, Card } from "@/lib/model";
import { CARD_KIND, DELETE_KIND, resolveCard } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Notification } from "@/lib/notifications";
import { deriveNotifications, notificationFilters } from "@/lib/notifications";
import { sync } from "@/lib/relays";

export interface InboxItem {
  notification: Notification;
  board: Board;
  card: Card;
  read: boolean;
}

export interface Inbox {
  items: InboxItem[];
  unread: number;
  loaded: boolean;
  setRead: (items: InboxItem[], read: boolean) => void;
  archive: (items: InboxItem[]) => void;
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
function locate(
  notification: Notification,
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

const ids = (items: InboxItem[]) => items.map((item) => item.notification.id);

/** Notifications for the user on boards they belong to, newest first. */
export function useInbox(pubkey: string, boards: Board[]): Inbox {
  const filters = notificationFilters(pubkey);
  const loaded = useObservableValue(() => sync(filters), [pubkey]);
  const events = useObservableValue(
    () => eventStore.timeline(filters),
    [pubkey]
  );
  const marks = useObservableValue(() => inboxStore(pubkey).marks$, [pubkey]);
  const notifications = deriveNotifications(events ?? [], pubkey);

  // Deleted comments drop out of the store, and with them their notification.
  const commentKey = notifications.map((item) => item.id).join(",");
  useObservableValue(
    () =>
      commentKey
        ? sync([{ "#e": commentKey.split(","), kinds: [DELETE_KIND] }])
        : undefined,
    [commentKey]
  );

  const cardKey = [...new Set(notifications.map((item) => item.cardId))].join(
    ","
  );
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
    const found = locate(
      notification,
      boards,
      versions.get(notification.cardId) ?? []
    );
    return found
      ? [
          {
            ...found,
            notification,
            read: marks?.read.has(notification.id) ?? false,
          },
        ]
      : [];
  });
  const store = inboxStore(pubkey);

  return {
    archive: (archived) => store.archive(ids(archived)),
    items,
    loaded: loaded ?? false,
    setRead: (changed, read) => store.setRead(ids(changed), read),
    unread: items.filter((item) => !item.read).length,
  };
}
