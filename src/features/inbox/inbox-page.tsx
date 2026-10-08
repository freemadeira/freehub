import { cn } from "cn";
import { format } from "date-fns";
import {
  ArchiveIcon,
  AtSignIcon,
  CheckCheckIcon,
  InboxIcon,
  MailIcon,
  MailOpenIcon,
} from "lucide-react";
import { Link } from "wouter";

import { IconButton } from "@/components/icon-button";
import { MentionText } from "@/components/mention-text";
import { TopBar } from "@/components/top-bar";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { cardPath, OPENED_FROM_BOARD } from "@/features/board/board-context";
import { pagePath, REVEAL_MENTION } from "@/features/docs/docs-context";
import { PageIcon } from "@/features/docs/page-icon";
import type { Inbox, InboxItem } from "@/hooks/use-inbox";
import { useProfile } from "@/hooks/use-profile";
import { pageTitle } from "@/lib/docs";
import { cardKey } from "@/lib/model";

/** Shares the top-level path with board codes, so INBOX is a reserved code. */
export const INBOX_PATH = "/inbox";

/** "now", "5m", "3h", "2d", then the date. */
function shortAgo(seconds: number): string {
  const minutes = Math.floor((Date.now() / 1000 - seconds) / 60);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : format(new Date(seconds * 1000), "MMM d");
}

/** Where the item leads. */
function linkTo(item: InboxItem): { href: string; state: object } {
  if ("page" in item) {
    return { href: pagePath(item.project, item.page), state: REVEAL_MENTION };
  }
  const { board, card } = item;
  return {
    // The inbox knows neither the board's other cards nor other boards with
    // its code, so it never relies on the number or the code alone.
    href: cardPath(board, card, {
      query: new URLSearchParams({ board: board.id }),
      withId: true,
    }),
    state: OPENED_FROM_BOARD,
  };
}

function Row({ item, inbox }: { item: InboxItem; inbox: Inbox }) {
  const { notification, read } = item;
  const { name } = useProfile(notification.actor);
  const date = new Date(notification.createdAt * 1000);
  const { href, state } = linkTo(item);
  return (
    <li className="group/row relative">
      <Link
        className={cn(
          "hover:bg-foreground/5 focus-visible:ring-ring/50 flex items-center gap-3 rounded-xl py-2.5 pr-3 pl-2 transition-colors duration-150 outline-none focus-visible:ring-3",
          read && "text-muted-foreground"
        )}
        href={href}
        onClick={() => inbox.setRead([item], true)}
        state={state}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full transition-colors duration-150",
            read ? "bg-transparent" : "bg-primary"
          )}
        />
        <span className="relative shrink-0">
          <UserAvatar aria-hidden pubkey={notification.actor} />
          <span className="bg-popover ring-background text-foreground absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full ring-2">
            <AtSignIcon aria-hidden className="size-2.5" />
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            {"page" in item ? (
              <PageIcon
                className="text-muted-foreground self-center"
                page={item.page}
              />
            ) : (
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {cardKey(item.board, item.card)}
              </span>
            )}
            <span
              className={cn("truncate", !read && "text-foreground font-medium")}
            >
              {"page" in item
                ? pageTitle(item.page)
                : item.card.title || "Untitled"}
            </span>
          </span>
          <span className="text-muted-foreground truncate text-sm">
            {name} mentioned you: <MentionText content={notification.content} />
          </span>
        </span>
        {!read && <span className="sr-only">Unread</span>}
        <time
          className="text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums group-focus-within/row:invisible group-hover/row:invisible pointer-coarse:invisible"
          dateTime={date.toISOString()}
          title={format(date, "PPpp")}
        >
          {shortAgo(notification.createdAt)}
        </time>
      </Link>
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center opacity-0 transition-opacity duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100">
        <FluidTooltip.Group>
          <IconButton
            label={read ? "Mark as unread" : "Mark as read"}
            onClick={() => inbox.setRead([item], !read)}
          >
            {read ? <MailIcon /> : <MailOpenIcon />}
          </IconButton>
          <IconButton label="Archive" onClick={() => inbox.archive([item])}>
            <ArchiveIcon />
          </IconButton>
        </FluidTooltip.Group>
      </div>
    </li>
  );
}

function InboxList({ inbox }: { inbox: Inbox }) {
  if (inbox.items.length > 0) {
    return (
      <ol aria-label="Notifications" className="flex flex-col gap-0.5">
        {inbox.items.map((item) => (
          <Row inbox={inbox} item={item} key={item.notification.id} />
        ))}
      </ol>
    );
  }
  if (!inbox.loaded) {
    return (
      <div aria-busy className="flex flex-col gap-2">
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
      </div>
    );
  }
  return (
    <Empty>
      <InboxIcon aria-hidden className="text-muted-foreground size-8" />
      <EmptyTitle>You’re all caught up</EmptyTitle>
      <EmptyDescription>
        When someone mentions you, it shows up here.
      </EmptyDescription>
    </Empty>
  );
}

export function InboxPage({ inbox }: { inbox: Inbox }) {
  const unread = inbox.items.filter((item) => !item.read);
  return (
    <>
      <TopBar
        crumbs={[
          {
            icon: (
              <InboxIcon className="text-muted-foreground size-4 shrink-0" />
            ),
            label: "Inbox",
          },
        ]}
      >
        {unread.length > 0 && (
          <IconButton
            label="Mark all as read"
            onClick={() => inbox.setRead(unread, true)}
          >
            <CheckCheckIcon />
          </IconButton>
        )}
      </TopBar>
      <main className="flex grow flex-col px-4 pt-2 pb-8 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl grow flex-col">
          <InboxList inbox={inbox} />
        </div>
      </main>
    </>
  );
}
