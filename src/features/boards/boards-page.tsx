import { cn } from "cn";
import { IterationCwIcon, KanbanIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useSearchParams } from "wouter";

import { FilterGroup, FilterPopover } from "@/components/filter-popover";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssigneeFilter } from "@/features/board/assignee-filter";
import type { BoardScope } from "@/features/board/board-context";
import { boardQuery } from "@/features/board/board-context";
import { BoardSkeleton } from "@/features/board/board-page";
import { backlogGroups } from "@/features/board/card-order";
import type { BoardLayout } from "@/features/board/layout-switch";
import { LayoutSwitch, useLayout } from "@/features/board/layout-switch";
import { BoardsBacklog } from "@/features/boards/boards-backlog";
import type { BoardsTab } from "@/features/boards/boards-commands";
import {
  parseBoardsTab,
  useBoardsCommands,
} from "@/features/boards/boards-commands";
import { LanesMenu, useLanes } from "@/features/boards/lanes-menu";
import { NextSprintDialog } from "@/features/boards/next-sprint-dialog";
import type { Lane, SprintCard } from "@/features/boards/sprint-cards";
import { lanesOf, sprintCards } from "@/features/boards/sprint-cards";
import { SprintProgress } from "@/features/boards/sprint-progress";
import {
  SprintKanban,
  SprintLaneKanban,
  SprintLaneList,
  SprintList,
} from "@/features/boards/sprint-views";
import type { NewCardDefaults } from "@/features/card/new-card-dialog";
import { NewCardDialog } from "@/features/card/new-card-dialog";
import {
  boardOptions,
  projectOptions,
  shown,
  statusOptions,
} from "@/features/home/task-filters";
import { placesOf } from "@/features/home/tasks";
import { useBoardContents } from "@/hooks/use-board-contents";
import type { Board, Card, Status } from "@/lib/model";
import {
  activeSprint,
  canEdit,
  isClosed,
  needsCardId,
  STATUSES,
} from "@/lib/model";
import { cardPath } from "@/lib/paths";
import type { Project } from "@/lib/project";
import { cardFinder } from "@/lib/relations";
import { readStorage, writeStorage } from "@/lib/utils";

/** Shares the top-level path with board codes, so BOARDS is a reserved code. */
export const BOARDS_PATH = "/boards";

/** Columns hidden until shown: their cards aren't being worked on yet. */
const DEFAULT_HIDDEN: readonly Status[] = ["triage", "backlog"];

interface BoardsFilters {
  /** Addresses of projects and boards; a card in any of them shows. */
  places: string[];
  assignee?: string;
  /** Statuses whose column is hidden, or none kept for the default ones. */
  hidden?: Status[];
}

function isStatus(value: unknown): value is Status {
  return STATUSES.some(({ id }) => id === value);
}

function isDefaultHidden(hidden: readonly Status[]): boolean {
  return (
    hidden.length === DEFAULT_HIDDEN.length &&
    hidden.every((status) => DEFAULT_HIDDEN.includes(status))
  );
}

function readFilters(key: string): BoardsFilters {
  try {
    const value: unknown = JSON.parse(readStorage(key) ?? "{}");
    const { places, assignee, hidden } = (value ??
      {}) as Partial<BoardsFilters>;
    return {
      assignee: typeof assignee === "string" ? assignee : undefined,
      hidden: Array.isArray(hidden) ? hidden.filter(isStatus) : undefined,
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
      next.places.length > 0 || next.assignee || next.hidden
        ? JSON.stringify(next)
        : null
    );
  };
  return [filters, change];
}

/** A card on one of the boards, with its board. */
interface BoardCard {
  board: Board;
  card: Card;
}

/** The cards still to plan on each board: in its backlog or an upcoming sprint. */
function plannedCards(scopes: BoardScope[]): BoardCard[] {
  return scopes.flatMap(({ board, content }) => {
    const { backlog, planned } = backlogGroups(content, content.cards);
    return [...planned.values(), backlog].flat().map((card) => ({
      board,
      card,
    }));
  });
}

/**
 * Where a card added from a board's backlog goes: the sprint it was added to
 * on that board, and the backlog of any other board picked instead.
 */
function plannedOn(
  defaults: NewCardDefaults
): (scope: BoardScope) => string | undefined {
  return (scope) =>
    scope.board.address === defaults.board ? defaults.sprint : undefined;
}

