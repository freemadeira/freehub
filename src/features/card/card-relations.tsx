import { cn } from "cn";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import { Link, useLocation } from "wouter";

import { usePlaces } from "@/components/app-link";
import { Button } from "@/components/ui/button";
import { boardQuery, swapCard, useBoard } from "@/features/board/board-context";
import { RELATION_STYLES, STATUS_STYLES } from "@/features/card/card-fields";
import { BlockedIcon } from "@/features/card/relation-icons";
import { unrelateCards } from "@/lib/actions";
import type { Card, Relation, Status } from "@/lib/model";
import { relationLabel, RELATIONS } from "@/lib/model";
import { cardPath } from "@/lib/paths";
import type { CardRelation, RelatedCard } from "@/lib/relations";
import { holdUps, relatedKey, relationsOf } from "@/lib/relations";

/** The card's relations, read from the board it's on. */
export function useRelations(card: Card): CardRelation[] {
  const { board, content, findCard } = useBoard();
  return relationsOf(content, { board, card }, findCard);
}

/** Whether something still open holds the card up. */
export function useBlocked(card: Card): boolean {
  return holdUps(card, useRelations(card)).blockedBy.length > 0;
}

/** A status icon, badged on its corner while the card is blocked. */
export function StatusIcon({
  status,
  blocked = false,
  className,
}: {
  status: Status;
  blocked?: boolean;
  className?: string;
}) {
  const { icon: Icon, className: tint } = STATUS_STYLES[status];
  return (
    <span className="relative flex shrink-0">
      <Icon aria-hidden className={cn("size-4", tint, className)} />
      {blocked && (
        <>
          <BlockedIcon
            aria-hidden
            className="bg-background ring-background absolute -top-1 -right-1 size-2.5 rounded-full text-red-500 ring-2"
          />
          <span className="sr-only">Blocked</span>
        </>
      )}
    </span>
  );
}

function HoldUpChip({
  relation,
  cards,
  counted,
}: {
  relation: Relation;
  cards: RelatedCard[];
  counted: boolean;
}) {
  const { icon: Icon, className } = RELATION_STYLES[relation];
  const told = `${relationLabel(relation)} ${cards.map(relatedKey).join(", ")}`;
  return (
    <span
      className="border-border text-muted-foreground inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-xs tabular-nums"
      title={told}
    >
      <Icon aria-hidden className={cn("size-3", className)} />
      {(counted || cards.length > 1) && <span aria-hidden>{cards.length}</span>}
      <span className="sr-only">{told}</span>
    </span>
  );
}

/**
 * What holds the card up, and what it holds up, among cards still open.
 * Rows count them; tiles only once there's more than one.
 */
export function HoldUpChips({
  card,
  counted = false,
}: {
  card: Card;
  counted?: boolean;
}) {
  const { blockedBy, blocking } = holdUps(card, useRelations(card));
  return (
    <>
      {blockedBy.length > 0 && (
        <HoldUpChip cards={blockedBy} counted={counted} relation="blockedBy" />
      )}
      {blocking.length > 0 && (
        <HoldUpChip cards={blocking} counted={counted} relation="blocking" />
      )}
    </>
  );
}

/**
 * A link to a related card. One on the same board takes the open card's place,
 * so leaving still goes back to the board.
 */
export function RelatedCardLink({
  item,
  className,
  children,
}: {
  item: RelatedCard;
  className?: string;
  children: ReactNode;
}) {
  const { board, cardHref } = useBoard();
  const { boards } = usePlaces();
  const [, navigate] = useLocation();
  const here = item.board.address === board.address;
  const href = here
    ? cardHref(item.card)
    : cardPath(item.board, item.card, {
        query: boardQuery(item.board, boards),
        withId: true,
      });
  return (
    <Link
      className={className}
      href={href}
      onClick={(event) => {
        if (
          here &&
          !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        ) {
          event.preventDefault();
          swapCard(navigate, href);
        }
      }}
    >
      {children}
    </Link>
  );
}

function RelationRow({
  card,
  relation,
}: {
  card: Card;
  relation: CardRelation;
}) {
  const { board, canEdit } = useBoard();
  const { other } = relation;
  const key = relatedKey(other);
  return (
    <li className="group/relation hover:bg-foreground/5 has-focus-visible:bg-foreground/5 relative flex h-8 items-center rounded-lg transition-colors duration-150">
      <RelatedCardLink
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-sm outline-none",
          canEdit && "pr-9"
        )}
        item={other}
      >
        <StatusIcon status={other.card.status} />
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {key}
        </span>
        <span
          className={cn(
            "truncate",
            !other.card.title && "text-muted-foreground"
          )}
        >
          {other.card.title || "Untitled"}
        </span>
      </RelatedCardLink>
      {canEdit && (
        <Button
          aria-label={`Remove ${relationLabel(relation.relation).toLowerCase()} ${key}`}
          className="absolute right-1 opacity-0 group-hover/relation:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          onClick={() => unrelateCards(relation.pair, { board, card }, other)}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon />
        </Button>
      )}
    </li>
  );
}

function RelationGroup({
  card,
  relation,
  items,
}: {
  card: Card;
  relation: Relation;
  items: CardRelation[];
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h2 className="text-muted-foreground text-sm font-medium" id={id}>
        {relationLabel(relation)}
      </h2>
      <ul className="-mx-2 flex flex-col">
        {items.map((item) => (
          <RelationRow card={card} key={item.pair.id} relation={item} />
        ))}
      </ul>
    </section>
  );
}

/** The cards this one is blocked by, blocking and related to, each kind under its own heading. */
export function CardRelations({ card }: { card: Card }) {
  const relations = useRelations(card);
  return RELATIONS.map(({ id }) => {
    const items = relations.filter((item) => item.relation === id);
    return (
      items.length > 0 && (
        <RelationGroup card={card} items={items} key={id} relation={id} />
      )
    );
  });
}
