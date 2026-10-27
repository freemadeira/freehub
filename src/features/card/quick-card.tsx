import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useState } from "react";
import { useLocation, useSearchParams } from "wouter";

import { usePlaces } from "@/components/app-link";
import type { BoardScope } from "@/features/board/board-context";
import {
  boardQuery,
  parseTab,
  useOpenBoard,
} from "@/features/board/board-context";
import { BOARDS_PATH } from "@/features/boards/boards-page";
import { NewCardDialog } from "@/features/card/new-card-dialog";
import { useProjectInView } from "@/features/projects/use-project-in-view";
import { useBoardContents } from "@/hooks/use-board-contents";
import type { Board } from "@/lib/model";
import {
  activeSprint,
  canEdit,
  needsCardId,
  startingStatus,
} from "@/lib/model";
import { cardPath } from "@/lib/paths";
import type { Project } from "@/lib/project";
import { inProject } from "@/lib/project";
import { cardFinder } from "@/lib/relations";
import { readStorage, writeStorage } from "@/lib/utils";

/** The boards the user can add cards to. */
export function editableBoards(boards: Board[], pubkey: string): Board[] {
  return boards.filter((board) => canEdit(board, pubkey));
}

/**
 * Where a card made from here goes: the board on screen, else one of the
 * project's in view, the last one used there first, else the last one used.
 */
function startingBoard(
  scopes: BoardScope[],
  {
    inView,
    project,
    last,
  }: { inView?: Board; project?: Project; last: string | null }
): BoardScope | undefined {
  const find = (address?: string | null) =>
    scopes.find(({ board }) => board.address === address);
  const here = project
    ? scopes.filter(({ board }) => inProject(board, project))
    : [];
  return (
    find(inView?.address) ??
    here.find(({ board }) => board.address === last) ??
    here[0] ??
    find(last) ??
    scopes[0]
  );
}

interface QuickCardDialogProps {
  pubkey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
  finalFocus?: DialogPrimitive.Popup.Props["finalFocus"];
}

function QuickCardDialog({
  pubkey,
  open,
  onOpenChange,
  onClosed,
  finalFocus,
}: QuickCardDialogProps) {
  const { boards } = usePlaces();
  const project = useProjectInView();
  const editable = editableBoards(boards, pubkey);
  const { contents } = useBoardContents(editable);
  const [location] = useLocation();
  const [search] = useSearchParams();
  const inView = useOpenBoard(boards);
  const lastKey = `boards:${pubkey}:new-card`;
  const scopes = editable.flatMap((board): BoardScope[] => {
    const content = contents?.get(board.address);
    if (!content) {
      return [];
    }
    const query = boardQuery(board, boards);
    return [
      {
        board,
        boardQuery: query,
        canEdit: true,
        cardHref: (card) =>
          cardPath(board, card, { query, withId: needsCardId(content, card) }),
        cards: content.cards,
        content,
        findCard: cardFinder(editable, contents),
        // No board shows here to lay out.
        layout: "kanban",
        // Only this dialog adds cards here.
        newCard: () => {
          // Nothing to open.
        },
        pubkey,
      },
    ];
  });
  // Picked once, as soon as the boards' cards are there; picking another
  // board in the dialog is remembered for next time.
  const [start, setStart] = useState<BoardScope>();
  if (!start && scopes.length > 0) {
    setStart(
      startingBoard(scopes, {
        inView,
        last: readStorage(lastKey),
        project,
      })
    );
  }
  // As from the board's own button: on its sprint tab, a card joins the
  // running sprint. So does one made on the Boards page, to show up there.
  const sprinting = (scope: BoardScope) =>
    location === BOARDS_PATH ||
    (scope.board === inView && parseTab(search.get("tab")) === "sprint");

  return (
    <NewCardDialog
      announce
      choice={{
        onPick: (board) => writeStorage(lastKey, board.address),
        scopes,
        sprintOn: (scope) =>
          sprinting(scope) ? activeSprint(scope.content)?.id : undefined,
      }}
      defaults={{
        assignees: [],
        board: start?.board.address,
        status: startingStatus(start?.board.statuses ?? []),
      }}
      finalFocus={finalFocus}
      onClosed={onClosed}
      onOpenChange={onOpenChange}
      open={open}
    />
  );
}

interface QuickCardProps {
  pubkey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes once it has closed. */
  finalFocus?: DialogPrimitive.Popup.Props["finalFocus"];
}

/**
 * A new card from anywhere, on the board that fits where it's opened, or any
 * other picked. Every board's cards load only while it's up.
 */
export function QuickCard({ open, ...props }: QuickCardProps) {
  const [shown, setShown] = useState(open);
  if (open && !shown) {
    setShown(true);
  }
  return shown ? (
    <QuickCardDialog {...props} onClosed={() => setShown(false)} open={open} />
  ) : null;
}
