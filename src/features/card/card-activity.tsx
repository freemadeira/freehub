import { cn } from "cn";
import { format, parseISO } from "date-fns";
import type { LucideIcon } from "lucide-react";
import {
  AtSignIcon,
  CalendarIcon,
  PencilIcon,
  PlusIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, useId } from "react";

import { Timeline, TimelineMarker, TimelineTime } from "@/components/timeline";
import { UserAvatar } from "@/components/user-avatar";
import { useBoard } from "@/features/board/board-context";
import { PRIORITY_STYLES, STATUS_STYLES } from "@/features/card/card-fields";
import { CommentEntry, Composer } from "@/features/card/comments";
import { useReadSubject } from "@/features/inbox/inbox-context";
import { useCardThread } from "@/hooks/use-comments";
import { useProfile } from "@/hooks/use-profile";
import type { CardActivity, CardChange, ChangeOf } from "@/lib/card-activity";
import { foldChanges } from "@/lib/card-activity";
import type { Card, Comment } from "@/lib/model";
import { priorityLabel, statusLabel } from "@/lib/model";
import { cardSubject } from "@/lib/subscriptions";

/** Someone's changes this close together are told as one entry. */
const BURST_SECONDS = 5 * 60;

/** Someone's run of changes, perhaps starting with making the card. */
interface Burst {
  kind: "burst";
  author: string;
  /** When the last of them was made. */
  at: number;
  created: boolean;
  activity: CardActivity[];
}

type Entry = Burst | { kind: "comment"; at: number; comment: Comment };

/** What a change says happened, after the name of who made it. */
interface Told {
  marker: ReactNode;
  text: ReactNode;
}

function Value({ children }: { children: ReactNode }) {
  return <span className="text-foreground font-medium">{children}</span>;
}

function Name({ pubkey }: { pubkey: string }) {
  const { name } = useProfile(pubkey);
  return <Value>{name}</Value>;
}

/** "A", "A and B", or "A, B and C". */
function joined(items: ReactNode[]): ReactNode {
  // The items never reorder, so their index is a stable key.
  return items.map((item, index) => (
    // oxlint-disable-next-line react/no-array-index-key
    <Fragment key={index}>
      {index > 0 && (index === items.length - 1 ? " and " : ", ")}
      {item}
    </Fragment>
  ));
}

function day(due: string): string {
  return format(parseISO(due), "MMM d, yyyy");
}

function MarkerIcon({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <Icon
      aria-hidden
      className={cn("text-muted-foreground size-4", className)}
    />
  );
}

function statusChange({ from, to }: ChangeOf<"status">): Told {
  return {
    marker: <MarkerIcon {...STATUS_STYLES[to]} />,
    text: from ? (
      <>
        moved it from <Value>{statusLabel(from)}</Value> to{" "}
        <Value>{statusLabel(to)}</Value>
      </>
    ) : (
      <>
        moved it to <Value>{statusLabel(to)}</Value>
      </>
    ),
  };
}

function assigneesChange(
  { added, removed }: ChangeOf<"assignees">,
  author: string
): Told {
  const person = (pubkey: string) =>
    pubkey === author ? "themselves" : <Name key={pubkey} pubkey={pubkey} />;
  const parts = [
    added.length > 0 && <>assigned {joined(added.map(person))}</>,
    removed.length > 0 && <>unassigned {joined(removed.map(person))}</>,
  ].filter(Boolean);
  return {
    marker: (
      <MarkerIcon icon={added.length > 0 ? UserPlusIcon : UserMinusIcon} />
    ),
    text: joined(parts),
  };
}

function priorityChange({ from, to }: ChangeOf<"priority">): Told {
  const shown = to ?? from;
  const marker = shown && <MarkerIcon icon={PRIORITY_STYLES[shown].icon} />;
  if (!to) {
    return { marker, text: "removed the priority" };
  }
  return {
    marker,
    text: from ? (
      <>
        changed the priority from <Value>{priorityLabel(from)}</Value> to{" "}
        <Value>{priorityLabel(to)}</Value>
      </>
    ) : (
      <>
        set the priority to <Value>{priorityLabel(to)}</Value>
      </>
    ),
  };
}

function dueChange({ from, to }: ChangeOf<"due">): Told {
  const marker = <MarkerIcon icon={CalendarIcon} />;
  if (!to) {
    return { marker, text: "removed the due date" };
  }
  return {
    marker,
    text: from ? (
      <>
        changed the due date from <Value>{day(from)}</Value> to{" "}
        <Value>{day(to)}</Value>
      </>
    ) : (
      <>
        set the due date to <Value>{day(to)}</Value>
      </>
    ),
  };
}

