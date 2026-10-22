import {
  CircleCheckIcon,
  InboxIcon,
  IterationCwIcon,
  KanbanIcon,
  LinkIcon,
  ListIcon,
  Settings2Icon,
} from "lucide-react";

import { copyAndTell } from "@/components/copy";
import type { BoardTab } from "@/features/board/board-context";
import { boardPath } from "@/features/board/board-context";
import type { BoardLayout } from "@/features/board/layout-switch";
import { usePageCommands } from "@/features/palette/page-commands";
import type { SearchItem } from "@/features/search/search-item";
import type { Board } from "@/lib/model";

const ICON = "text-muted-foreground size-4";

const TABS: { tab: BoardTab; title: string; icon: typeof InboxIcon }[] = [
  { icon: InboxIcon, tab: "backlog", title: "Show the backlog" },
  { icon: IterationCwIcon, tab: "sprint", title: "Show the sprint" },
  { icon: CircleCheckIcon, tab: "done", title: "Show what's done" },
];

/**
 * What can be done to the board on screen from the command palette: its
 * tabs, its layout and its settings. An open card offers its own instead.
 */
export function useBoardCommands({
  board,
  boards,
  tab,
  layout,
  cardOpen,
  canChangeSettings,
  onTab,
  onLayout,
  onSettings,
}: {
  board: Board;
  /** Every board, to tell apart boards sharing a code in its link. */
  boards: Board[];
  tab: BoardTab;
  layout: BoardLayout;
  cardOpen: boolean;
  onTab: (tab: BoardTab) => void;
  onLayout: (layout: BoardLayout) => void;
  /** Whether the user can change the board's settings. */
  canChangeSettings: boolean;
  onSettings: () => void;
}) {
  const items: SearchItem[] = TABS.filter((item) => item.tab !== tab).map(
    (each) => ({
      icon: <each.icon className={ICON} />,
      key: `cmd:tab:${each.tab}`,
      keywords: "tab view",
      run: () => onTab(each.tab),
      title: each.title,
    })
  );
  // The sprint shows its cards in the board's layout; the other tabs are lists.
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
  items.push({
    icon: <LinkIcon className={ICON} />,
    key: "cmd:board-link",
    keywords: "url share copy",
    run: () =>
      copyAndTell(
        new URL(boardPath(board, boards), window.location.origin).href,
        "Link copied"
      ),
    title: "Copy link to board",
  });
  if (canChangeSettings) {
    items.push({
      icon: <Settings2Icon className={ICON} />,
      key: "cmd:board-settings",
      keywords: "edit rename statuses members",
      run: onSettings,
      title: "Board settings…",
    });
  }
  usePageCommands(board.title, cardOpen ? [] : items);
}
