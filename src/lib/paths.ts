/** Where things live in the app. No browser APIs here: the notifier links to them too. */
import type { CrmRecord, CrmTable } from "@/lib/crm";
import type { Board, Card } from "@/lib/model";
import { cardKey } from "@/lib/model";
import type { Project } from "@/lib/project";

/**
 * A card's path by its number. Pass `withId` when the number alone is not
 * enough: cards from clients that don't number them, or cards sharing a number.
 */
export function cardPath(
  board: Board,
  card: Card,
  { query, withId = false }: { query?: URLSearchParams; withId?: boolean } = {}
): string {
  const params = new URLSearchParams(query);
  if (withId || card.number === undefined) {
    params.set("card", card.id);
  }
  const search = params.toString();
  return `/${cardKey(board, card)}${search ? `?${search}` : ""}`;
}

export function tablePath(project: Project, table: CrmTable): string {
  return `/p/${project.slug}/${table.slug}`;
}

export function recordPath(
  project: Project,
  table: CrmTable,
  record: Pick<CrmRecord, "id">,
  query?: URLSearchParams
): string {
  const search = query?.toString();
  return `${tablePath(project, table)}/${record.id}${search ? `?${search}` : ""}`;
}
