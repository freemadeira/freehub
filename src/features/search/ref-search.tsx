import { useEffect, useEffectEvent } from "react";

import type { RefOption, RefSearchProps } from "@/components/ref-options";
import { useFound, useSearchIndex } from "@/features/search/use-found";
import { useSettled } from "@/hooks/use-settled";
import { matchScore, searchTerms } from "@/lib/search";

/** How long typing rests before the words are searched. */
const SEARCH_DELAY = 150;
/** Longest search after `#`; writing on past it isn't looking for something. */
const MAX_QUERY = 40;
const MAX_OPTIONS = 8;

/**
 * What the app has whose title has the words typed after `#`: catalog
 * links, cards, doc pages, Drive files and CRM records, in the project when
 * there is one. Searched as typing settles, best matches first.
 */
function useRefOptions(query: string, project?: string): RefOption[] {
  const typed = query.length > MAX_QUERY ? "" : query;
  const settled = useSettled(typed, SEARCH_DELAY);
  const { index } = useSearchIndex({ comments: false });
  const terms = searchTerms(settled);
  const found = useFound(index, terms, settled, { project });
  return [
    ...found.link,
    ...found.card,
    ...found.doc,
    ...found.file,
    ...found.record,
  ]
    .flatMap((item, at) =>
      item.href
        ? [
            {
              at,
              option: {
                context: item.context,
                icon: item.icon,
                key: item.key,
                title: item.title,
                url: `${globalThis.location.origin}${item.href}`,
              },
              score: matchScore(item.title, terms),
            },
          ]
        : []
    )
    .toSorted((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, MAX_OPTIONS)
    .map(({ option }) => option);
}

/** Finds what the `#` being typed could reference, and hands it up as it changes. */
export function RefSearch({ query, project, onOptions }: RefSearchProps) {
  const options = useRefOptions(query, project);
  const keys = options.map((option) => option.key).join(",");
  const report = useEffectEvent((found: string) =>
    onOptions(found ? options : [])
  );
  useEffect(() => report(keys), [keys]);
  return null;
}
