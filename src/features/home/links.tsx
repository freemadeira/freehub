import { Link } from "wouter";

import { usePlaces } from "@/components/app-link";
import { Section } from "@/components/page-section";
import { linkPath } from "@/features/catalogs/catalogs-context";
import { LinkThumb, shortAgo } from "@/features/catalogs/link-parts";
import { hasPicture } from "@/features/catalogs/link-picture";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import { useCatalogMarks } from "@/hooks/use-catalogs";
import { isNewTo } from "@/lib/catalog-marks";
import type { Catalog, Link as SavedLink } from "@/lib/catalogs";
import type { Project } from "@/lib/project";

/** Links shown; their catalogs have the rest. */
const SHOWN = 5;

interface LatestLink {
  link: SavedLink;
  catalog: Catalog;
  project: Project;
}

/** The latest links saved to the catalogs the person can see, newest first, with those new to them marked. */
export function Links({ pubkey }: { pubkey: string }) {
  const { projects, catalogs } = usePlaces();
  const marks = useCatalogMarks(pubkey);
  const latest = projects
    .flatMap((project): LatestLink[] => {
      const content = catalogs.get(project.address);
      return (content?.links ?? []).slice(0, SHOWN).flatMap((link) => {
        const catalog = content?.byId.get(link.catalog);
        return catalog ? [{ catalog, link, project }] : [];
      });
    })
    .toSorted((a, b) => b.link.savedAt - a.link.savedAt)
    .slice(0, SHOWN);
  if (latest.length === 0) {
    return null;
  }
  return (
    <Section title="Links">
      <ul className="-mx-2 flex flex-col gap-0.5">
        {latest.map(({ link, catalog, project }) => (
          <li key={link.id}>
            <Link
              className="hover:bg-foreground/4 focus-visible:ring-ring/50 flex h-14 items-center gap-3 rounded-xl px-2 transition-colors duration-150 outline-none focus-visible:ring-3"
              draggable={false}
              href={linkPath(project, catalog, link.id)}
            >
              <span className="bg-muted relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                {hasPicture(link) ? (
                  <LinkThumb link={link} />
                ) : (
                  <PlatformIcon platform={link.platform} />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                  {link.title}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {catalog.title} · {project.title}
                </span>
              </span>
              {isNewTo(marks, catalog, link, pubkey) ? (
                <span
                  aria-label="New"
                  className="bg-primary size-2 shrink-0 rounded-full"
                />
              ) : (
                <time
                  className="text-muted-foreground shrink-0 text-xs tabular-nums"
                  dateTime={new Date(link.savedAt * 1000).toISOString()}
                >
                  {shortAgo(link.savedAt)}
                </time>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
