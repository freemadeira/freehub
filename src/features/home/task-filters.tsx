import { cn } from "cn";
import { SquareKanbanIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { FilterOption } from "@/components/filter-popover";
import { FilterGroup, FilterPopover } from "@/components/filter-popover";
import { ProjectAvatar } from "@/components/project-avatar";
import { PRIORITY_STYLES, STATUS_STYLES } from "@/features/card/card-fields";
import { PriorityNoneIcon } from "@/features/card/priority-icons";
import { priorityOf } from "@/features/home/tasks";
import type { MyCard } from "@/hooks/use-my-cards";
import type { PriorityFilter, TaskFilters } from "@/lib/home";
import { NO_FILTERS } from "@/lib/home";
import type { Board, Status } from "@/lib/model";
import { PRIORITIES, STATUSES } from "@/lib/model";
import type { Project } from "@/lib/project";
import { inProject } from "@/lib/project";

function counted<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  }
  return counts;
}

/** Options that match a card, or are picked, so a picked one can be let go. */
export function shown(
  options: FilterOption[],
  picked: readonly string[]
): FilterOption[] {
  return options.filter(
    (option) => option.count > 0 || picked.includes(option.value)
  );
}

function Labelled({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function projectOptions(
  cards: Pick<MyCard, "board">[],
  projects: Project[]
): FilterOption[] {
  return projects.map((project) => ({
    count: cards.filter((item) => inProject(item.board, project)).length,
    label: (
      <Labelled icon={<ProjectAvatar project={project} />}>
        {project.title}
      </Labelled>
    ),
    value: project.address,
  }));
}

export function boardOptions(
  cards: Pick<MyCard, "board">[],
  boards: Board[]
): FilterOption[] {
  const counts = counted(cards, (item) => item.board.address);
  return boards.map((board) => ({
    count: counts.get(board.address) ?? 0,
    label: (
      <Labelled
        icon={
          <SquareKanbanIcon className="text-muted-foreground size-3.5 shrink-0" />
        }
      >
        {board.title}
      </Labelled>
    ),
    value: board.address,
  }));
}

function statusOptions(cards: MyCard[]): FilterOption[] {
  const counts = counted(cards, (item) => item.card.status);
  return STATUSES.map(({ id, label }) => {
    const { icon: Icon, className } = STATUS_STYLES[id];
    return {
      count: counts.get(id) ?? 0,
      label: (
        <Labelled
          icon={<Icon className={cn("size-3.5 shrink-0", className)} />}
        >
          {label}
        </Labelled>
      ),
      value: id,
    };
  });
}

function priorityOptions(cards: MyCard[]): FilterOption[] {
  const counts = counted(cards, priorityOf);
  return [
    ...PRIORITIES.map(({ id, label }) => {
      const { icon: Icon, className } = PRIORITY_STYLES[id];
      return {
        count: counts.get(id) ?? 0,
        label: (
          <Labelled
            icon={<Icon className={cn("size-3.5 shrink-0", className)} />}
          >
            {label}
          </Labelled>
        ),
        value: id,
      };
    }),
    {
      count: counts.get("none") ?? 0,
      label: (
        <Labelled
          icon={
            <PriorityNoneIcon className="text-muted-foreground size-3.5 shrink-0" />
          }
        >
          No priority
        </Labelled>
      ),
      value: "none",
    },
  ];
}

interface TaskFilterButtonProps {
  /** The cards in scope, before these filters, for the counts. */
  cards: MyCard[];
  boards: Board[];
  projects: Project[];
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
}

export function TaskFilterButton({
  cards,
  boards,
  projects,
  filters,
  onChange,
}: TaskFilterButtonProps) {
  const { places, statuses, priorities } = filters;
  const projectAddresses = new Set(projects.map((project) => project.address));
  const pickedProjects = places.filter((place) => projectAddresses.has(place));
  const pickedBoards = places.filter((place) => !projectAddresses.has(place));
  return (
    <FilterPopover
      active={
        [pickedProjects, pickedBoards, statuses, priorities].filter(
          (picked) => picked.length > 0
        ).length
      }
      align="end"
      onClear={() => onChange({ ...NO_FILTERS, scope: filters.scope })}
    >
      <FilterGroup
        label="Project"
        onChange={(next) =>
          onChange({ ...filters, places: [...next, ...pickedBoards] })
        }
        options={shown(projectOptions(cards, projects), pickedProjects)}
        value={pickedProjects}
      />
      <FilterGroup
        label="Board"
        onChange={(next) =>
          onChange({ ...filters, places: [...pickedProjects, ...next] })
        }
        options={shown(boardOptions(cards, boards), pickedBoards)}
        value={pickedBoards}
      />
      <FilterGroup
        label="Status"
        onChange={(next) =>
          onChange({ ...filters, statuses: next as Status[] })
        }
        options={shown(statusOptions(cards), statuses)}
        value={statuses}
      />
      <FilterGroup
        label="Priority"
        onChange={(next) =>
          onChange({ ...filters, priorities: next as PriorityFilter[] })
        }
        options={shown(priorityOptions(cards), priorities)}
        value={priorities}
      />
    </FilterPopover>
  );
}
