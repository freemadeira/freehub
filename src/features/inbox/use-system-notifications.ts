import { getDisplayName } from "applesauce-core/helpers/profile";
import { useEffect, useEffectEvent, useRef } from "react";

import { notificationPath } from "@/features/inbox/notification-path";
import { notificationMessage } from "@/features/inbox/notification-text";
import type { Inbox } from "@/hooks/use-inbox";
import { eventStore } from "@/lib/nostr";
import { notificationSubject } from "@/lib/notifications";
import { pushesHere, showNotification, useNotifyState } from "@/lib/notify";
import { shortNpub } from "@/lib/utils";

/** At most this many show at once, when a lot arrives together. */
const MAX_AT_ONCE = 3;

function nameOf(pubkey: string): string {
  return (
    getDisplayName(eventStore.getReplaceable(0, pubkey)) ?? shortNpub(pubkey)
  );
}

/** Keeps the installed app's icon showing how many rows are unread. */
export function useAppBadge(unread: number): void {
  useEffect(() => {
    if (!("setAppBadge" in navigator)) {
      return;
    }
    const update = async () => {
      try {
        await (unread > 0
          ? navigator.setAppBadge(unread)
          : navigator.clearAppBadge());
      } catch {
        // Badges are a nicety; some browsers refuse them outside installed apps.
      }
    };
    update();
  }, [unread]);
}

/**
 * Shows news as system notifications while the app is open but out of sight,
 * on devices the notifier doesn't push to. What was there on opening the app
 * counts as seen.
 */
export function useSystemNotifications(inbox: Inbox, pubkey: string): void {
  const state = useNotifyState(pubkey);
  const seen = useRef<Set<string> | null>(null);
  const items = inbox.groups.flatMap((group) => group.items);
  const { loaded } = inbox;
  const unread = items
    .filter((item) => !item.read)
    .map((item) => item.notification.id)
    .join(",");

  const show = useEffectEvent((ids: string[]) => {
    const known = seen.current;
    seen.current = new Set([...(known ?? []), ...ids]);
    const away = document.visibilityState === "hidden" || !document.hasFocus();
    if (!known || state !== "on" || pushesHere(pubkey) || !away) {
      return;
    }
    const fresh = items.filter(
      (item) =>
        ids.includes(item.notification.id) && !known.has(item.notification.id)
    );
    for (const item of fresh.slice(0, MAX_AT_ONCE)) {
      showNotification({
        ...notificationMessage(item, pubkey, nameOf),
        path: notificationPath(item),
        tag: notificationSubject(item.notification),
      });
    }
  });

  useEffect(() => {
    if (loaded) {
      show(unread ? unread.split(",") : []);
    }
  }, [unread, loaded]);
}
