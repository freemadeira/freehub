import { cn } from "cn";
import { SmilePlusIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { toast } from "sonner";

import { EmojiPicker } from "@/components/emoji-picker";
import { IconButton } from "@/components/icon-button";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { useBoard } from "@/features/board/board-context";
import { useProfileNames } from "@/hooks/use-profile-names";
import { setReaction } from "@/lib/actions";
import type { Reaction, ReactionTarget } from "@/lib/reactions";
import { MAX_REACTION_KINDS } from "@/lib/reactions";

const NAMES = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

const PILL =
  "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium tabular-nums transition-[background-color,box-shadow,scale,opacity] duration-150 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 starting:scale-90 starting:opacity-0";

function ReactionPill({
  reaction,
  target,
}: {
  reaction: Reaction;
  target: ReactionTarget;
}) {
  const { canEdit, pubkey } = useBoard();
  const names = useProfileNames(reaction.people);
  const mine = reaction.people.includes(pubkey);
  // Who reacted, you first.
  const others = reaction.people.flatMap((person) =>
    person === pubkey ? [] : (names.get(person) ?? [])
  );
  const who = NAMES.format(mine ? ["You", ...others] : others);
  return (
    <FluidTooltip.Root>
      <FluidTooltip.Trigger keepOpenOnClick>
        <button
          aria-disabled={!canEdit}
          aria-label={`${who} reacted with ${reaction.emoji}`}
          aria-pressed={mine}
          className={cn(
            PILL,
            mine
              ? "bg-primary/10 text-primary ring-primary/30 ring-1 ring-inset"
              : "bg-foreground/5",
            canEdit
              ? [
                  "active:scale-[0.96]",
                  mine ? "hover:bg-primary/15" : "hover:bg-foreground/10",
                ]
              : "cursor-default"
          )}
          onClick={() => {
            if (canEdit) {
              setReaction(target, reaction.emoji, !mine);
            }
          }}
          type="button"
        >
          <span aria-hidden className="text-sm leading-none">
            {reaction.emoji}
          </span>
          <span aria-hidden>{reaction.people.length}</span>
        </button>
      </FluidTooltip.Trigger>
      <FluidTooltip.Content>{who}</FluidTooltip.Content>
    </FluidTooltip.Root>
  );
}

/**
 * The reactions to a card or a comment, as pills that add or take back yours.
 * Goes inside a FluidTooltip.Group.
 */
export function Reactions({
  reactions,
  target,
  className,
}: {
  reactions: Reaction[];
  target: ReactionTarget;
  className?: string;
}) {
  if (reactions.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label="Reactions"
      className={cn("flex flex-wrap items-center gap-1", className)}
    >
      {reactions.map((reaction) => (
        <li key={reaction.emoji}>
          <ReactionPill reaction={reaction} target={target} />
        </li>
      ))}
    </ul>
  );
}

/** A smiley that picks an emoji to react to a card or a comment with. */
export function AddReaction({
  reactions,
  target,
  ...props
}: {
  reactions: Reaction[];
  target: ReactionTarget;
} & Pick<ComponentProps<typeof IconButton>, "className" | "size">) {
  const pick = (emoji: string) => {
    if (
      reactions.length >= MAX_REACTION_KINDS &&
      !reactions.some((reaction) => reaction.emoji === emoji)
    ) {
      toast.error(
        `Up to ${MAX_REACTION_KINDS} different emoji can be reactions here.`
      );
      return;
    }
    setReaction(target, emoji, true);
  };
  return (
    <EmojiPicker
      onPick={pick}
      trigger={
        <IconButton label="Add reaction" type="button" {...props}>
          <SmilePlusIcon />
        </IconButton>
      }
    />
  );
}
