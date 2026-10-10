import { cn } from "cn";
import { format } from "date-fns";
import type { LucideIcon } from "lucide-react";
import {
  ArchiveIcon,
  AtSignIcon,
  BellOffIcon,
  CalendarClockIcon,
  CalendarIcon,
  CheckCheckIcon,
  InboxIcon,
  MailIcon,
  MailOpenIcon,
  MessageSquareIcon,
  PencilIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

import { IconButton } from "@/components/icon-button";
import { MentionText } from "@/components/mention-text";
import { TopBar } from "@/components/top-bar";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { OPENED_FROM_BOARD } from "@/features/board/board-context";
import { PRIORITY_STYLES, STATUS_STYLES } from "@/features/card/card-fields";
import { TableIcon } from "@/features/crm/table-icon";
import { REVEAL_MENTION } from "@/features/docs/docs-context";
import { PageIcon } from "@/features/docs/page-icon";
import { FileIcon } from "@/features/drive/file-icon";
import { notificationPath } from "@/features/inbox/notification-path";
import {
  notificationQuote,
  notificationTitle,
  notificationWords,
} from "@/features/inbox/notification-text";
import { NotificationsButton } from "@/features/inbox/notifications-button";
import type { Inbox, InboxGroup, InboxItem } from "@/hooks/use-inbox";
import { useProfileNames } from "@/hooks/use-profile-names";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import { pageTitle } from "@/lib/docs";
import { cardKey } from "@/lib/model";
import { setSubscribed } from "@/lib/subscribe";
import { isSubscribed } from "@/lib/subscriptions";
import { shortNpub } from "@/lib/utils";

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

/** History state that lets the place it leads to open as it should. */
function linkState(item: InboxItem): object {
  if ("page" in item) {
    return REVEAL_MENTION;
  }
  return "card" in item ? OPENED_FROM_BOARD : {};
}

/** The icon on the avatar's corner: what kind of news it is. */
function newsIcon(
  item: InboxItem,
  pubkey: string
): { icon: LucideIcon; className?: string } {
  const { notification } = item;
  if (notification.type === "record") {
    return {
      icon: notification.reason === "assigned" ? UserPlusIcon : AtSignIcon,
    };
  }
  if (notification.type !== "card") {
    return { icon: AtSignIcon };
  }
  switch (notification.reason) {
    case "comment": {
      return { icon: MessageSquareIcon };
    }
    case "due": {
      return { icon: CalendarClockIcon };
    }
    case "change": {
      break;
    }
    default: {
      return { icon: AtSignIcon };
    }
  }
  const [first] = notification.changes;
  const mine = notification.changes.find(
    (change) =>
      change.field === "assignees" &&
      (change.added.includes(pubkey) || change.removed.includes(pubkey))
  );
  if (mine?.field === "assignees") {
    return {
      icon: mine.added.includes(pubkey) ? UserPlusIcon : UserMinusIcon,
    };
  }
  switch (first?.field) {
    case "status": {
      return STATUS_STYLES[first.to];
    }
    case "priority": {
      return first.to ? PRIORITY_STYLES[first.to] : { icon: PencilIcon };
    }
    case "due": {
      return { icon: CalendarIcon };
    }
    case "assignees": {
      return { icon: UserPlusIcon };
    }
    default: {
      return { icon: PencilIcon };
    }
  }
}

/** Who did it, with what kind of news it is on the corner; a reminder shows its own icon. */
function Who({ item, pubkey }: { item: InboxItem; pubkey: string }) {
  const { actor } = item.notification;
  const { icon: Icon, className } = newsIcon(item, pubkey);
  if (!actor) {
    return (
      <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
        <Icon aria-hidden className="size-4" />
      </span>
    );
  }
  return (
    <span className="relative shrink-0">
      <UserAvatar aria-hidden pubkey={actor} />
      <span className="bg-popover ring-background text-foreground absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full ring-2">
        <Icon aria-hidden className={cn("size-2.5", className)} />
      </span>
    </span>
  );
}

/** What it's about: the card by its key and title, or the page, file or record by its icon and name. */
function Subject({ item, read }: { item: InboxItem; read: boolean }) {
  const title = cn("truncate", !read && "text-foreground font-medium");
  if ("file" in item) {
    return (
      <>
        <FileIcon className="self-center" file={item.file} size="sm" />
        <span className={title}>{item.file.name}</span>
      </>
    );
  }
  if ("page" in item) {
    return (
      <>
        <PageIcon
          className="text-muted-foreground self-center"
          page={item.page}
        />
        <span className={title}>{pageTitle(item.page)}</span>
      </>
    );
  }
  if ("record" in item) {
    return (
      <>
        <TableIcon
          className="text-muted-foreground size-3.5 shrink-0 self-center"
          icon={item.table.icon}
        />
        <span className={title}>{notificationTitle(item)}</span>
      </>
    );
  }
  return (
    <>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {cardKey(item.board, item.card)}
      </span>
      <span className={title}>{item.card.title || "Untitled"}</span>
    </>
  );
}

/** People the item names: who did it, and anyone else a change was about. */
function peopleIn({ notification }: InboxItem): string[] {
  const changed =
    notification.type === "card" && notification.reason === "change"
      ? notification.changes.flatMap((change) =>
          change.field === "assignees"
            ? [...change.added, ...change.removed]
            : []
        )
      : [];
  return [
    ...new Set([
      ...(notification.actor ? [notification.actor] : []),
      ...changed,
    ]),
  ];
}

/** "Ana moved it to Done", "Ana mentioned you: …", or "Due tomorrow". */
function Said({ item, pubkey }: { item: InboxItem; pubkey: string }) {
  const people = peopleIn(item);
  const names = useProfileNames(people);
  const name = (person: string) => names.get(person) ?? shortNpub(person);
  const { actor } = item.notification;
  const words = notificationWords(item, pubkey, name);
  const quote = notificationQuote(item, pubkey);
  return (
    <span className="text-muted-foreground truncate text-sm">
      {actor ? `${name(actor)} ${words}` : words}
      {quote && (
        <>
          : <MentionText content={quote} />
        </>
      )}
    </span>
  );
}

/** Rows about cards the user subscribes to, rather than about the user. */
function subscribedNews(group: InboxGroup): InboxItem | undefined {
  return group.items.find(
    (item) => "card" in item && !item.notification.direct
  );
}

function Row({
  group,
  inbox,
  pubkey,
}: {
  group: InboxGroup;
  inbox: Inbox;
  pubkey: string;
}) {
  const { latest, items, read } = group;
  const date = new Date(latest.notification.createdAt * 1000);
  const subscriptions = useSubscriptions(pubkey);
  const following = subscribedNews(group);
  const card = following && "card" in following ? following.card : undefined;
  const canUnsubscribe = card && isSubscribed(card, pubkey, subscriptions);

  const archive = () => {
    inbox.setArchived(items, true);
    toast("Archived", {
      action: { label: "Undo", onClick: () => inbox.setArchived(items, false) },
    });
  };

  const unsubscribe = async () => {
    if (!card) {
      return;
    }
    inbox.setArchived(items, true);
    if (await setSubscribed(card, pubkey, false)) {
      toast(`Unsubscribed from ${notificationTitle(latest)}`, {
        action: {
          label: "Undo",
          onClick: () => {
            setSubscribed(card, pubkey, true);
            inbox.setArchived(items, false);
          },
        },
      });
    }
  };

  return (
    <li className="group/row relative">
      <Link
        className={cn(
          "hover:bg-foreground/5 focus-visible:ring-ring/50 flex items-center gap-3 rounded-xl py-2.5 pr-3 pl-2 transition-colors duration-150 outline-none focus-visible:ring-3",
          read && "text-muted-foreground"
        )}
        href={notificationPath(latest)}
        onClick={() => inbox.setRead(items, true)}
        state={linkState(latest)}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full transition-colors duration-150",
            read ? "bg-transparent" : "bg-primary"
          )}
        />
        <Who item={latest} pubkey={pubkey} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <Subject item={latest} read={read} />
          </span>
          <Said item={latest} pubkey={pubkey} />
        </span>
        {!read && <span className="sr-only">Unread</span>}
        <time
          className="text-muted-foreground w-24 shrink-0 text-right text-xs tabular-nums group-focus-within/row:invisible group-hover/row:invisible pointer-coarse:invisible"
          dateTime={date.toISOString()}
          title={format(date, "PPpp")}
        >
          {shortAgo(latest.notification.createdAt)}
        </time>
      </Link>
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center opacity-0 transition-opacity duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100">
        <FluidTooltip.Group>
          <IconButton
            label={read ? "Mark as unread" : "Mark as read"}
            onClick={() => inbox.setRead(items, !read)}
          >
            {read ? <MailIcon /> : <MailOpenIcon />}
          </IconButton>
          {canUnsubscribe && (
            <IconButton label="Unsubscribe" onClick={unsubscribe}>
              <BellOffIcon />
            </IconButton>
          )}
          <IconButton label="Archive" onClick={archive}>
            <ArchiveIcon />
          </IconButton>
        </FluidTooltip.Group>
      </div>
    </li>
  );
}

function InboxList({ inbox, pubkey }: { inbox: Inbox; pubkey: string }) {
  if (inbox.groups.length > 0) {
    return (
      <ol aria-label="Notifications" className="flex flex-col gap-0.5">
        {inbox.groups.map((group) => (
          <Row
            group={group}
            inbox={inbox}
            key={group.subject}
            pubkey={pubkey}
          />
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
        Mentions, assignments and news about what you subscribe to show up here.
      </EmptyDescription>
    </Empty>
  );
}

export function InboxPage({ inbox, pubkey }: { inbox: Inbox; pubkey: string }) {
  const unread = inbox.groups
    .filter((group) => !group.read)
    .flatMap((group) => group.items);
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
        <FluidTooltip.Group>
          <NotificationsButton pubkey={pubkey} />
          {unread.length > 0 && (
            <IconButton
              label="Mark all as read"
              onClick={() => inbox.setRead(unread, true)}
            >
              <CheckCheckIcon />
            </IconButton>
          )}
        </FluidTooltip.Group>
      </TopBar>
      <main className="flex grow flex-col px-4 pt-2 pb-8 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl grow flex-col">
          <InboxList inbox={inbox} pubkey={pubkey} />
        </div>
      </main>
    </>
  );
}
