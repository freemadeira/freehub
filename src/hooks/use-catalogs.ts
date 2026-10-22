import { getTagValue } from "applesauce-core/helpers/event";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { map, of } from "rxjs";

import { useCommentsOn } from "@/hooks/use-comments";
import { useObservableValue } from "@/hooks/use-observable-value";
import { catalogReaders } from "@/lib/catalog-actions";
import type { CatalogsDoc } from "@/lib/catalog-marks";
import { NO_CATALOG_MARKS } from "@/lib/catalog-marks";
import { catalogStore } from "@/lib/catalog-store";
import type { CatalogsContent } from "@/lib/catalogs";
import { resolveCatalogs } from "@/lib/catalogs";
import type { Comment } from "@/lib/model";
import { CATALOG_KIND, LINK_KIND, READING_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { addressFilters, sync, whileLoading } from "@/lib/relays";

const KINDS = [CATALOG_KIND, LINK_KIND, READING_KIND];
const NO_CONTENTS = new Map<string, CatalogsContent>();

/** The catalogs and links of every project, keyed by project address. */
export function useCatalogs(projects: Project[]): {
  catalogs: Map<string, CatalogsContent>;
  loaded: boolean;
} {
  const addresses = projects.map((project) => project.address);
  const key = projects.map((project) => project.event.id).join(",");
  const readers = catalogReaders();
  // Readings are by the reader, who's no member: asked for too where projects go by author.
  const authors = [
    ...new Set([...projects.flatMap((project) => project.members), ...readers]),
  ];
  const filters = [{ "#a": addresses, kinds: KINDS }];
  const feed = () =>
    addresses.length > 0
      ? sync(addressFilters("#a", addresses, { kinds: KINDS }, authors))
      : of(true);
  const loaded = useObservableValue(feed, [key]);
  const catalogs = useObservableValue(
    () =>
      addresses.length > 0
        ? whileLoading(eventStore.timeline(filters), feed()).pipe(
            map(
              (events) =>
                new Map(
                  projects.map((project) => [
                    project.address,
                    resolveCatalogs(project, events, readers),
                  ])
                )
            )
          )
        : of(NO_CONTENTS),
    [key]
  );
  return { catalogs: catalogs ?? NO_CONTENTS, loaded: loaded ?? false };
}

/** What the person starred in catalogs, and which links they've seen. */
export function useCatalogMarks(pubkey: string): CatalogsDoc {
  return (
    useObservableValue(() => catalogStore(pubkey).marks$, [pubkey]) ??
    NO_CATALOG_MARKS
  );
}

/** Which link, by its `d` tag, a comment is on, and whose version it names. */
export function commentedLink(
  comment: Comment
): { id: string; author: string } | undefined {
  const root = parseReplaceableAddress(getTagValue(comment.event, "A") ?? "");
  return root?.kind === LINK_KIND
    ? { author: root.pubkey, id: root.identifier }
    : undefined;
}

/**
 * Comments on the project's links, by link id, oldest first. Comments name
 * their link, not its project, so they're asked for by author and matched to
 * the project's links afterwards.
 */
export function useLinkComments(
  project: Project,
  linkIds: ReadonlySet<string>
): ReadonlyMap<string, Comment[]> {
  const { members } = project;
  const { comments } = useCommentsOn(LINK_KIND, members);
  const byLink = new Map<string, Comment[]>();
  for (const comment of comments.toReversed()) {
    const on = commentedLink(comment);
    // Only on the project's links, and by its members, as with everything in it.
    if (
      on &&
      linkIds.has(on.id) &&
      members.includes(on.author) &&
      members.includes(comment.author)
    ) {
      byLink.set(on.id, [...(byLink.get(on.id) ?? []), comment]);
    }
  }
  return byLink;
}
