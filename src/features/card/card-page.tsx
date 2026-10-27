import { cn } from "cn";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { ChangeEvent } from "react";
import { useId, useState } from "react";
import { useLocation } from "wouter";

import { IconButton } from "@/components/icon-button";
import { MarkdownEditor, MarkdownView } from "@/components/markdown-editor";
import { KeyHint } from "@/components/shortcut-keys";
import type { Crumb } from "@/components/top-bar";
import { TopBar } from "@/components/top-bar";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { swapCard, useBoard } from "@/features/board/board-context";
import { CardActivitySection } from "@/features/card/card-activity";
import { CardMenu } from "@/features/card/card-menu";
import { CardProperties } from "@/features/card/card-properties";
import {
  CardRelations,
  StatusIcon,
  useBlocked,
} from "@/features/card/card-relations";
import { AddReaction, Reactions } from "@/features/card/reactions";
import { SubscribeButton } from "@/features/card/subscribe-button";
import { useCardThread } from "@/hooks/use-comments";
import { useCardReactions } from "@/hooks/use-reactions";
import { useShortcut, useShortcuts } from "@/hooks/use-shortcut";
import { useVisit } from "@/hooks/use-visit";
import { updateCard } from "@/lib/actions";
import type { Card } from "@/lib/model";
import { cardKey } from "@/lib/model";
import type { Reaction } from "@/lib/reactions";
import { cardReactionTarget, NO_REACTIONS } from "@/lib/reactions";
import { SHORTCUTS } from "@/lib/shortcuts";

// The text and comments read down a column in the middle, beside a panel of
// properties. Narrower screens stack them, with the properties between the two.
const LAYOUT =
  "grid grow max-lg:content-start lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]";
const COLUMN = "mx-auto w-full max-w-3xl min-w-0 px-4 sm:px-10";
const ASIDE = "px-4 py-6 sm:px-10 lg:row-span-2 lg:border-l lg:px-6 lg:pt-10";

// Edited in place like text on the page: a hover tint, and no focus ring.
const INLINE_FIELD =
  "-mx-2 w-[calc(100%+1rem)] rounded-lg px-2 py-1 outline-none transition-colors duration-150 hover:not-focus:bg-foreground/5";
const TITLE = "text-2xl leading-snug font-semibold tracking-tight";
const DESCRIPTION = "py-1.5 text-base leading-relaxed md:text-sm";

// Typing is kept local until the field loses focus, so teammates' edits never overwrite it mid-sentence.
function useDraft(value: string, save: (draft: string) => void) {
  const [draft, setDraft] = useState<string>();
  return {
    onBlur: () => {
      if (draft !== undefined && draft !== value) {
        save(draft);
      }
      setDraft(undefined);
    },
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) =>
      setDraft(event.target.value),
    value: draft ?? value,
  };
}

