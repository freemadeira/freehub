import { cn } from "cn";
import { Trash2Icon, XIcon } from "lucide-react";
import type { ChangeEvent } from "react";
import { useRef, useState } from "react";

import { CopyButton } from "@/components/copy";
import { IconButton } from "@/components/icon-button";
import { MarkdownEditor } from "@/components/markdown-editor";
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
import { cardKey } from "@/lib/model";

// Edited in place like text on the page: a hover tint, and no focus ring.
const INLINE_FIELD =
  "-mx-2 w-[calc(100%+1rem)] rounded-lg px-2 py-1 outline-none transition-colors duration-150 hover:not-focus:bg-foreground/5";

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
        "placeholder:text-muted-foreground field-sizing-content resize-none text-xl leading-snug font-semibold"
      )}
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

function DescriptionField({ card }: { card: Card }) {
  const { board } = useBoard();
  return (
    <MarkdownEditor
      aria-label="Description"
      className={cn(
        INLINE_FIELD,
        "min-h-20 py-1.5 text-base leading-relaxed md:text-sm"
      )}
      onKeyDown={(event) => {
        // Escape finishes editing instead of closing the card.
        if (event.key === "Escape" && event.target instanceof HTMLElement) {
          event.stopPropagation();
          event.target.blur();
        }
      }}
      onValueCommitted={(description) => {
        if (description !== card.description) {
          updateCard(board, card, { description });
        }
      }}
      placeholder="Add a description…"
      value={card.description}
    />
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
  const { board, boardQuery } = useBoard();
  return (
    <>
      <div className="-mt-1 -mr-2 flex items-center gap-0.5">
        <DialogTitle className="text-muted-foreground mr-auto text-sm font-normal tabular-nums">
          {cardKey(board, card)}
        </DialogTitle>
        <FluidTooltip.Group>
          <CopyButton
            label="Copy link"
            // A shared link outlives today's board: another card may get this number later.
            value={
              new URL(
                cardPath(board, card, { query: boardQuery, withId: true }),
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
