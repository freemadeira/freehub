import type { SearchKind } from "@/lib/search";

/** Shares the top-level path with board codes, so SEARCH is a reserved code. */
export const SEARCH_PATH = "/search";

/** What a search shows everything of, or one kind of thing. */
export type SearchChip = "all" | SearchKind;

/** A search's link: the words, and the kind and project it's narrowed to. */
export function searchQuery(
  text: string,
  chip: SearchChip,
  project?: string
): URLSearchParams {
  const query = new URLSearchParams();
  if (text) {
    query.set("q", text);
  }
  if (chip !== "all") {
    query.set("in", chip);
  }
  if (project) {
    query.set("project", project);
  }
  return query;
}

/** The search page, searching everything for the words. */
export function searchHref(text: string): string {
  return `${SEARCH_PATH}?${searchQuery(text, "all")}`;
}
