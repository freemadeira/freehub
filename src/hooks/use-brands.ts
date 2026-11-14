import { map, of } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { BrandsContent } from "@/lib/brands";
import { resolveBrands } from "@/lib/brands";
import { BRAND_KIND, BRAND_PART_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { addressFilters, sync, whileLoading } from "@/lib/relays";

const KINDS = [BRAND_KIND, BRAND_PART_KIND];
const NO_CONTENTS = new Map<string, BrandsContent>();

/** The brands of every project and their parts, keyed by project address. */
export function useBrands(projects: Project[]): {
  brands: Map<string, BrandsContent>;
  loaded: boolean;
} {
  const addresses = projects.map((project) => project.address);
  const key = projects.map((project) => project.event.id).join(",");
  const members = [...new Set(projects.flatMap((project) => project.members))];
  const filters = [{ "#a": addresses, kinds: KINDS }];
  const feed = () =>
    addresses.length > 0
      ? sync(addressFilters("#a", addresses, { kinds: KINDS }, members))
      : of(true);
  const loaded = useObservableValue(feed, [key]);
  const brands = useObservableValue(
    () =>
      addresses.length > 0
        ? whileLoading(eventStore.timeline(filters), feed()).pipe(
            map(
              (events) =>
                new Map(
                  projects.map((project) => [
                    project.address,
                    resolveBrands(project, events),
                  ])
                )
            )
          )
        : of(NO_CONTENTS),
    [key]
  );
  return { brands: brands ?? NO_CONTENTS, loaded: loaded ?? false };
}
