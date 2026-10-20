import { cn } from "cn";
import { KanbanIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { FilterGroup, FilterPopover } from "@/components/filter-popover";
import { TopBar } from "@/components/top-bar";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { AssigneeFilter } from "@/features/board/assignee-filter";
import type { BoardScope } from "@/features/board/board-context";
import { boardQuery } from "@/features/board/board-context";
import { BoardSkeleton } from "@/features/board/board-page";
import { LayoutSwitch, useLayout } from "@/features/board/layout-switch";
import type { SprintCard } from "@/features/boards/sprint-cards";
import { sprintCards } from "@/features/boards/sprint-cards";
import { SprintKanban, SprintList } from "@/features/boards/sprint-views";
import type { NewCardDefaults } from "@/features/card/new-card-dialog";
import { NewCardDialog } from "@/features/card/new-card-dialog";
import {
  boardOptions,
  projectOptions,
  shown,
} from "@/features/home/task-filters";
import { placesOf } from "@/features/home/tasks";
import { useBoardContents } from "@/hooks/use-board-contents";
import type { Board, Status } from "@/lib/model";
import {
  activeSprint,
  canEdit,
  isClosed,
  needsCardId,
  STATUSES,
} from "@/lib/model";
import { cardPath } from "@/lib/paths";
import type { Project } from "@/lib/project";
import { readStorage, writeStorage } from "@/lib/utils";

/** Shares the top-level path with board codes, so BOARDS is a reserved code. */
export const BOARDS_PATH = "/boards";

interface BoardsFilters {
  /** Addresses of projects and boards; a card in any of them shows. */
  places: string[];
  assignee?: string;
}

function readFilters(key: string): BoardsFilters {
  try {
    const value: unknown = JSON.parse(readStorage(key) ?? "{}");
    const { places, assignee } = (value ?? {}) as Partial<BoardsFilters>;
    return {
      assignee: typeof assignee === "string" ? assignee : undefined,
      places: Array.isArray(places)
        ? places.filter((place) => typeof place === "string")
        : [],
    };
  } catch {
    return { places: [] };
  }
}

/** The filters, remembered on this device, so coming back from a card finds them. */
function useFilters(
  pubkey: string
): [BoardsFilters, (filters: BoardsFilters) => void] {
  const key = `boards:${pubkey}:filters`;
  const [filters, setFilters] = useState(() => readFilters(key));
  const change = (next: BoardsFilters) => {
    setFilters(next);
    writeStorage(
      key,
      next.places.length > 0 || next.assignee ? JSON.stringify(next) : null
    );
  };
  return [filters, change];
}

interface PlaceFilterProps {
  /** The cards before these filters, for the counts. */
  cards: SprintCard[];
  boards: Board[];
  projects: Project[];
  places: string[];
  onChange: (places: string[]) => void;
}

function PlaceFilter({
  cards,
  boards,
  projects,
  places,
  onChange,
}: PlaceFilterProps) {
  const projectAddresses = new Set(projects.map((project) => project.address));
  const pickedProjects = places.filter((place) => projectAddresses.has(place));
  const pickedBoards = places.filter((place) => !projectAddresses.has(place));
  const counted = cards.map((item) => ({ board: item.scope.board }));
  return (
    <FilterPopover
      active={
        [pickedProjects, pickedBoards].filter((picked) => picked.length > 0)
          .length
      }
      onClear={() => onChange([])}
    >
      <FilterGroup
        label="Project"
        onChange={(next) => onChange([...next, ...pickedBoards])}
        options={shown(projectOptions(counted, projects), pickedProjects)}
        value={pickedProjects}
      />
      <FilterGroup
        label="Board"
        onChange={(next) => onChange([...pickedProjects, ...next])}
        options={shown(boardOptions(counted, boards), pickedBoards)}
        value={pickedBoards}
      />
    </FilterPopover>
  );
}

interface BoardsPageProps {
  boards: Board[];
  projects: Project[];
  pubkey: string;
  /** Whether the boards and projects have loaded. */
  loaded: boolean;
}

/** One board of every board's active sprint. */
export function BoardsPage({
  boards,
  projects,
  pubkey,
  loaded,
}: BoardsPageProps) {
  const { contents, loaded: cardsLoaded } = useBoardContents(boards);
  const [filters, setFilters] = useFilters(pubkey);
  const [layout, setLayout] = useLayout(`boards:${pubkey}:layout`);
  // Kept after closing so the dialog keeps its content while it animates out.
  const [adding, setAdding] = useState<{
    open: boolean;
    defaults: NewCardDefaults;
  }>();
  const lastBoardKey = `boards:${pubkey}:new-card`;

  const known = new Set([...boards, ...projects].map((place) => place.address));
  // Until the boards and projects load, none would count as known.
  const places = new Set(
    loaded ? filters.places.filter((place) => known.has(place)) : filters.places
  );
  const inPlaces = (board: Board) =>
    places.size === 0 ||
    placesOf(board, projects).some((place) => places.has(place));
  const { assignee } = filters;

  const scopes = boards.flatMap((board): BoardScope[] => {
    const content = contents?.get(board.address);
    if (!content) {
      return [];
    }
    const query = boardQuery(board, boards);
    return [
      {
        board,
        boardQuery: query,
        canEdit: canEdit(board, pubkey),
        cardHref: (card) =>
          cardPath(board, card, { query, withId: needsCardId(content, card) }),
        cards: content.cards,
        content,
        layout,
        // Cards are added from the columns, where the board can be picked.
        newCard: () => {
          // Nothing to open.
        },
        pubkey,
      },
    ];
  });
  const inView = scopes.filter((scope) => inPlaces(scope.board));
  // The boards a card can be added to from here.
  const choices = inView.filter((scope) => scope.canEdit);
  const sprinting = inView.filter((scope) => activeSprint(scope.content));

  const newCard = (status: Status) => {
    const last = readStorage(lastBoardKey);
    // Boards that use the status and have a sprint for the card to show up in.
    const fitting = choices.filter(
      (scope) =>
        scope.board.statuses.includes(status) && activeSprint(scope.content)
    );
    const start =
      fitting.find((scope) => scope.board.address === last) ?? fitting[0];
    setAdding({
      defaults: {
        assignees: assignee ? [assignee] : [],
        board: start?.board.address,
        status,
      },
      open: true,
    });
  };

  const all = sprintCards(scopes);
  const assigned = assignee
    ? all.filter((item) => item.card.assignees.includes(assignee))
    : all;
  const cards = assigned.filter((item) => inPlaces(item.scope.board));
  // Only people with a card here, so the filter never empties the board.
  const people = [
    ...new Set([pubkey, ...inView.flatMap((scope) => scope.board.members)]),
  ].filter(
    (person) =>
      person === assignee ||
      all.some(
        (item) =>
          inPlaces(item.scope.board) && item.card.assignees.includes(person)
      )
  );
  const statuses = new Set(sprinting.flatMap((scope) => scope.board.statuses));
  const adds = new Set(
    STATUSES.flatMap(({ id }) =>
      !isClosed(id) &&
      choices.some((scope) => scope.board.statuses.includes(id))
        ? [id]
        : []
    )
  );

  const ready = loaded && (cardsLoaded || all.length > 0);
  const fitsScreen = layout === "kanban" && sprinting.length > 0;

  let body: ReactNode;
  if (!ready) {
    body = <BoardSkeleton list={layout === "list"} />;
  } else if (sprinting.length === 0) {
    body = (
      <Empty>
        <EmptyTitle>
          {boards.length === 0 ? "No boards" : "No active sprints"}
        </EmptyTitle>
      </Empty>
    );
  } else if (layout === "kanban") {
    body = (
      <SprintKanban
        adds={adds}
        cards={cards}
        onAdd={newCard}
        statuses={statuses}
      />
    );
  } else {
    body = (
      <SprintList
        adds={adds}
        cards={cards}
        foldedKey={`boards:${pubkey}:folded`}
        onAdd={newCard}
      />
    );
  }

  return (
    <>
      <TopBar
        crumbs={[
          {
            icon: (
              <KanbanIcon className="text-muted-foreground size-4 shrink-0" />
            ),
            label: "Boards",
          },
        ]}
      />
      <main
        className={cn(
          "flex grow flex-col gap-4 px-4 sm:px-6",
          fitsScreen ? "h-[calc(100dvh-3.5rem)] min-h-96 pb-4" : "pb-8"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PlaceFilter
            boards={boards}
            cards={assigned}
            onChange={(next) => setFilters({ ...filters, places: next })}
            places={[...places]}
            projects={projects}
          />
          <div className="flex items-center gap-2">
            <AssigneeFilter
              members={people}
              onChange={(next) => setFilters({ ...filters, assignee: next })}
              value={assignee}
            />
            <FluidTooltip.Group>
              <LayoutSwitch onChange={setLayout} value={layout} />
            </FluidTooltip.Group>
          </div>
        </div>
        {body}
      </main>
      {adding && choices.length > 0 && (
        <NewCardDialog
          choice={{
            onPick: (board) => writeStorage(lastBoardKey, board.address),
            scopes: choices,
          }}
          defaults={adding.defaults}
          onOpenChange={(open) => setAdding({ ...adding, open })}
          open={adding.open}
        />
      )}
    </>
  );
}
