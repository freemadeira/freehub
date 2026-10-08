import { addDays, format } from "date-fns";

import type {
  Board,
  BoardContent,
  Card,
  CardFields,
  Comment,
  Sprint,
  SprintFields,
} from "@/lib/model";
import {
  boardTemplate,
  cardTemplate,
  commentTemplate,
  deleteBoardTemplate,
  deleteCommentTemplate,
  isClosed,
  newId,
  sprintTemplate,
  statusKind,
  tombstoneTemplate,
  upcomingSprint,
} from "@/lib/model";
import type { Project, ProjectFields } from "@/lib/project";
import { deleteProjectTemplate, projectTemplate } from "@/lib/project";
import { publish } from "@/lib/publish";

const SPRINT_DAYS = 15;

export type BoardDraft = Pick<
  Board,
  "code" | "title" | "description" | "members" | "viewers" | "project"
>;
export type ProjectDraft = Omit<ProjectFields, "id" | "creator">;
export type NewCard = Pick<CardFields, "title" | "status" | "rank"> &
  Partial<CardFields>;

function day(offset = 0): string {
  return format(addDays(new Date(), offset), "yyyy-MM-dd");
}

export function createBoard(
  creator: string,
  draft: BoardDraft
): Promise<boolean> {
  return publish(boardTemplate({ ...draft, creator, id: newId() }));
}

export function updateBoard(
  board: Board,
  changes: Partial<BoardDraft>
): Promise<boolean> {
  return publish(boardTemplate({ ...board, ...changes }), board.event);
}

export function deleteBoard(board: Board): Promise<boolean> {
  return publish(deleteBoardTemplate(board));
}

export function createProject(
  creator: string,
  draft: ProjectDraft
): Promise<boolean> {
  return publish(projectTemplate({ ...draft, creator, id: newId() }));
}

export function updateProject(
  project: Project,
  changes: Partial<ProjectDraft>
): Promise<boolean> {
  return publish(projectTemplate({ ...project, ...changes }), project.event);
}

export function deleteProject(project: Project): Promise<boolean> {
  return publish(deleteProjectTemplate(project));
}

export function createCard(
  board: Board,
  content: BoardContent,
  card: NewCard
): Promise<boolean> {
  return publish(
    cardTemplate(board, {
      assignees: [],
      description: "",
      labels: [],
      ...card,
      id: newId(),
      number: content.nextNumber,
    })
  );
}

export function updateCard(
  board: Board,
  card: Card,
  changes: Partial<CardFields>
): Promise<boolean> {
  return publish(cardTemplate(board, { ...card, ...changes }), card.event);
}

export function deleteCard(board: Board, card: Card): Promise<boolean> {
  return publish(tombstoneTemplate(board, card), card.event);
}

function newSprint(number: number): SprintFields {
  return {
    id: newId(),
    number,
    status: "future",
    title: `Sprint ${number}`,
  };
}

export function createSprint(
  board: Board,
  content: BoardContent
): Promise<boolean> {
  return publish(sprintTemplate(board, newSprint(content.nextSprintNumber)));
}

export function updateSprint(
  board: Board,
  sprint: Sprint,
  changes: Partial<SprintFields>
): Promise<boolean> {
  return publish(
    sprintTemplate(board, { ...sprint, ...changes }),
    sprint.event
  );
}

export function startSprint(
  board: Board,
  sprint: Sprint | undefined,
  content: BoardContent
): Promise<boolean> {
  const dates = {
    end: day(SPRINT_DAYS),
    start: day(),
    status: "active",
  } as const;
  if (!sprint) {
    return publish(
      sprintTemplate(board, {
        ...newSprint(content.nextSprintNumber),
        ...dates,
      })
    );
  }
  return updateSprint(board, sprint, dates);
}

/**
 * Open cards roll over to the next future sprint, those under way back to todo;
 * closed cards stay with the ended one.
 */
export function endSprint(
  board: Board,
  sprint: Sprint,
  content: BoardContent
): Promise<boolean[]> {
  const unfinished = content.cards.filter(
    (card) => card.sprint === sprint.id && !isClosed(card.status)
  );
  const changes: Promise<boolean>[] = [];
  let next = upcomingSprint(content)?.id;
  if (unfinished.length > 0 && !next) {
    const created = newSprint(content.nextSprintNumber);
    next = created.id;
    changes.push(publish(sprintTemplate(board, created)));
  }
  for (const card of unfinished) {
    changes.push(
      updateCard(board, card, {
        sprint: next,
        ...(statusKind(card.status) === "started" ? { status: "todo" } : {}),
      })
    );
  }
  changes.push(updateSprint(board, sprint, { status: "ended" }));
  return Promise.all(changes);
}

export function deleteSprint(
  board: Board,
  sprint: Sprint,
  content: BoardContent
): Promise<boolean[]> {
  const cards = content.cards.filter((card) => card.sprint === sprint.id);
  return Promise.all([
    ...cards.map((card) => updateCard(board, card, { sprint: undefined })),
    publish(tombstoneTemplate(board, sprint), sprint.event),
  ]);
}

export function addComment(card: Card, content: string): Promise<boolean> {
  return publish(commentTemplate(card, content));
}

export function deleteComment(comment: Comment): Promise<boolean> {
  return publish(deleteCommentTemplate(comment));
}
