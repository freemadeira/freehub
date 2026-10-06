import { cn } from "cn";
import { PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import type { ChangeEvent, MouseEvent } from "react";
import { useRef, useState } from "react";

import { CopyButton } from "@/components/copy";
import { IconButton } from "@/components/icon-button";
import { Markdown } from "@/components/markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { cardPath, useBoard } from "@/features/board/board-context";
import { CardProperties } from "@/features/card/card-properties";
import { Comments } from "@/features/card/comments";
import { deleteCard, updateCard } from "@/lib/actions";
import type { Card } from "@/lib/model";
import { cardKey, needsCardId } from "@/lib/model";

const INLINE_FIELD =
  "field-sizing-content -mx-2 w-[calc(100%+1rem)] resize-none rounded-lg px-2 py-1 outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-muted-foreground hover:not-focus:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/30";

const DESCRIPTION = "min-h-20 py-1.5 text-base leading-relaxed md:text-sm";

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
      className={cn(INLINE_FIELD, "text-xl leading-snug font-semibold")}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      placeholder="Untitled"
      rows={1}
    />
  );
}

// Clicks on links, checkboxes or a text selection belong to the rendered text.
function wantsEditing(event: MouseEvent): boolean {
  const target = event.target instanceof Element ? event.target : null;
  return (
    !target?.closest("a, button, input") && !document.getSelection()?.toString()
  );
}

function DescriptionEditor({
  card,
  onDone,
}: {
  card: Card;
  onDone: () => void;
}) {
  const { board } = useBoard();
  const field = useDraft(card.description, (draft) => {
    const description = draft.trim();
    if (description !== card.description) {
      updateCard(board, card, { description });
    }
  });
  return (
    <textarea
      {...field}
      aria-label="Description"
      autoFocus
      className={cn(INLINE_FIELD, DESCRIPTION)}
      onBlur={() => {
        field.onBlur();
        onDone();
      }}
      onFocus={(event) => {
        const { length } = event.currentTarget.value;
        event.currentTarget.setSelectionRange(length, length);
      }}
      onKeyDown={(event) => {
        // Escape finishes editing instead of closing the card.
        if (event.key === "Escape") {
          event.stopPropagation();
          event.currentTarget.blur();
        }
      }}
      placeholder="Add a description… Markdown works."
    />
  );
}

function DescriptionField({ card }: { card: Card }) {
  const [editing, setEditing] = useState(false);
  const edit = () => setEditing(true);

  if (editing) {
    return <DescriptionEditor card={card} onDone={() => setEditing(false)} />;
  }
  if (!card.description) {
    return (
      <button
        className={cn(
          INLINE_FIELD,
          DESCRIPTION,
          "text-muted-foreground text-left"
        )}
        onClick={edit}
        type="button"
      >
        Add a description…
      </button>
    );
  }
  return (
    // Clicking the text is a shortcut; the edit button is the accessible way in.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="group/description hover:bg-foreground/5 relative -mx-2 cursor-text rounded-lg px-2 py-1.5 transition-colors duration-150"
      onClick={(event) => {
        if (wantsEditing(event)) {
          edit();
        }
      }}
    >
      <Markdown
        className="text-base leading-relaxed md:text-sm"
        source={card.description}
      />
      <IconButton
        className="bg-popover absolute top-1 right-1 opacity-0 transition-opacity duration-150 group-hover/description:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        label="Edit description"
        onClick={edit}
        size="icon-xs"
      >
        <PencilIcon />
      </IconButton>
    </div>
  );
}

function DeleteCard({
  card,
  onDeleted,
}: {
  card: Card;
  onDeleted: () => void;
}) {
  const { board } = useBoard();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Delete card" onClick={() => setOpen(true)}>
        <Trash2Icon />
      </IconButton>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {cardKey(board, card)}?</AlertDialogTitle>
            <AlertDialogDescription>
              This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDeleted();
                deleteCard(board, card);
              }}
              variant="destructive"
            >
              Delete card
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CardDetails({ card, onClose }: { card: Card; onClose: () => void }) {
  const { board, content } = useBoard();
  return (
    <>
      <div className="-mt-1 -mr-2 flex items-center gap-0.5">
        <DialogTitle className="text-muted-foreground mr-auto text-sm font-normal tabular-nums">
          {cardKey(board, card)}
        </DialogTitle>
        <FluidTooltip.Group>
          <CopyButton
            label="Copy link"
            value={
              new URL(
                cardPath(board, card, {
                  withId: needsCardId(content, card),
                }),
                window.location.origin
              ).href
            }
          />
          <DeleteCard card={card} onDeleted={onClose} />
          <IconButton label="Close" onClick={onClose}>
            <XIcon />
          </IconButton>
        </FluidTooltip.Group>
      </div>
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-[1fr_17rem] md:grid-rows-[auto_1fr]">
        <div className="flex min-w-0 flex-col gap-1">
          <TitleField card={card} />
          <DescriptionField card={card} />
        </div>
        <CardProperties className="md:row-span-2" card={card} />
        <Comments card={card} className="min-w-0" />
      </div>
    </>
  );
}

interface CardDialogProps {
  card: Card;
  open: boolean;
  onClose: () => void;
}

export function CardDialog({ card, open, onClose }: CardDialogProps) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent
        className="max-w-3xl"
        initialFocus={popup}
        ref={popup}
        showCloseButton={false}
      >
        <CardDetails card={card} key={card.id} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
