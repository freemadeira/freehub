import { Settings2Icon } from "lucide-react";
import { useState } from "react";
import { Redirect, useLocation, useSearchParams } from "wouter";

import { IconButton } from "@/components/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssigneeFilter } from "@/features/board/assignee-filter";
import { BacklogView } from "@/features/board/backlog-view";
import type { BoardScope } from "@/features/board/board-context";
import { BoardContext, cardPath } from "@/features/board/board-context";
import { DoneView } from "@/features/board/done-view";
import { SprintView } from "@/features/board/sprint-view";
import { BoardDialog } from "@/features/boards/board-dialog";
import { CardDialog } from "@/features/card/card-dialog";
import type { NewCardDefaults } from "@/features/card/new-card-dialog";
import { NewCardDialog } from "@/features/card/new-card-dialog";
import { useBoardContent } from "@/hooks/use-board-content";
import type { Board, Card } from "@/lib/model";
import type { Project } from "@/lib/project";

const TABS = ["backlog", "sprint", "done"] as const;
const DEFAULT_TAB = "sprint";

type Tab = (typeof TABS)[number];

function parseTab(value: string | null): Tab {
  return TABS.find((tab) => tab === value) ?? DEFAULT_TAB;
}

function withQuery(path: string, query: URLSearchParams): string {
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

// Keeps the last opened card so the dialog can animate out after it closes.
function useSelectedCard(
  cards: Card[] | undefined,
  cardNumber: number | undefined,
  cardId: string | null
) {
  const [lastCard, setLastCard] = useState<Card>();
  const selected = cards?.find((card) =>
    cardNumber === undefined ? card.id === cardId : card.number === cardNumber
  );
  if (selected && selected.event !== lastCard?.event) {
    setLastCard(selected);
  }
  return { selected, shown: selected ?? lastCard };
}

export function BoardSkeleton({ list = false }: { list?: boolean }) {
  if (list) {
    return (
      <div aria-busy className="flex flex-col gap-3">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }
  return (
    <div aria-busy className="grid min-h-64 grow gap-3 sm:grid-cols-3">
      <Skeleton className="rounded-2xl" />
      <Skeleton className="rounded-2xl max-sm:hidden" />
      <Skeleton className="rounded-2xl max-sm:hidden" />
    </div>
  );
}

interface BoardPageProps {
  board: Board;
  boards: Board[];
  projects: Project[];
  pubkey: string;
  cardNumber?: number;
}

export function BoardPage({
  board,
  boards,
  projects,
  pubkey,
  cardNumber,
}: BoardPageProps) {
  const { content, loaded } = useBoardContent(board);
  const [params, setParams] = useSearchParams();
  const [, navigate] = useLocation();
  const [assignee, setAssignee] = useState<string>();
  const [editing, setEditing] = useState(false);
  // Kept after closing so the dialog keeps its content while it animates out.
  const [adding, setAdding] = useState<{
    open: boolean;
    defaults: NewCardDefaults;
  }>();

  const tab = parseTab(params.get("tab"));
  const tabQuery = new URLSearchParams(tab === DEFAULT_TAB ? {} : { tab });
  const boardHref = withQuery(`/${board.code}`, tabQuery);
  const cardId = params.get("card");
  const wantsCard = cardNumber !== undefined || cardId !== null;
  const { selected, shown: shownCard } = useSelectedCard(
    content?.cards,
    cardNumber,
    cardId
  );

  const showTab = (value: Tab) =>
    setParams(value === DEFAULT_TAB ? {} : { tab: value });

  const closeCard = () => {
    if (history.state?.fromBoard) {
      history.back();
    } else {
      navigate(boardHref, { replace: true });
    }
  };

  const scope: BoardScope | null = content
    ? {
        board,
        cardHref: (card) => cardPath(board, card, tabQuery),
        cards: assignee
          ? content.cards.filter((card) => card.assignees.includes(assignee))
          : content.cards,
        content,
        newCard: (placement) =>
          setAdding({
            defaults: { ...placement, assignees: assignee ? [assignee] : [] },
            open: true,
          }),
        pubkey,
      }
    : null;
  const ready = scope !== null && (loaded || scope.content.cards.length > 0);

  return (
    <BoardContext value={scope}>
      <main className="flex grow flex-col px-4 pb-8 sm:px-6">
        <Tabs className="grow gap-4" onValueChange={showTab} value={tab}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="backlog">Backlog</TabsTrigger>
              <TabsTrigger value="sprint">Sprint</TabsTrigger>
              <TabsTrigger value="done">Done</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <AssigneeFilter
                members={board.members}
                onChange={setAssignee}
                value={assignee}
              />
              {board.creator === pubkey && (
                <IconButton
                  label="Board settings"
                  onClick={() => setEditing(true)}
                >
                  <Settings2Icon />
                </IconButton>
              )}
            </div>
          </div>
          <TabsContent className="flex flex-col" value="backlog">
            {ready ? (
              <BacklogView onSprintStarted={() => showTab("sprint")} />
            ) : (
              <BoardSkeleton list />
            )}
          </TabsContent>
          <TabsContent className="flex flex-col" value="sprint">
            {ready ? <SprintView /> : <BoardSkeleton />}
          </TabsContent>
          <TabsContent className="flex flex-col" value="done">
            {ready ? <DoneView /> : <BoardSkeleton list />}
          </TabsContent>
        </Tabs>
      </main>
      {shownCard && (
        <CardDialog
          card={shownCard}
          onClose={closeCard}
          open={selected !== undefined}
        />
      )}
      {loaded && content && wantsCard && !shownCard && (
        <Redirect replace to={boardHref} />
      )}
      {scope && adding && (
        <NewCardDialog
          defaults={adding.defaults}
          onOpenChange={(open) => setAdding({ ...adding, open })}
          open={adding.open}
        />
      )}
      <BoardDialog
        board={board}
        boards={boards}
        onOpenChange={setEditing}
        open={editing}
        projects={projects}
        pubkey={pubkey}
      />
    </BoardContext>
  );
}
