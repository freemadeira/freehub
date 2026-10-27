import {
  CopyIcon,
  EllipsisIcon,
  FlagIcon,
  LinkIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { copyAndTell } from "@/components/copy";
import { IconButton } from "@/components/icon-button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBoard } from "@/features/board/board-context";
import { useCardCommands } from "@/features/card/card-commands";
import { RELATION_STYLES } from "@/features/card/card-fields";
import { MARK_AS, RelationPicker } from "@/features/card/relation-picker";
import { useShortcuts } from "@/hooks/use-shortcut";
import { deleteCard } from "@/lib/actions";
import type { Card, Relation } from "@/lib/model";
import { cardKey } from "@/lib/model";
import { cardPath } from "@/lib/paths";
import { keysText } from "@/lib/shortcuts";

/**
 * More for the open card, behind its ⋯ button: marking how it stands to other
 * cards, copying its key or link, and deleting it.
 */
export function CardMenu({
  card,
  onDeleted,
}: {
  card: Card;
  onDeleted: () => void;
}) {
  const { board, boardQuery, canEdit } = useBoard();
  // Kept after closing so the picker keeps its content while it animates out.
  const [marking, setMarking] = useState<{
    open: boolean;
    relation: Relation;
  }>();
  const [deleting, setDeleting] = useState(false);
  const key = cardKey(board, card);
  const mark = (relation: Relation) => setMarking({ open: true, relation });
  useCardCommands({ card, onDelete: () => setDeleting(true), onMark: mark });
  // M, then the key of a way to mark the card, opens the picker for it.
  useShortcuts(
    MARK_AS.map(({ relation, shortcut }) => ({
      enabled: canEdit,
      keys: shortcut,
      run: () => mark(relation),
    }))
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton label="More">
              <EllipsisIcon />
            </IconButton>
          }
        />
        <DropdownMenuContent align="end" className="min-w-48">
          {canEdit && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FlagIcon />
                  Mark as
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-52">
                  {MARK_AS.map(({ label, relation, shortcut }) => {
                    const { icon: Icon, className } = RELATION_STYLES[relation];
                    return (
                      <DropdownMenuItem
                        key={relation}
                        onClick={() => mark(relation)}
                      >
                        <Icon className={className} />
                        {label}…
                        <DropdownMenuShortcut>
                          {keysText(shortcut)}
                        </DropdownMenuShortcut>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => copyAndTell(key, `Copied ${key}`)}>
            <CopyIcon />
            Copy ID
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              copyAndTell(
                // A shared link outlives today's board: another card may get this number later.
                new URL(
                  cardPath(board, card, { query: boardQuery, withId: true }),
                  window.location.origin
                ).href,
                "Link copied"
              )
            }
          >
            <LinkIcon />
            Copy link
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleting(true)}
                variant="destructive"
              >
                <Trash2Icon />
                Delete…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {marking && (
        <RelationPicker
          card={card}
          onOpenChange={(open) => setMarking({ ...marking, open })}
          open={marking.open}
          relation={marking.relation}
        />
      )}
      {canEdit && (
        <AlertDialog onOpenChange={setDeleting} open={deleting}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {key}?</AlertDialogTitle>
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
      )}
    </>
  );
}
