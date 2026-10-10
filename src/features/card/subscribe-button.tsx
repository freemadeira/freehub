import { cn } from "cn";
import { BellIcon } from "lucide-react";

import { IconButton } from "@/components/icon-button";
import { useBoard } from "@/features/board/board-context";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import type { Card } from "@/lib/model";
import { setSubscribed } from "@/lib/subscribe";
import { isSubscribed } from "@/lib/subscriptions";

/**
 * Whether the user hears about the card's changes and comments. Making a
 * card, being assigned it or commenting on it subscribes them; a bell filled
 * in says so.
 */
export function SubscribeButton({ card }: { card: Card }) {
  const { pubkey } = useBoard();
  const subscribed = isSubscribed(card, pubkey, useSubscriptions(pubkey));
  return (
    <IconButton
      aria-pressed={subscribed}
      keepTooltipOnClick
      label={subscribed ? "Unsubscribe" : "Subscribe"}
      onClick={() => setSubscribed(card, pubkey, !subscribed)}
    >
      <BellIcon
        className={cn(
          "transition-[fill,scale] duration-200 ease-out active:scale-90",
          subscribed && "fill-current"
        )}
      />
    </IconButton>
  );
}
