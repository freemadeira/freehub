import { Autocomplete } from "@base-ui/react/autocomplete";
import type { AppHotkey } from "@tanstack/react-hotkeys";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { usePlaces } from "@/components/app-link";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useBoard } from "@/features/board/board-context";
import { RELATION_STYLES } from "@/features/card/card-fields";
import { StatusIcon, useRelations } from "@/features/card/card-relations";
import { useBoardContents } from "@/hooks/use-board-contents";
import { relateCards } from "@/lib/actions";
import type { Card, Relation } from "@/lib/model";
import { canEdit, cardKey, isClosed, relationLabel } from "@/lib/model";
import type { RelatedCard } from "@/lib/relations";
import { relatedKey } from "@/lib/relations";
import { hasTerms, searchable, searchTerms } from "@/lib/search";
import { SHORTCUTS } from "@/lib/shortcuts";

/** What a card can be marked as, with the shortcut that marks it. */
export const MARK_AS: {
  relation: Relation;
  label: string;
  shortcut: AppHotkey;
}[] = [
  {
    label: "Related to",
    relation: "related",
    shortcut: SHORTCUTS["card.related"],
  },
  {
    label: "Blocked by",
    relation: "blockedBy",
    shortcut: SHORTCUTS["card.blockedBy"],
  },
  {
    label: "Blocking",
    relation: "blocking",
    shortcut: SHORTCUTS["card.blocking"],
  },
];

export function markLabel(relation: Relation): string {
  return MARK_AS.find((item) => item.relation === relation)?.label ?? "";
}

/** Most cards the list shows at once; searching finds the rest. */
const SHOWN = 50;

const OPTION =
  "data-highlighted:bg-accent data-highlighted:text-accent-foreground flex h-9 cursor-default items-center gap-2 rounded-lg px-2.5 text-sm outline-none select-none";

/** A card that could be picked, and how it already stands to the open one. */
interface Candidate extends RelatedCard {
  current?: Relation;
}

/**
 * Cards whose key or title has every word typed. Typing a key or number puts
 * that card first; otherwise open cards come before closed ones, the most
 * recently changed first.
 */
function search(cards: Candidate[], typed: string): Candidate[] {
  const terms = searchTerms(typed);
  const whole = typed.trim().toLowerCase();
  const rank = (item: Candidate) => {
    const key = relatedKey(item).toLowerCase();
    const title = item.card.title.toLowerCase();
    if (terms.length > 0 && !hasTerms(searchable(`${key} ${title}`), terms)) {
      return -1;
    }
    if (whole && (key === whole || String(item.card.number) === whole)) {
      return 3;
    }
    if (whole && key.startsWith(whole)) {
      return 2;
    }
    return whole && title.startsWith(whole) ? 1 : 0;
  };
  return cards
    .map((item) => ({ item, rank: rank(item) }))
    .filter(({ rank: found }) => found >= 0)
    .toSorted(
      (a, b) =>
        b.rank - a.rank ||
        Number(isClosed(a.item.card.status)) -
          Number(isClosed(b.item.card.status)) ||
        b.item.card.event.created_at - a.item.card.event.created_at
    )
    .slice(0, SHOWN)
    .map(({ item }) => item);
}

/**
 * The cards the open one could be marked against: the board's, and those on
 * the project's other boards the user edits, since marking tells both cards.
 * Those already standing to it that way are left out, and for related, so
 * are those blocking it either way, which are related already.
 */
function useCandidates(card: Card, relation: Relation): Candidate[] {
  const { board, content, pubkey } = useBoard();
  const { boards } = usePlaces();
  const relations = useRelations(card);
  const others = board.project
    ? boards.filter(
        (other) =>
          other.project === board.project &&
          other.address !== board.address &&
          canEdit(other, pubkey)
      )
    : [];
  const { contents } = useBoardContents(others);
  const cards: RelatedCard[] = [
    ...content.cards.map((item) => ({ board, card: item })),
    ...others.flatMap((other) =>
      (contents?.get(other.address)?.cards ?? []).map((item) => ({
        board: other,
        card: item,
      }))
    ),
  ];
  return cards.flatMap((item): Candidate[] => {
    const now = relations.find(
      ({ other }) =>
        other.board.address === item.board.address &&
        other.card.id === item.card.id
    )?.relation;
    const skip =
      (item.board.address === board.address && item.card.id === card.id) ||
      now === relation ||
      (relation === "related" && now !== undefined);
    return skip ? [] : [{ ...item, current: now }];
  });
}

