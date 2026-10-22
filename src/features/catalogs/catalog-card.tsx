import { cn } from "cn";
import { BookmarkIcon, PlusIcon } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { CARD_SURFACE } from "@/features/boards/board-card";
import { countNew } from "@/features/catalogs/catalog-context";
import { catalogPath } from "@/features/catalogs/catalogs-context";
import { LinkThumb } from "@/features/catalogs/link-parts";
import { hasPicture } from "@/features/catalogs/link-picture";
import { useCatalogMarks } from "@/hooks/use-catalogs";
import { hasReader } from "@/lib/catalog-actions";
import type {
  Catalog,
  CatalogsContent,
  Link as SavedLink,
} from "@/lib/catalogs";
import type { Project } from "@/lib/project";
import { plural } from "@/lib/utils";

/** Pictures a catalog's card shows. */
const PREVIEW_THUMBS = 4;

/** The catalog's latest pictures, side by side, or a quiet wash before it has any. */
function Mosaic({ links }: { links: SavedLink[] }) {
  const pictured = links.filter(hasPicture).slice(0, PREVIEW_THUMBS);
  if (pictured.length === 0) {
    return (
      <div
        aria-hidden
        className="bg-muted flex h-24 items-center justify-center"
      >
        <BookmarkIcon className="text-muted-foreground/50 size-6" />
      </div>
    );
  }
  return (
    <div aria-hidden className="bg-muted flex h-24 gap-0.5">
      {pictured.map((link) => (
        <span className="h-full min-w-0 flex-1" key={link.id}>
          <LinkThumb link={link} />
        </span>
      ))}
    </div>
  );
}

function CatalogCard({
  project,
  catalog,
  links,
  fresh,
}: {
  project: Project;
  catalog: Catalog;
  links: SavedLink[];
  /** Links new to whoever's looking. */
  fresh: number;
}) {
  return (
    <Link
      className={cn(CARD_SURFACE, "gap-0 overflow-hidden p-0")}
      href={catalogPath(project, catalog)}
    >
      <Mosaic links={links} />
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 truncate leading-snug font-medium">
            {catalog.title}
          </h3>
          {fresh > 0 && (
            <span className="bg-primary/12 text-primary ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
              {fresh} new
            </span>
          )}
        </div>
        {catalog.description && (
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {catalog.description}
          </p>
        )}
        <p className="text-muted-foreground mt-auto pt-1 text-xs tabular-nums">
          {plural(links.length, "link")}
          {catalog.categories.length > 0 &&
            ` · ${catalog.categories.length} ${catalog.categories.length === 1 ? "category" : "categories"}`}
        </p>
      </div>
    </Link>
  );
}

export function CatalogGrid({
  project,
  content,
  pubkey,
}: {
  project: Project;
  content: CatalogsContent;
  pubkey: string;
}) {
  const marks = useCatalogMarks(pubkey);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {content.catalogs.map((catalog) => {
        const links = content.linksIn.get(catalog.id) ?? [];
        return (
          <CatalogCard
            catalog={catalog}
            fresh={countNew(catalog, links, marks, pubkey)}
            key={catalog.id}
            links={links}
            project={project}
          />
        );
      })}
    </div>
  );
}

/** Where catalogs would be: a way to start one, for whoever can. */
export function NoCatalogs({
  editable,
  onNew,
}: {
  editable: boolean;
  onNew: () => void;
}) {
  return (
    <Empty>
      <BookmarkIcon
        aria-hidden
        className="text-muted-foreground size-8"
        strokeWidth={1.5}
      />
      <EmptyTitle>No catalogs yet</EmptyTitle>
      <EmptyDescription>
        {editable
          ? `Keep videos, posts and articles worth coming back to${hasReader() ? ", read and filed by AI" : ""}.`
          : "Catalogs in this project show up here."}
      </EmptyDescription>
      {editable && (
        <Button onClick={onNew}>
          <PlusIcon />
          New catalog
        </Button>
      )}
    </Empty>
  );
}
