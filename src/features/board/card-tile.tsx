import { useSortable } from "@dnd-kit/react/sortable";
import { cn } from "cn";
import type { ReactNode, Ref } from "react";
import { Link } from "wouter";

import { OPENED_FROM_BOARD, useBoard } from "@/features/board/board-context";
import { CARD_SURFACE } from "@/features/board/card-surface";
import {
  CardAssignees,
  CardDue,
  CardPriority,
  CardStatus,
  isControlClick,
} from "@/features/board/inline-pickers";
import { LABEL_COLORS } from "@/features/card/card-fields";
import { HoldUpChips } from "@/features/card/card-relations";
import type { Card, Label } from "@/lib/model";
import { cardKey } from "@/lib/model";

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

function CardMeta({
  card,
  unsetDue,
  counted,
}: {
  card: Card;
  unsetDue?: boolean;
  counted?: boolean;
}) {
  return (
    <>
      <CardPriority card={card} />
      <HoldUpChips card={card} counted={counted} />
      <CardDue card={card} unset={unsetDue} />
      {card.labels.length > 0 && <LabelDots labels={card.labels} />}
      <CardAssignees card={card} className="ml-auto" />
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
  // A typed "->" reads as an arrow; the title itself keeps what was typed.
  return (
    <span className={cn(!title && "text-muted-foreground", className)}>
      {title.replaceAll("->", "→") || "Untitled"}
    </span>
  );
}

interface SortableCardProps {
  card: Card;
  index: number;
  group: string;
  /** Tells the card apart among several boards' cards; its own id otherwise. */
  id?: string;
}

function useSortableCard({ card, index, group, id }: SortableCardProps) {
  const { canEdit } = useBoard();
  return useSortable({
    accept: "card",
    disabled: !canEdit,
    group,
    id: id ?? card.id,
    index,
    type: "card",
  }).ref;
}

export function CardLink({
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
      onClick={(event) => {
        if (isControlClick(event)) {
          event.preventDefault();
        }
      }}
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
        <CardStatus card={card} />
        <CardMeta card={card} />
      </span>
    </CardLink>
  );
}

export function CardRow({
  card,
  unsetDue,
  ref,
  children,
}: {
  card: Card;
  /** Shows where to set a due date on cards without one. */
  unsetDue?: boolean;
  ref?: Ref<HTMLAnchorElement>;
  /** Shown after the title. */
  children?: ReactNode;
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
      <CardStatus card={card} />
      <CardTitle className="min-w-0 flex-1 truncate" title={card.title} />
      {children}
      <span className="flex shrink-0 items-center gap-2">
        <CardMeta card={card} counted unsetDue={unsetDue} />
      </span>
    </CardLink>
  );
}

export function SortableCardRow(props: SortableCardProps) {
  const ref = useSortableCard(props);
  return <CardRow card={props.card} ref={ref} />;
}