interface BoardsFilterProps {
  /** The cards before the place filter, for the places' counts. */
  cards: BoardCard[];
  /** The cards in those places, for the columns' counts. */
  placeCards: BoardCard[];
  boards: Board[];
  projects: Project[];
  places: string[];
  onPlaces: (places: string[]) => void;
  /** The statuses that would get a column with none hidden; none without columns. */
  columns: Status[];
  hidden: ReadonlySet<Status>;
  /** None for the default hidden statuses. */
  onHidden: (hidden?: Status[]) => void;
  /** Clears every filter here at once. */
  onClear: () => void;
}

function BoardsFilter({
  cards,
  placeCards,
  boards,
  projects,
  places,
  onPlaces,
  columns,
  hidden,
  onHidden,
  onClear,
}: BoardsFilterProps) {
  const projectAddresses = new Set(projects.map((project) => project.address));
  const pickedProjects = places.filter((place) => projectAddresses.has(place));
  const pickedBoards = places.filter((place) => !projectAddresses.has(place));
  const visible = columns.filter((status) => !hidden.has(status));
  // Hidden columns count only where there are columns to hide.
  const hidesColumns = columns.length > 0 && !isDefaultHidden([...hidden]);

  const showColumns = (next: string[]) => {
    // Hiding every column would leave nothing to work with.
    if (next.length === 0) {
      return;
    }
    // Statuses without a column now stay as they were.
    const nextHidden = STATUSES.flatMap(({ id }) =>
      (columns.includes(id) ? !next.includes(id) : hidden.has(id)) ? [id] : []
    );
    onHidden(isDefaultHidden(nextHidden) ? undefined : nextHidden);
  };

  return (
    <FilterPopover
      active={
        [pickedProjects, pickedBoards].filter((picked) => picked.length > 0)
          .length + (hidesColumns ? 1 : 0)
      }
      onClear={onClear}
    >
      <FilterGroup
        label="Project"
        onChange={(next) => onPlaces([...next, ...pickedBoards])}
        options={shown(projectOptions(cards, projects), pickedProjects)}
        value={pickedProjects}
      />
      <FilterGroup
        label="Board"
        onChange={(next) => onPlaces([...pickedProjects, ...next])}
        options={shown(boardOptions(cards, boards), pickedBoards)}
        value={pickedBoards}
      />
      <FilterGroup
        label="Columns"
        onChange={showColumns}
        options={statusOptions(placeCards).filter((option) =>
          columns.some((status) => status === option.value)
        )}
        value={visible}
      />
    </FilterPopover>
  );
}

interface SprintTabProps {
  ready: boolean;
  boards: Board[];
  /** The boards in view with a sprint running. */
  sprinting: BoardScope[];
  layout: BoardLayout;
  cards: SprintCard[];
  /** The rows the cards split into; none keeps them together. */
  lanes: Lane[];
  /** The statuses with a column. */
  statuses: ReadonlySet<Status>;
  adds: ReadonlySet<Status>;
  onAdd: (status: Status) => void;
  /** Where the list's folded statuses are remembered on this device. */
  foldedKey: string;
  /** Opens the next sprint dialog, for those who can start a sprint. */
  onStartSprints?: () => void;
}

/** Every board's running sprint: how each is going, then their cards. */
function SprintTab({
  ready,
  boards,
  sprinting,
  layout,
  cards,
  lanes,
  statuses,
  adds,
  onAdd,
  foldedKey,
  onStartSprints,
}: SprintTabProps) {
  if (!ready) {
    return <BoardSkeleton list={layout === "list"} />;
  }
  if (sprinting.length === 0) {
    return (
      <Empty>
        <EmptyTitle>
          {boards.length === 0 ? "No boards" : "No active sprints"}
        </EmptyTitle>
        {onStartSprints && (
          <Button onClick={onStartSprints}>Start sprints</Button>
        )}
      </Empty>
    );
  }
  let body: ReactNode;
  if (layout === "list") {
    body =
      lanes.length > 0 ? (
        <SprintLaneList
          adds={adds}
          foldedKey={foldedKey}
          lanes={lanes}
          onAdd={onAdd}
        />
      ) : (
        <SprintList
          adds={adds}
          cards={cards}
          foldedKey={foldedKey}
          onAdd={onAdd}
        />
      );
  } else {
    body =
      lanes.length > 0 ? (
        <SprintLaneKanban
          adds={adds}
          cards={cards}
          lanes={lanes}
          onAdd={onAdd}
          statuses={statuses}
        />
      ) : (
        <SprintKanban
          adds={adds}
          cards={cards}
          onAdd={onAdd}
          statuses={statuses}
        />
      );
  }
  return (
    <>
      <SprintProgress boards={boards} scopes={sprinting} />
      {body}
    </>
  );
}

