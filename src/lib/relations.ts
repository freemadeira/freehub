import type { RelatedRef } from "@/lib/card-activity";
import type {
  Board,
  BoardContent,
  BoardRelation,
  Card,
  CardPlace,
  Relation,
} from "@/lib/model";
import {
  cardKey,
  isClosed,
  relationFrom,
  RELATIONS,
  samePlace,
} from "@/lib/model";

/** A card, with the board whose code and members go with it. */
export interface RelatedCard {
  board: Board;
  card: Card;
}

/** Finds a card among the boards whose cards have loaded. */
export type CardFinder = (place: CardPlace) => RelatedCard | undefined;

/** One of a card's relations, read from its side, with the card at the other end. */
export interface CardRelation {
  relation: Relation;
  /** The pair, as kept. */
  pair: BoardRelation;
  other: RelatedCard;
}

export function placeOf({ board, card }: RelatedCard): CardPlace {
  return { board: board.address, card: card.id };
}

function placeKey({ board, card }: CardPlace): string {
  return `${board}/${card}`;
}

/** The card as a change names it, should it be renamed or deleted later. */
export function relatedRef(item: RelatedCard): RelatedRef {
  return {
    ...placeOf(item),
    key: cardKey(item.board, item.card),
    title: item.card.title,
  };
}

/** Finds the cards of the boards given, among the contents loaded. */
export function cardFinder(
  boards: Board[],
  contents: ReadonlyMap<string, BoardContent> | undefined
): CardFinder {
  return (place) => {
    const board = boards.find(({ address }) => address === place.board);
    const card = contents
      ?.get(place.board)
      ?.cards.find(({ id }) => id === place.card);
    return board && card ? { board, card } : undefined;
  };
}

type Index = Map<string, BoardRelation[]>;

// Each tile reads its card's relations; grouped once per version of the board.
const indexes = new WeakMap<BoardRelation[], Index>();

function indexOf(relations: BoardRelation[]): Index {
  const kept = indexes.get(relations);
  if (kept) {
    return kept;
  }
  const index: Index = new Map();
  for (const relation of relations) {
    for (const end of [relation.from, relation.to]) {
      const key = placeKey(end);
      index.set(key, [...(index.get(key) ?? []), relation]);
    }
  }
  indexes.set(relations, index);
  return index;
}

const ORDER = RELATIONS.map(({ id }) => id);

/** By relation, then cards still open before closed ones, then by key. */
function compare(a: CardRelation, b: CardRelation): number {
  return (
    ORDER.indexOf(a.relation) - ORDER.indexOf(b.relation) ||
    Number(isClosed(a.other.card.status)) -
      Number(isClosed(b.other.card.status)) ||
    a.other.board.code.localeCompare(b.other.board.code) ||
    (a.other.card.number ?? 0) - (b.other.card.number ?? 0)
  );
}

/**
 * How a card stands to others, in the order its page lists them. A relation
 * counts once the card at its other end is found, and only if whoever marked
 * it is on that card's board too.
 */
export function relationsOf(
  content: BoardContent,
  item: RelatedCard,
  find: CardFinder
): CardRelation[] {
  const place = placeOf(item);
  return (indexOf(content.relations).get(placeKey(place)) ?? [])
    .flatMap((pair) => {
      const other = find(samePlace(pair.from, place) ? pair.to : pair.from);
      return other?.board.members.includes(pair.author)
        ? [{ other, pair, relation: relationFrom(pair, place) }]
        : [];
    })
    .toSorted(compare);
}

/**
 * The open cards an open card waits on, and those waiting on it. Closed cards
 * hold nothing up, and nothing holds a closed card up.
 */
export function holdUps(
  card: Pick<Card, "status">,
  relations: CardRelation[]
): { blockedBy: RelatedCard[]; blocking: RelatedCard[] } {
  const open = (relation: Relation) =>
    isClosed(card.status)
      ? []
      : relations.flatMap((item) =>
          item.relation === relation && !isClosed(item.other.card.status)
            ? [item.other]
            : []
        );
  return { blockedBy: open("blockedBy"), blocking: open("blocking") };
}

export function relatedKey({ board, card }: RelatedCard): string {
  return cardKey(board, card);
}
