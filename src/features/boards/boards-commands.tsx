import {
  InboxIcon,
  IterationCwIcon,
  KanbanIcon,
  ListIcon,
  UserRoundIcon,
} from "lucide-react";

import type { BoardLayout } from "@/features/board/layout-switch";
import { usePageCommands } from "@/features/palette/page-commands";
import type { SearchItem } from "@/features/search/search-item";
import { useShortcuts } from "@/hooks/use-shortcut";
import { SHORTCUTS } from "@/lib/shortcuts";

const ICON = "text-muted-foreground size-4";

/** The tabs the Boards page shows every board's cards in. */
export const BOARDS_TABS = ["backlog", "sprint"] as const;

export type BoardsTab = (typeof BOARDS_TABS)[number];

export function parseBoardsTab(value: string | null): BoardsTab {
  return BOARDS_TABS.find((tab) => tab === value) ?? "sprint";
}

/**
 * The Boards page's own commands, from the palette and the keyboard: its
 * tabs, its layout, the next sprint, and stepping through people for a standup.
 */
export function useBoardsCommands({
  tab,
  layout,
  onTab,
  onLayout,
  onNextSprint,
  onPerson,
}: {
  tab: BoardsTab;
  layout: BoardLayout;
  onTab: (tab: BoardsTab) => void;
  onLayout: (layout: BoardLayout) => void;
  /** Opens the next sprint dialog, for those who can move a sprint on. */
  onNextSprint?: () => void;
  /** Shows the next person's cards, or the previous one's, while there are people to step through. */
  onPerson?: (step: 1 | -1) => void;
}) {
  useShortcuts([
    {
      enabled: onPerson !== undefined,
      keys: SHORTCUTS["boards.nextPerson"],
      run: () => onPerson?.(1),
    },
    {
      enabled: onPerson !== undefined,
      keys: SHORTCUTS["boards.previousPerson"],
      run: () => onPerson?.(-1),
    },
  ]);

  const items: SearchItem[] = [
    tab === "sprint"
      ? {
          icon: <InboxIcon className={ICON} />,
          key: "cmd:tab:backlog",
          keywords: "tab view planning plan",
          run: () => onTab("backlog"),
          title: "Show the backlogs",
        }
      : {
          icon: <IterationCwIcon className={ICON} />,
          key: "cmd:tab:sprint",
          keywords: "tab view",
          run: () => onTab("sprint"),
          title: "Show the sprints",
        },
  ];
  if (tab === "sprint") {
    items.push(
      layout === "kanban"
        ? {
            icon: <ListIcon className={ICON} />,
            key: "cmd:layout",
            keywords: "layout view",
            run: () => onLayout("list"),
            title: "Show as a list",
          }
        : {
            icon: <KanbanIcon className={ICON} />,
            key: "cmd:layout",
            keywords: "layout view columns",
            run: () => onLayout("kanban"),
            title: "Show as kanban",
          }
    );
  }
  if (onNextSprint) {
    items.push({
      icon: <IterationCwIcon className={ICON} />,
      key: "cmd:next-sprint",
      keywords: "sprints end start finish roll over every board",
      run: onNextSprint,
      title: "Start the next sprint…",
    });
  }
  if (onPerson) {
    items.push(
      {
        icon: <UserRoundIcon className={ICON} />,
        key: "cmd:next-person",
        keys: SHORTCUTS["boards.nextPerson"],
        keywords: "standup assignee filter",
        run: () => onPerson(1),
        title: "Next person",
      },
      {
        icon: <UserRoundIcon className={ICON} />,
        key: "cmd:previous-person",
        keys: SHORTCUTS["boards.previousPerson"],
        keywords: "standup assignee filter",
        run: () => onPerson(-1),
        title: "Previous person",
      }
    );
  }
  usePageCommands("Boards", items);
}
