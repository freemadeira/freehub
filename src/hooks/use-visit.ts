import { useEffect } from "react";

import { markVisited } from "@/lib/recents";
import type { PlaceKind } from "@/lib/search";

/** Keeps the place among the ones the user opened lately, as it opens. */
export function useVisit(
  pubkey: string,
  place: { kind: PlaceKind; id: string } | undefined
) {
  const kind = place?.kind;
  const id = place?.id;
  useEffect(() => {
    if (kind && id) {
      markVisited(pubkey, kind, id);
    }
  }, [pubkey, kind, id]);
}
