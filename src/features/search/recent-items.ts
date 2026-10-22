import type { SearchItem } from "@/features/search/search-item";
import type { SearchIndex } from "@/features/search/use-found";
import { useRecents } from "@/lib/recents";

/** How many places opened lately show. */
const SHOWN = 12;

/** The places opened lately, as items to open; places since gone drop out. */
export function useRecentItems(
  pubkey: string,
  places: SearchItem[],
  index: SearchIndex
): SearchItem[] {
  const { places: recents } = useRecents(pubkey);
  const byKey = new Map(places.map((place) => [place.key, place]));
  return recents
    .flatMap(({ kind, id }) => {
      const key = `${kind}:${id}`;
      const item = byKey.get(key) ?? index.byKey.get(key);
      return item ? [item] : [];
    })
    .slice(0, SHOWN);
}