function TitleField({ card }: { card: Card }) {
  const { board } = useBoard();
  const field = useDraft(card.title, (draft) => {
    const title = draft.trim();
    if (title && title !== card.title) {
      updateCard(board, card, { title });
    }
  });
  return (
    <textarea
      {...field}
      aria-label="Title"
      className={cn(
        INLINE_FIELD,
        TITLE,
        "placeholder:text-muted-foreground field-sizing-content resize-none"
      )}
      onKeyDown={(event) => {
        if (
          (event.key === "Enter" && !event.nativeEvent.isComposing) ||
          event.key === "Escape"
        ) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      placeholder="Untitled"
      rows={1}
    />
  );
}

function DescriptionField({ card }: { card: Card }) {
  const { board, pubkey } = useBoard();
  return (
    <MarkdownEditor
      aria-label="Description"
      className={cn(INLINE_FIELD, DESCRIPTION, "min-h-20")}
      onKeyDown={(event) => {
        // Escape finishes editing; the next one leaves the card.
        if (event.key === "Escape" && event.target instanceof HTMLElement) {
          event.stopPropagation();
          event.target.blur();
        }
      }}
      onValueCommitted={(description, picked) => {
        if (description !== card.description) {
          updateCard(board, card, { description }, picked);
        }
      }}
      // Anyone who can read the card, viewers too, can be pointed at it.
      people={[...board.members, ...board.viewers].filter(
        (person) => person !== pubkey
      )}
      refs={{ project: board.project }}
      placeholder="Add a description…"
      value={card.description}
    />
  );
}

function CardText({ card }: { card: Card }) {
  return (
    <>
      <p
        className={cn(
          TITLE,
          "py-1 wrap-break-word",
          !card.title && "text-muted-foreground"
        )}
      >
        {card.title || "Untitled"}
      </p>
      {card.description && (
        <MarkdownView className={DESCRIPTION} value={card.description} />
      )}
    </>
  );
}

/** Reactions to the card, under its text, and the smiley that adds one. */
function CardReactions({
  card,
  reactions = NO_REACTIONS,
}: {
  card: Card;
  reactions?: Reaction[];
}) {
  const { board, canEdit, pubkey } = useBoard();
  if (!canEdit && reactions.length === 0) {
    return null;
  }
  const target = cardReactionTarget(board, card);
  return (
    // Set back so a leading smiley lines up with the text above, unless pills
    // lead instead. Not keyed to the first button: an open popover puts a
    // hidden focus guard before its trigger.
    <div className="-ml-2 flex flex-wrap items-center gap-1 pt-2 has-[>ul:first-child]:ml-0">
      <FluidTooltip.Group>
        <Reactions
          canEdit={canEdit}
          me={pubkey}
          reactions={reactions}
          target={target}
        />
        {canEdit && <AddReaction reactions={reactions} target={target} />}
      </FluidTooltip.Group>
    </div>
  );
}

/**
 * Escape leaves the card, as long as nothing on it has focus to give up first:
 * a field blurs, and a menu closes, before the next Escape leaves.
 */
function useEscapeToLeave(onLeave: () => void) {
  useShortcut(SHORTCUTS["card.leave"], (event) => {
    if (event.target === document.body) {
      onLeave();
    }
  });
}

interface CardStepsProps {
  previousHref?: string;
  nextHref?: string;
}

/**
 * Steps to the card before or after this one, as the board lists them, by
 * button or with K and J.
 */
function CardSteps({ previousHref, nextHref }: CardStepsProps) {
  const [, navigate] = useLocation();
  useShortcuts([
    {
      enabled: nextHref !== undefined,
      keys: SHORTCUTS["card.next"],
      run: () => nextHref && swapCard(navigate, nextHref),
    },
    {
      enabled: previousHref !== undefined,
      keys: SHORTCUTS["card.previous"],
      run: () => previousHref && swapCard(navigate, previousHref),
    },
  ]);
  return (
    <>
      <IconButton
        disabled={!previousHref}
        label="Previous card"
        onClick={() => previousHref && swapCard(navigate, previousHref)}
        tooltip={
          <KeyHint keys={SHORTCUTS["card.previous"]} label="Previous card" />
        }
      >
        <ChevronUpIcon />
      </IconButton>
      <IconButton
        disabled={!nextHref}
        label="Next card"
        onClick={() => nextHref && swapCard(navigate, nextHref)}
        tooltip={<KeyHint keys={SHORTCUTS["card.next"]} label="Next card" />}
      >
        <ChevronDownIcon />
      </IconButton>
    </>
  );
}

function cardCrumb(card: Card, label: string, blocked: boolean): Crumb {
  return {
    icon: <StatusIcon blocked={blocked} status={card.status} />,
    label: `${label} ${card.title || "Untitled"}`,
  };
}

interface CardPageProps extends CardStepsProps {
  card: Card;
  /** The way to the board, which the card's own crumb ends. */
  crumbs: Crumb[];
  /** Goes back to the board, or wherever the card was opened from. */
  onLeave: () => void;
}

/** A card on a page of its own: its text and comments, with its properties beside them. */
export function CardPage({
  card,
  crumbs,
  onLeave,
  previousHref,
  nextHref,
}: CardPageProps) {
  const id = useId();
  const { board, canEdit, pubkey } = useBoard();
  const thread = useCardThread(board, card);
  const reactions = useCardReactions(board, card, thread.comments);
  const blocked = useBlocked(card);
  useEscapeToLeave(onLeave);
  useVisit(pubkey, { id: `${board.address}/${card.id}`, kind: "card" });
  return (
    <>
      <TopBar
        crumbs={[...crumbs, cardCrumb(card, cardKey(board, card), blocked)]}
      >
        <FluidTooltip.Group>
          <SubscribeButton card={card} />
          <CardMenu card={card} onDeleted={onLeave} />
          <CardSteps nextHref={nextHref} previousHref={previousHref} />
        </FluidTooltip.Group>
      </TopBar>
      <main className={LAYOUT}>
        <div className={cn(COLUMN, "flex flex-col gap-1 pt-6 sm:pt-10")}>
          {canEdit ? (
            <>
              <TitleField card={card} />
              <DescriptionField card={card} />
            </>
          ) : (
            <CardText card={card} />
          )}
          <CardReactions card={card} reactions={reactions.get(card.id)} />
        </div>
        <aside className={ASIDE}>
          <div className="flex flex-col gap-6 lg:sticky lg:top-20">
            <section aria-labelledby={id} className="flex flex-col gap-3">
              <h2 className="text-muted-foreground text-sm font-medium" id={id}>
                Properties
              </h2>
              <CardProperties card={card} />
            </section>
            <CardRelations card={card} />
          </div>
        </aside>
        <div className={cn(COLUMN, "pb-10")}>
          <CardActivitySection
            card={card}
            className="border-t pt-6"
            reactions={reactions}
            thread={thread}
          />
        </div>
      </main>
    </>
  );
}

/** The card's page while the board's cards load. */
export function CardPageSkeleton({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <>
      <TopBar crumbs={crumbs} />
      <main aria-busy className={LAYOUT}>
        <div className={cn(COLUMN, "flex flex-col gap-4 pt-6 sm:pt-10")}>
          <Skeleton className="h-8 w-2/3 rounded-xl" />
          <Skeleton className="h-4 w-full rounded-full" />
          <Skeleton className="h-4 w-5/6 rounded-full" />
        </div>
        <div className={ASIDE}>
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </main>
    </>
  );
}
