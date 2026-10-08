import { cn } from "cn";
import { Settings2Icon, SquareKanbanIcon } from "lucide-react";
import {
  Activity,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Redirect, useLocation, useSearchParams } from "wouter";

import { IconButton } from "@/components/icon-button";
import { ProjectAvatar } from "@/components/project-avatar";
import type { Crumb } from "@/components/top-bar";
import { TopBar } from "@/components/top-bar";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssigneeFilter } from "@/features/board/assignee-filter";
import { BacklogView } from "@/features/board/backlog-view";
import type { BoardScope } from "@/features/board/board-context";
import {
  BoardContext,
  boardQuery,
  cardPath,
} from "@/features/board/board-context";
import { DoneView } from "@/features/board/done-view";
import { LayoutSwitch, useBoardLayout } from "@/features/board/layout-switch";
import { SprintView } from "@/features/board/sprint-view";
import { BoardDialog } from "@/features/boards/board-dialog";
import { CardPage, CardPageSkeleton } from "@/features/card/card-page";
import type { NewCardDefaults } from "@/features/card/new-card-dialog";
import { NewCardDialog } from "@/features/card/new-card-dialog";
import { useBoardContent } from "@/hooks/use-board-content";
import type { Board } from "@/lib/model";
import { canEdit, needsCardId } from "@/lib/model";
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

function withTab(query: URLSearchParams, tab: Tab): URLSearchParams {
  const next = new URLSearchParams(query);
  if (tab !== DEFAULT_TAB) {
    next.set("tab", tab);
  }
  return next;
}

/** The way to a board, which links back to it while one of its cards is open. */
export function boardCrumbs(
  label: string,
  project?: Project,
  href?: string
): Crumb[] {
  const crumb: Crumb = {
    href,
    icon: (
      <SquareKanbanIcon className="text-muted-foreground size-4 shrink-0" />
    ),
    label,
  };
  return project
    ? [
        {
          href: `/p/${project.slug}`,
          icon: <ProjectAvatar project={project} />,
          label: project.title,
        },
        crumb,
      ]
    : [crumb];
}

/**
 * A card opens at its top, and leaving it scrolls back to where the board was
 * left: the board stays mounted under the card, but the page scroll is shared.
 */