function PickList({
  card,
  relation,
  onPicked,
}: {
  card: Card;
  relation: Relation;
  onPicked: () => void;
}) {
  const { board, content } = useBoard();
  const [typed, setTyped] = useState("");
  const found = search(useCandidates(card, relation), typed);
  const pick = (other: Candidate) => {
    relateCards(content.relations, { board, card }, other, relation);
    onPicked();
  };
  return (
    <Autocomplete.Root
      autoHighlight
      filter={null}
      inline
      itemToStringValue={(item: Candidate) => relatedKey(item)}
      items={found}
      onValueChange={(value, details) => {
        // Picking fills the field with the key; the dialog closes meanwhile.
        if (details.reason !== "item-press") {
          setTyped(value);
        }
      }}
      open
      value={typed}
    >
      <Autocomplete.Input
        aria-label="Search cards"
        autoCapitalize="off"
        autoCorrect="off"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog is for picking a card
        autoFocus
        className="placeholder:text-muted-foreground h-12 w-full border-b bg-transparent px-4 text-base outline-none md:text-sm"
        placeholder="Search cards…"
        spellCheck={false}
      />
      <Autocomplete.List className="max-h-80 overflow-y-auto overscroll-contain p-1.5 empty:hidden">
        {(item: Candidate) => (
          <Autocomplete.Item
            className={OPTION}
            key={`${item.board.address}/${item.card.id}`}
            onClick={() => pick(item)}
            value={item}
          >
            <StatusIcon status={item.card.status} />
            <span className="text-muted-foreground w-16 shrink-0 truncate text-xs tabular-nums">
              {relatedKey(item)}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                !item.card.title && "text-muted-foreground"
              )}
            >
              {item.card.title || "Untitled"}
            </span>
            {item.current && (
              <span className="text-muted-foreground shrink-0 text-xs">
                {relationLabel(item.current)}
              </span>
            )}
          </Autocomplete.Item>
        )}
      </Autocomplete.List>
      <Autocomplete.Empty className="text-muted-foreground px-4 py-10 text-center text-sm empty:hidden">
        {typed.trim() ? "No cards found" : "No other cards to mark"}
      </Autocomplete.Empty>
    </Autocomplete.Root>
  );
}

interface RelationPickerProps {
  card: Card;
  relation: Relation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Picks the card the open one is marked as related to, blocked by or blocking. */
export function RelationPicker({
  card,
  relation,
  open,
  onOpenChange,
}: RelationPickerProps) {
  const { board } = useBoard();
  const key = cardKey(board, card);
  const { icon: Icon, className } = RELATION_STYLES[relation];
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="top-[12vh] max-w-xl translate-y-0 gap-0 p-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">
          Mark {key} as {markLabel(relation).toLowerCase()}
        </DialogTitle>
        <div
          aria-hidden
          className="text-muted-foreground flex min-w-0 items-center gap-1.5 px-4 pt-3.5 text-xs"
        >
          <span className="border-border inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full border px-2">
            <StatusIcon className="size-3.5" status={card.status} />
            <span className="shrink-0 tabular-nums">{key}</span>
            <span className="text-foreground truncate">
              {card.title || "Untitled"}
            </span>
          </span>
          <ChevronRightIcon className="size-3.5 shrink-0" />
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <Icon className={cn("size-3.5", className)} />
            {markLabel(relation)}
          </span>
        </div>
        <PickList
          card={card}
          onPicked={() => onOpenChange(false)}
          relation={relation}
        />
      </DialogContent>
    </Dialog>
  );
}
