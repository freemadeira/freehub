import { useSortable } from "@dnd-kit/react/sortable";
import { cn } from "cn";
import { format, isBefore, parseISO, startOfToday } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { Link } from "wouter";

import { OPENED_FROM_BOARD, useBoard } from "@/features/board/board-context";
import { CARD_SURFACE } from "@/features/board/card-surface";
import { LABEL_COLORS, PRIORITY_STYLES } from "@/features/card/card-fields";
import { AvatarStack } from "@/features/card/card-parts";
import type { Card, Label, Priority } from "@/lib/model";
import { cardKey, PRIORITIES } from "@/lib/model";

function priorityLabel(priority: Priority): string {
  return PRIORITIES.find(({ id }) => id === priority)?.label ?? priority;
}

function PriorityIcon({ priority }: { priority: Priority }) {
  const { icon: Icon, className } = PRIORITY_STYLES[priority];
  return (
    <>
      <Icon aria-hidden className={cn("size-4 shrink-0", className)} />
      <span className="sr-only">{priorityLabel(priority)} priority</span>
    </>
  );
}

function DueDate({ due, done }: { due: string; done: boolean }) {
  const date = parseISO(due);
  const overdue = !done && isBefore(date, startOfToday());
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs tabular-nums",
        overdue ? "text-destructive" : "text-muted-foreground"
      )}
    >
      <CalendarIcon className="size-3.5" />
      <span className="sr-only">{overdue ? "Overdue" : "Due"}</span>
      <time dateTime={due}>{format(date, "MMM d")}</time>
    </span>
  );
}

function LabelDots({ labels }: { labels: Label[] }) {
  return (
    <span className="flex -space-x-0.5">
      {labels.map((label) => (
        <span
          aria-hidden
          className={cn(
            "ring-card size-2.5 rounded-full bg-current ring-2",
            LABEL_COLORS[label]
          )}
          key={label}
        />
      ))}
      <span className="sr-only">Labels: {labels.join(", ")}</span>
    </span>
  );
}

function CardMeta({ card }: { card: Card }) {
  return (
    <>
      {card.priority && <PriorityIcon priority={card.priority} />}
      {card.due && <DueDate done={card.status === "done"} due={card.due} />}
      {card.labels.length > 0 && <LabelDots labels={card.labels} />}
      {card.assignees.length > 0 && (
        <AvatarStack className="ml-auto" pubkeys={card.assignees} />
      )}
    </>
  );
}

function CardTitle({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  return (
    <span className={cn(!title && "text-muted-foreground", className)}>
      {title || "Untitled"}
    </span>
  );
}

interface SortableCardProps {
  card: Card;
  index: number;
  group: string;
}

function useSortableCard({ card, index, group }: SortableCardProps) {
  const { canEdit } = useBoard();
  return useSortable({
    accept: "card",
    disabled: !canEdit,
    group,
    id: card.id,
    index,
    type: "card",
  }).ref;
}

function CardLink({
  card,
  className,
  children,
  ref,
}: {
  card: Card;
  className: string;
  children: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
}) {
  const { cardHref } = useBoard();
  return (
    <Link
      className={cn(CARD_SURFACE, "select-none", className)}
      draggable={false}
      href={cardHref(card)}
      ref={ref}
      // dnd-kit turns draggables without a role into buttons; these navigate.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="link"
      state={OPENED_FROM_BOARD}
    >
      {children}
    </Link>
  );
}

export function CardTile(props: SortableCardProps) {
  const { card } = props;
  const { board } = useBoard();
  const ref = useSortableCard(props);
  return (
    <CardLink card={card} className="flex flex-col gap-2.5 p-3" ref={ref}>
      <CardTitle
        className="line-clamp-3 text-sm leading-snug"
        title={card.title}
      />
      <span className="flex min-h-5 items-center gap-2">
        <span className="text-muted-foreground text-xs tabular-nums">
          {cardKey(board, card)}
        </span>
        <CardMeta card={card} />
      </span>
    </CardLink>
  );
}

export function CardRow({
  card,
  ref,
}: {
  card: Card;
  ref?: Ref<HTMLAnchorElement>;
}) {
  const { board } = useBoard();
  return (
    <CardLink
      card={card}
      className="flex h-11 items-center gap-3 px-3 text-sm"
      ref={ref}
    >
      <span className="text-muted-foreground min-w-14 shrink-0 text-xs tabular-nums">
        {cardKey(board, card)}
      </span>
      <CardTitle className="min-w-0 flex-1 truncate" title={card.title} />
      <span className="flex shrink-0 items-center gap-2">
        <CardMeta card={card} />
      </span>
    </CardLink>
  );
}

export function SortableCardRow(props: SortableCardProps) {
  const ref = useSortableCard(props);
  return <CardRow card={props.card} ref={ref} />;
}
