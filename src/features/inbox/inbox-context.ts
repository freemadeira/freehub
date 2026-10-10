import { createContext, use, useEffect, useEffectEvent } from "react";

import type { Inbox } from "@/hooks/use-inbox";

export const InboxContext = createContext<Inbox | null>(null);

/**
 * Seeing a card, page, file or record counts as reading what the inbox says
 * about it, including news that comes while it's open.
 */
export function useReadSubject(subject: string): void {
  const inbox = use(InboxContext);
  const unread =
    inbox?.groups
      .find((group) => group.subject === subject)
      ?.items.filter((item) => !item.read) ?? [];
  const key = unread.map((item) => item.notification.id).join(",");
  const read = useEffectEvent(() => inbox?.setRead(unread, true));
  useEffect(() => {
    if (key) {
      read();
    }
  }, [key]);
}