function describe(change: CardChange, author: string): Told {
  switch (change.field) {
    case "status": {
      return statusChange(change);
    }
    case "assignees": {
      return assigneesChange(change, author);
    }
    case "priority": {
      return priorityChange(change);
    }
    case "due": {
      return dueChange(change);
    }
    default: {
      return {
        marker: <MarkerIcon icon={PencilIcon} />,
        text: (
          <>
            changed the title to <Value>{change.to}</Value>
          </>
        ),
      };
    }
  }
}

function mentioned(people: string[]): Told {
  return {
    marker: <MarkerIcon icon={AtSignIcon} />,
    text: (
      <>
        mentioned{" "}
        {joined(people.map((pubkey) => <Name key={pubkey} pubkey={pubkey} />))}{" "}
        in the description
      </>
    ),
  };
}

/** What a run of activity came to, each field told once. */
function tell(activity: CardActivity[], author: string): Told[] {
  const people = [...new Set(activity.flatMap((item) => item.mentioned))];
  return [
    ...foldChanges(activity.flatMap((item) => item.changes)).map((change) =>
      describe(change, author)
    ),
    ...(people.length > 0 ? [mentioned(people)] : []),
  ];
}

/** A lone change shows its own marker, the card's making a plus; a run of them, who made it. */
function burstMarker(
  author: string,
  created: boolean,
  told: Told[]
): ReactNode {
  const [only] = told;
  if (created && !only) {
    return <MarkerIcon icon={PlusIcon} />;
  }
  if (!created && only && told.length === 1) {
    return only.marker;
  }
  return <UserAvatar aria-hidden pubkey={author} size="xs" />;
}

function BurstEntry({ author, at, created, activity }: Burst) {
  const told = tell(activity, author);
  // Changes undone in the same run come to nothing.
  if (!created && told.length === 0) {
    return null;
  }
  return (
    <li className="flex items-start gap-3">
      <TimelineMarker>{burstMarker(author, created, told)}</TimelineMarker>
      <p className="text-muted-foreground min-w-0 flex-1 py-0.5 text-sm wrap-break-word">
        <Name pubkey={author} />{" "}
        {joined([
          ...(created ? ["created the card"] : []),
          ...told.map(({ text }) => text),
        ])}
      </p>
      <TimelineTime at={at} className="py-1" />
    </li>
  );
}

/**
 * The card's making, changes and comments, oldest first. Someone's run of
 * changes is one entry.
 */
function entriesOf(
  card: Card,
  activity: CardActivity[],
  comments: Comment[]
): Entry[] {
  const moments: Entry[] = [
    ...(card.creator && card.createdAt !== undefined
      ? [
          {
            activity: [],
            at: card.createdAt,
            author: card.creator,
            created: true,
            kind: "burst",
          } satisfies Burst,
        ]
      : []),
    ...activity.map((item): Entry => ({
      activity: [item],
      at: item.createdAt,
      author: item.author,
      created: false,
      kind: "burst",
    })),
    ...comments.map((comment): Entry => ({
      at: comment.createdAt,
      comment,
      kind: "comment",
    })),
  ];
  const entries: Entry[] = [];
  for (const moment of moments.toSorted((a, b) => a.at - b.at)) {
    const last = entries.at(-1);
    if (
      moment.kind === "burst" &&
      last?.kind === "burst" &&
      last.author === moment.author &&
      moment.at - last.at <= BURST_SECONDS
    ) {
      last.at = moment.at;
      last.activity.push(...moment.activity);
    } else {
      entries.push(moment.kind === "burst" ? { ...moment } : moment);
    }
  }
  return entries;
}

/** What's happened to the card, with its comments, and where to add one. */
export function CardActivitySection({
  card,
  className,
}: {
  card: Card;
  className?: string;
}) {
  const id = useId();
  const { board, canEdit, pubkey } = useBoard();
  const { activity, comments } = useCardThread(board, card);
  useReadSubject(cardSubject(card));
  const entries = entriesOf(card, activity, comments);

  if (!canEdit && entries.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby={id}
      className={cn("flex flex-col gap-4", className)}
    >
      <h2 className="font-medium" id={id}>
        Activity
      </h2>
      {entries.length > 0 && (
        <Timeline>
          {entries.map((entry) =>
            entry.kind === "burst" ? (
              <BurstEntry
                {...entry}
                key={
                  entry.created
                    ? "created"
                    : (entry.activity[0]?.id ?? entry.at)
                }
              />
            ) : (
              <CommentEntry
                comment={entry.comment}
                key={entry.comment.id}
                own={entry.comment.author === pubkey}
              />
            )
          )}
        </Timeline>
      )}
      {canEdit && <Composer card={card} />}
    </section>
  );
}
