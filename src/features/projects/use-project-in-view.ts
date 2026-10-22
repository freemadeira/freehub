import { useLocation } from "wouter";

import { usePlaces } from "@/components/app-link";
import { useOpenBoard } from "@/features/board/board-context";
import type { Project } from "@/lib/project";
import { inProject } from "@/lib/project";

/** The project the page is in: one of its own pages, or one of its boards. */
export function useProjectInView(): Project | undefined {
  const [location] = useLocation();
  const { boards, projects } = usePlaces();
  const board = useOpenBoard(boards);
  const [, root, slug] = location.split("/");
  if (root === "p") {
    return projects.find((project) => project.slug === slug);
  }
  return board && projects.find((project) => inProject(board, project));
}
