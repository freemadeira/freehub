import {
  BookmarkIcon,
  BookOpenTextIcon,
  HardDriveIcon,
  HouseIcon,
  InboxIcon,
  KanbanIcon,
  MapIcon,
  SquareKanbanIcon,
} from "lucide-react";

import { usePlaces } from "@/components/app-link";
import { ProjectAvatar } from "@/components/project-avatar";
import { getConfig } from "@/config";
import { boardPath } from "@/features/board/board-context";
import { BOARDS_PATH } from "@/features/boards/boards-page";
import { catalogPath } from "@/features/catalogs/catalogs-context";
import { TableIcon } from "@/features/crm/table-icon";
import { docsPath } from "@/features/docs/docs-context";
import { drivePath } from "@/features/drive/drive-context";
import { FolderIcon } from "@/features/drive/file-icon";
import { INBOX_PATH } from "@/features/inbox/inbox-page";
import { MAP_PATH } from "@/features/map/map-path";
import type { SearchItem } from "@/features/search/search-item";
import { ICON } from "@/features/search/search-item";
import type { Board } from "@/lib/model";
import { tablePath } from "@/lib/paths";
import type { Project } from "@/lib/project";
import { inProject, outsideProjects } from "@/lib/project";
import { matchScore } from "@/lib/search";
import { SHORTCUTS } from "@/lib/shortcuts";

function boardItem(board: Board, boards: Board[], where?: string): SearchItem {
  return {
    context: where ? `${board.code} · ${where}` : board.code,
    href: boardPath(board, boards),
    icon: <SquareKanbanIcon className={ICON} />,
    key: `board:${board.address}`,
    project: board.project,
    title: board.title,
  };
}

/** The app's own pages, then every project and the places in it, as the sidebar lists them. */
export function usePlaceItems(): SearchItem[] {
  const { boards, catalogs, drive, projects, tables } = usePlaces();
  const pages: SearchItem[] = [
    {
      href: "/",
      icon: <HouseIcon className={ICON} />,
      key: "home",
      keys: SHORTCUTS["go.home"],
      title: "Home",
    },
    {
      href: BOARDS_PATH,
      icon: <KanbanIcon className={ICON} />,
      key: "boards",
      keywords: "sprints kanban all cards",
      title: "Boards",
    },
  ];
  if (getConfig().map) {
    pages.push({
      href: MAP_PATH,
      icon: <MapIcon className={ICON} />,
      key: "map",
      keys: SHORTCUTS["go.map"],
      title: "Map",
    });
  }
  pages.push({
    href: INBOX_PATH,
    icon: <InboxIcon className={ICON} />,
    key: "inbox",
    keys: SHORTCUTS["go.inbox"],
    title: "Inbox",
  });

  const inside = (project: Project): SearchItem[] => {
    const { address, title: where } = project;
    const items: SearchItem[] = [
      {
        context: "Project",
        href: `/p/${project.slug}`,
        icon: <ProjectAvatar project={project} />,
        key: `project:${address}`,
        project: address,
        title: project.title,
      },
    ];
    for (const table of tables.get(address) ?? []) {
      items.push({
        context: where,
        href: tablePath(project, table),
        icon: <TableIcon className={ICON} icon={table.icon} />,
        key: `table:${table.address}`,
        project: address,
        title: table.title,
      });
    }
    for (const board of boards) {
      if (inProject(board, project)) {
        items.push(boardItem(board, boards, where));
      }
    }
    for (const catalog of catalogs.get(address)?.catalogs ?? []) {
      items.push({
        context: where,
        href: catalogPath(project, catalog),
        icon: <BookmarkIcon className={ICON} />,
        key: `catalog:${address}/${catalog.id}`,
        keywords: "links catalog bookmarks",
        project: address,
        title: catalog.title,
      });
    }
    items.push({
      context: where,
      href: docsPath(project),
      icon: <BookOpenTextIcon className={ICON} />,
      key: `docs:${address}`,
      keywords: "pages",
      project: address,
      title: "Docs",
    });
    if (drive) {
      items.push({
        context: where,
        href: drivePath(project),
        icon: <HardDriveIcon className={ICON} />,
        key: `drive:${address}`,
        keywords: "files",
        project: address,
        title: "Drive",
      });
      for (const folder of drive.get(address)?.folders ?? []) {
        items.push({
          context: `Drive · ${where}`,
          href: drivePath(project, folder),
          icon: <FolderIcon folder={folder} size="sm" />,
          key: `folder:${address}/${folder.id}`,
          project: address,
          title: folder.name,
        });
      }
    }
    return items;
  };

  return [
    ...pages,
    ...projects.flatMap(inside),
    ...outsideProjects(boards, projects).map((board) =>
      boardItem(board, boards)
    ),
  ];
}

/**
 * The items that have every word searched for, best first: those whose
 * title matches, then those whose title, context and other words do
 * together. Ties keep the items' own order.
 */
export function matching<
  Item extends Pick<SearchItem, "title" | "context" | "keywords">,
>(items: Item[], terms: string[]): Item[] {
  return items
    .map((item, index) => {
      const byTitle = matchScore(item.title, terms);
      const withContext = matchScore(
        `${item.title} ${item.context ?? ""} ${item.keywords ?? ""}`,
        terms
      );
      return {
        index,
        item,
        score: byTitle > 0 ? byTitle + 1 : Math.min(withContext, 1),
      };
    })
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}

/** The items, each once: the first of any that share a key. */
export function distinct(items: SearchItem[]): SearchItem[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.key) && seen.add(item.key));
}
