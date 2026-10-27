import { CalendarDaysIcon, ListIcon } from "lucide-react";
import type { ReactNode } from "react";

import { IconSwitch } from "@/components/icon-switch";
import { Section } from "@/components/page-section";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { boardScopes } from "@/features/home/board-scopes";
import { useHome } from "@/features/home/home-context";
import { TaskCalendar } from "@/features/home/task-calendar";
import { TaskFilterButton } from "@/features/home/task-filters";
import { TaskList } from "@/features/home/task-list";
import {
  activeFilters,
  filterTasks,
  inScope,
  liveFilters,
} from "@/features/home/tasks";
import { useMyCards } from "@/hooks/use-my-cards";
import type { TaskFilters, TaskScope } from "@/lib/home";
import { NO_FILTERS } from "@/lib/home";
import type { Board } from "@/lib/model";
import type { Project } from "@/lib/project";

const SCOPES: readonly { value: TaskScope; label: string; empty: string }[] = [
  {
    empty: "Cards assigned to you or made by you show up here.",
    label: "All",
    value: "all",
  },
  {
    empty: "Cards assigned to you show up here.",
    label: "Assigned",
    value: "assigned",
  },
  { empty: "Cards you make show up here.", label: "Created", value: "created" },
];

const VIEWS = [
  { icon: ListIcon, label: "List", value: "list" },
  { icon: CalendarDaysIcon, label: "Calendar", value: "calendar" },
] as const;

interface MyTasksProps {
  boards: Board[];
  projects: Project[];
  pubkey: string;
  /** Whether the boards and projects have loaded. */
  loaded: boolean;
}

/** The person's open cards across every board, as a list by due date or on a calendar. */
export function MyTasks({ boards, projects, pubkey, loaded }: MyTasksProps) {
  const { prefs, set } = useHome();
  const mine = useMyCards(boards, pubkey);
  const known = new Set([...boards, ...projects].map((place) => place.address));
  // Until the boards and projects load, none would count as known.
  const filters = loaded ? liveFilters(prefs.filters, known) : prefs.filters;
  const tasks = filterTasks(mine.cards, filters, projects);
  const scopes = boardScopes(mine.cards, boards, pubkey, mine.findCard);
  const setFilters = (next: TaskFilters) => set("filters", next);

  let body: ReactNode;
  if (mine.cards.length === 0 && !(loaded && mine.loaded)) {
    body = (
      <div aria-busy className="flex flex-col gap-3">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );
  } else if (prefs.view === "calendar") {
    body = <TaskCalendar scopes={scopes} tasks={tasks} />;
  } else if (tasks.length > 0) {
    body = <TaskList scopes={scopes} tasks={tasks} />;
  } else {
    body = (
      <Empty className="bg-muted/60 rounded-2xl py-10">
        <EmptyDescription className="mt-0">
          {activeFilters(filters) > 0
            ? "No cards match these filters."
            : SCOPES.find((scope) => scope.value === filters.scope)?.empty}
        </EmptyDescription>
        {activeFilters(filters) > 0 && (
          <Button
            onClick={() => setFilters({ ...NO_FILTERS, scope: filters.scope })}
            variant="outline"
          >
            Clear filters
          </Button>
        )}
      </Empty>
    );
  }

  return (
    <Section title="My tasks">
      <Tabs
        className="gap-4"
        onValueChange={(scope: TaskScope) =>
          setFilters({ ...prefs.filters, scope })
        }
        value={filters.scope}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            {SCOPES.map(({ value, label }) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-2">
            <TaskFilterButton
              boards={boards}
              cards={inScope(mine.cards, filters)}
              filters={filters}
              onChange={setFilters}
              projects={projects}
            />
            <FluidTooltip.Group>
              <IconSwitch
                choices={VIEWS}
                label="View"
                onChange={(view) => set("view", view)}
                value={prefs.view}
              />
            </FluidTooltip.Group>
          </div>
        </div>
        <TabsContent value={filters.scope}>{body}</TabsContent>
      </Tabs>
    </Section>
  );
}