function useBoardScroll(openCard?: string) {
  const open = useRef(openCard !== undefined);
  const boardScroll = useRef(0);
  useEffect(() => {
    const save = () => {
      if (!open.current) {
        boardScroll.current = window.scrollY;
      }
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, []);
  useLayoutEffect(() => {
    open.current = openCard !== undefined;
    window.scrollTo(0, open.current ? 0 : boardScroll.current);
  }, [openCard]);
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

interface OpenCardProps {
  number?: number;
  /** Tells apart cards that share a number, and finds those without one. */
  id: string | null;
  crumbs: Crumb[];
  boardHref: string;
  /** Whether the board's cards have loaded. */
  loaded: boolean;
  onLeave: () => void;
}

/** The card a link points at, or back to the board once it turns out to be gone. */
function OpenCard({
  number,
  id,
  crumbs,
  boardHref,
  loaded,
  onLeave,
}: OpenCardProps) {
  const content = use(BoardContext)?.content;
  // The id wins: it tells apart cards that share a number.
  const card = content?.cards.find((item) =>
    id === null ? item.number === number : item.id === id
  );
  if (card) {
    return (
      <CardPage card={card} crumbs={crumbs} key={card.id} onLeave={onLeave} />
    );
  }
  return loaded && content ? (
    <Redirect replace to={boardHref} />
  ) : (
    <CardPageSkeleton crumbs={crumbs} />
  );
}

interface BoardPageProps {
  board: Board;
  boards: Board[];
  /** The project the board belongs to, if the user sees it. */
  project?: Project;
  projects: Project[];
  pubkey: string;
  cardNumber?: number;
}

export function BoardPage({
  board,
  boards,
  project,
  projects,
  pubkey,
  cardNumber,
}: BoardPageProps) {
  const { content, loaded } = useBoardContent(board);
  const [params, setParams] = useSearchParams();
  const [, navigate] = useLocation();
  const [assignee, setAssignee] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useBoardLayout(board);
  // Kept after closing so the dialog keeps its content while it animates out.
  const [adding, setAdding] = useState<{
    open: boolean;
    defaults: NewCardDefaults;
  }>();

  const tab = parseTab(params.get("tab"));
  const linkQuery = boardQuery(board, boards);
  const tabQuery = withTab(linkQuery, tab);
  const boardHref = withQuery(`/${board.code}`, tabQuery);
  const cardId = params.get("card");
  const openCard = cardId ?? cardNumber?.toString();
  const cardOpen = openCard !== undefined;
  const crumbs = boardCrumbs(
    board.title,
    project,
    cardOpen ? boardHref : undefined
  );
  useBoardScroll(openCard);

  const showTab = (value: Tab) => setParams(withTab(linkQuery, value));

  const leaveCard = () => {
    if (history.state?.fromBoard) {
      history.back();
    } else {
      navigate(boardHref, { replace: true });
    }
  };

  const scope: BoardScope | null = content
    ? {
        board,
        boardQuery: linkQuery,
        canEdit: canEdit(board, pubkey),
        cardHref: (card) =>
          cardPath(board, card, {
            query: tabQuery,
            withId: needsCardId(content, card),
          }),
        cards: assignee
          ? content.cards.filter((card) => card.assignees.includes(assignee))
          : content.cards,
        content,
        layout,
        newCard: (placement) =>
          setAdding({
            defaults: { ...placement, assignees: assignee ? [assignee] : [] },
            open: true,
          }),
        pubkey,
      }
    : null;
  const ready = scope !== null && (loaded || scope.content.cards.length > 0);
  // The sprint shows its cards in the board's layout; the backlog and done
  // tabs are lists of their own.
  const bySprint = tab === "sprint";
  // The kanban fills the screen under the 3.5rem top bar, so its columns
  // scroll on their own and the page stays put. Lists scroll the page.
  const fitsScreen = bySprint && layout === "kanban";

  return (
    <BoardContext value={scope}>
      {!cardOpen && <TopBar crumbs={crumbs} />}
      {/* Kept under an open card, so leaving it finds the board as it was. */}
      <Activity mode={cardOpen ? "hidden" : "visible"}>
        <main
          className={cn(
            "flex grow flex-col px-4 sm:px-6",
            fitsScreen ? "h-[calc(100dvh-3.5rem)] min-h-96 pb-4" : "pb-8"
          )}
        >
          <Tabs
            className="min-h-0 grow gap-4"
            onValueChange={showTab}
            value={tab}
          >
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
                <FluidTooltip.Group>
                  {bySprint && (
                    <LayoutSwitch onChange={setLayout} value={layout} />
                  )}
                  {board.creator === pubkey && (
                    <IconButton
                      label="Board settings"
                      onClick={() => setEditing(true)}
                    >
                      <Settings2Icon />
                    </IconButton>
                  )}
                </FluidTooltip.Group>
              </div>
            </div>
            <TabsContent className="flex flex-col" value="backlog">
              {ready ? (
                <BacklogView onSprintStarted={() => showTab("sprint")} />
              ) : (
                <BoardSkeleton list />
              )}
            </TabsContent>
            <TabsContent className="flex min-h-0 flex-col" value="sprint">
              {ready ? (
                <SprintView />
              ) : (
                <BoardSkeleton list={layout === "list"} />
              )}
            </TabsContent>
            <TabsContent className="flex flex-col" value="done">
              {ready ? <DoneView /> : <BoardSkeleton list />}
            </TabsContent>
          </Tabs>
        </main>
      </Activity>
      {cardOpen && (
        <OpenCard
          boardHref={boardHref}
          crumbs={crumbs}
          id={cardId}
          loaded={loaded}
          number={cardNumber}
          onLeave={leaveCard}
        />
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