interface BoardsPageProps {
  boards: Board[];
  projects: Project[];
  pubkey: string;
  /** Whether the boards and projects have loaded. */
  loaded: boolean;
}

/**
 * Every board's active sprint as one board, and every board's backlog and
 * upcoming sprints, to plan them in one sitting.
 */
export function BoardsPage({
  boards,
  projects,
  pubkey,
  loaded,
}: BoardsPageProps) {
  const { contents, loaded: cardsLoaded } = useBoardContents(boards);
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useFilters(pubkey);
  const [layout, setLayout] = useLayout(`boards:${pubkey}:layout`);
  const [laneKind, setLaneKind] = useLanes(`boards:${pubkey}:lanes`);
  // Kept after closing so the dialog keeps its content while it animates out.
  const [adding, setAdding] = useState<{
    open: boolean;
    defaults: NewCardDefaults;
    /** Added from a board's backlog, so it goes where it was added. */
    planning?: boolean;
  }>();
  const lastBoardKey = `boards:${pubkey}:new-card`;
  const [nextSprint, setNextSprint] = useState(false);

  const tab = parseBoardsTab(params.get("tab"));
  const showTab = (next: BoardsTab) => {
    const query = new URLSearchParams(params);
    if (next === "sprint") {
      query.delete("tab");
    } else {
      query.set("tab", next);
    }
    setParams(query);
  };

  const known = new Set([...boards, ...projects].map((place) => place.address));
  // Until the boards and projects load, none would count as known.
  const places = new Set(
    loaded ? filters.places.filter((place) => known.has(place)) : filters.places
  );
  const inPlaces = (board: Board) =>
    places.size === 0 ||
    placesOf(board, projects).some((place) => places.has(place));
  const { assignee } = filters;
  const isAssigned = (card: Card) =>
    assignee === undefined || card.assignees.includes(assignee);

  // Every board here has its cards loaded, those its cards are related to too.
  const findCard = cardFinder(boards, contents);
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
        findCard,
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
  // Each board as its own backlog tab shows it, its cards opening from there.
  const planning = inView.map((scope): BoardScope => {
    const { board, content } = scope;
    const query = new URLSearchParams(scope.boardQuery);
    query.set("tab", "backlog");
    return {
      ...scope,
      cardHref: (card) =>
        cardPath(board, card, { query, withId: needsCardId(content, card) }),
      cards: content.cards.filter(isAssigned),
      newCard: (placement) =>
        setAdding({
          defaults: {
            ...placement,
            assignees: assignee ? [assignee] : [],
            board: board.address,
          },
          open: true,
          planning: true,
        }),
    };
  });

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
  const placeCards = all.filter(
    (item) => isAssigned(item.card) && inPlaces(item.scope.board)
  );
  const hidden = new Set(filters.hidden ?? DEFAULT_HIDDEN);
  const cards = placeCards.filter((item) => !hidden.has(item.card.status));
  // The cards the tab can show, before the place and assignee filters.
  const tabCards: BoardCard[] =
    tab === "sprint"
      ? all.flatMap(({ scope, card }) =>
          hidden.has(card.status) ? [] : [{ board: scope.board, card }]
        )
      : plannedCards(scopes);
  // Only people with a card here, so the filter never empties the tab.
  const people = [
    ...new Set([pubkey, ...inView.flatMap((scope) => scope.board.members)]),
  ].filter(
    (person) =>
      person === assignee ||
      tabCards.some(
        (item) => inPlaces(item.board) && item.card.assignees.includes(person)
      )
  );
  const lanes = lanesOf(laneKind, cards, people);
  // A column per status the boards use, and any other while cards are in it.
  const used = new Set(sprinting.flatMap((scope) => scope.board.statuses));
  const columns = STATUSES.flatMap(({ id }) =>
    used.has(id) || placeCards.some((item) => item.card.status === id)
      ? [id]
      : []
  );
  const statuses = new Set(columns.filter((status) => !hidden.has(status)));
  const adds = new Set(
    STATUSES.flatMap(({ id }) =>
      !isClosed(id) &&
      choices.some((scope) => scope.board.statuses.includes(id))
        ? [id]
        : []
    )
  );

  const startSprints =
    choices.length > 0 ? () => setNextSprint(true) : undefined;
  // Steps the assignee filter through everyone, then each person in turn.
  const stepPerson = (step: 1 | -1) => {
    const order = [undefined, ...people];
    const at = Math.max(order.indexOf(assignee), 0);
    setFilters({
      ...filters,
      assignee: order[(at + step + order.length) % order.length],
    });
  };
  useBoardsCommands({
    layout,
    onLayout: setLayout,
    onNextSprint: startSprints,
    onPerson: people.length > 1 ? stepPerson : undefined,
    onTab: showTab,
    tab,
  });

  const ready = loaded && (cardsLoaded || all.length > 0);
  // The kanban fills the screen under the 3.5rem top bar, so its columns
  // scroll on their own and the page stays put. Lists scroll the page.
  const fitsScreen =
    tab === "sprint" && layout === "kanban" && sprinting.length > 0;

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
          "flex grow flex-col px-4 sm:px-6",
          fitsScreen ? "h-[calc(100dvh-3.5rem)] min-h-96 pb-4" : "pb-8"
        )}
      >
        <Tabs
          className="min-h-0 grow gap-4"
          onValueChange={(value) => showTab(parseBoardsTab(String(value)))}
          value={tab}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <TabsList>
                <TabsTrigger value="backlog">Backlog</TabsTrigger>
                <TabsTrigger value="sprint">Sprint</TabsTrigger>
              </TabsList>
              <BoardsFilter
                boards={boards}
                cards={tabCards.filter((item) => isAssigned(item.card))}
                columns={tab === "sprint" ? columns : []}
                hidden={hidden}
                onClear={() =>
                  setFilters({
                    ...filters,
                    // Columns hidden on the sprint tab stay so on the backlog's.
                    hidden: tab === "sprint" ? undefined : filters.hidden,
                    places: [],
                  })
                }
                onHidden={(next) => setFilters({ ...filters, hidden: next })}
                onPlaces={(next) => setFilters({ ...filters, places: next })}
                placeCards={placeCards.map(({ scope, card }) => ({
                  board: scope.board,
                  card,
                }))}
                places={[...places]}
                projects={projects}
              />
              {ready && startSprints && (
                <Button onClick={startSprints} variant="outline">
                  <IterationCwIcon />
                  Next sprint
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <AssigneeFilter
                members={people}
                onChange={(next) => setFilters({ ...filters, assignee: next })}
                value={assignee}
              />
              {tab === "sprint" && (
                <FluidTooltip.Group>
                  <LanesMenu onChange={setLaneKind} value={laneKind} />
                  <LayoutSwitch onChange={setLayout} value={layout} />
                </FluidTooltip.Group>
              )}
            </div>
          </div>
          <TabsContent className="flex flex-col" value="backlog">
            {ready ? (
              <BoardsBacklog
                foldedKey={`boards:${pubkey}:folded-boards`}
                scopes={planning}
              />
            ) : (
              <BoardSkeleton list />
            )}
          </TabsContent>
          <TabsContent className="flex min-h-0 flex-col gap-3" value="sprint">
            <SprintTab
              adds={adds}
              boards={boards}
              cards={cards}
              foldedKey={`boards:${pubkey}:folded`}
              lanes={lanes}
              layout={layout}
              onAdd={newCard}
              onStartSprints={startSprints}
              ready={ready}
              sprinting={sprinting}
              statuses={statuses}
            />
          </TabsContent>
        </Tabs>
      </main>
      <NextSprintDialog
        filtered={assignee !== undefined}
        onOpenChange={setNextSprint}
        open={nextSprint}
        scopes={choices}
      />
      {adding && choices.length > 0 && (
        <NewCardDialog
          choice={{
            onPick: (board) => writeStorage(lastBoardKey, board.address),
            scopes: choices,
            sprintOn: adding.planning ? plannedOn(adding.defaults) : undefined,
          }}
          defaults={adding.defaults}
          onOpenChange={(open) => setAdding({ ...adding, open })}
          open={adding.open}
        />
      )}
    </>
  );
}
