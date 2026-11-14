import type { NostrEvent } from "applesauce-core/helpers/event";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { useEffect, useEffectEvent, useState } from "react";
import { Link, useLocation } from "wouter";

import { TopBar } from "@/components/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { NewBrandDialog } from "@/features/branding/brand-dialog";
import { BrandPage } from "@/features/branding/brand-page";
import {
  brandingPath,
  brandPath,
  parseBrandParam,
} from "@/features/branding/branding-context";
import { BrandsPage } from "@/features/branding/brands-page";
import { cleanUpBlobs } from "@/lib/blob-cleanup";
import type { BrandsContent } from "@/lib/brands";
import { NO_PARTS } from "@/lib/brands";
import type { Project } from "@/lib/project";

const NO_VERSIONS: never[] = [];

/**
 * How long a deleted file's blobs wait before their uploader's app takes
 * them off the servers: long enough for whoever deleted it to undo that.
 */
const CLEANUP_GRACE_MS = 10 * 60_000;

/** Deleted files whose blobs were already asked to go, this visit. */
const cleaned = new Set<string>();

/**
 * Takes your blobs of brand files deleted for good off the servers, once
 * the brands are loaded and each deletion is old enough not to be undone.
 */
function useBrandUpkeep(deleted: NostrEvent[], loaded: boolean): void {
  const [tick, setTick] = useState(0);
  const waiting = deleted.filter((event) => !cleaned.has(event.id));
  const key = waiting.map((event) => event.id).join(",");
  const upkeep = useEffectEvent((): (() => void) | undefined => {
    const ripe = Date.now() - CLEANUP_GRACE_MS;
    const ready = waiting.filter(
      (event) =>
        event.created_at * 1000 <= ripe && (getSeenRelays(event)?.size ?? 0) > 0
    );
    for (const event of ready) {
      cleaned.add(event.id);
    }
    if (ready.length > 0) {
      cleanUpBlobs(ready);
    }
    const young = waiting.filter((event) => event.created_at * 1000 > ripe);
    if (young.length === 0) {
      return;
    }
    const next =
      Math.min(...young.map((event) => event.created_at * 1000)) - ripe + 1000;
    const timer = setTimeout(() => setTick((count) => count + 1), next);
    return () => clearTimeout(timer);
  });
  // Runs again once the youngest deletion is old enough.
  useEffect(() => {
    if (loaded && key && tick >= 0) {
      return upkeep();
    }
  }, [key, loaded, tick]);
}

/**
 * A project's brands, or one of them when the link names it. A project
 * with one brand opens it straight away.
 */
export function BrandingView({
  project,
  content,
  loaded,
  brandParam,
  pubkey,
}: {
  project: Project;
  content: BrandsContent;
  loaded: boolean;
  /** The brand part of the link: its name, then its id. */
  brandParam?: string;
  pubkey: string;
}) {
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  useBrandUpkeep(content.deleted, loaded);
  const id = brandParam ? parseBrandParam(brandParam) : undefined;
  // A list of one would only repeat it, so its own page stands in.
  const alone = content.brands.length === 1;
  const lone = !brandParam && alone ? content.brands[0] : undefined;
  const brand = id ? content.byId.get(id) : lone;
  const path = brand ? brandPath(project, brand) : undefined;
  // The link follows the name as it changes; any name before the id still opens it.
  useEffect(() => {
    if (path && !(brandParam && path.endsWith(`/${brandParam}`))) {
      navigate(path, { replace: true });
    }
  }, [brandParam, navigate, path]);

  if (brand) {
    return (
      <>
        <BrandPage
          alone={alone}
          brand={brand}
          key={brand.id}
          onNew={() => setCreating(true)}
          parts={content.parts.get(brand.id) ?? NO_PARTS}
          project={project}
          pubkey={pubkey}
          versions={content.versions.get(brand.id) ?? NO_VERSIONS}
        />
        <NewBrandDialog
          onOpenChange={setCreating}
          open={creating}
          project={project}
        />
      </>
    );
  }
  if (!brandParam) {
    return (
      <BrandsPage
        content={content}
        loaded={loaded}
        project={project}
        pubkey={pubkey}
      />
    );
  }
  return (
    <>
      <TopBar
        crumbs={[
          { href: `/p/${project.slug}`, label: project.title },
          { href: brandingPath(project), label: "Branding" },
        ]}
      />
      {loaded ? (
        <Empty>
          <EmptyTitle>Brand not found</EmptyTitle>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={brandingPath(project)}
          >
            Branding
          </Link>
        </Empty>
      ) : (
        <main
          aria-busy
          className="flex grow flex-col gap-4 px-4 pt-4 pb-8 sm:px-6"
        >
          <Skeleton className="h-48 rounded-3xl" />
          <Skeleton className="min-h-64 grow rounded-2xl" />
        </main>
      )}
    </>
  );
}
