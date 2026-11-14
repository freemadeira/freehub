import { useEffect } from "react";
import { Link, useLocation } from "wouter";

import { TopBar } from "@/components/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandPage } from "@/features/branding/brand-page";
import {
  brandingPath,
  brandPath,
  parseBrandParam,
} from "@/features/branding/branding-context";
import { BrandsPage } from "@/features/branding/brands-page";
import type { BrandsContent } from "@/lib/brands";
import { NO_PARTS } from "@/lib/brands";
import type { Project } from "@/lib/project";

const NO_VERSIONS: never[] = [];

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
      <BrandPage
        alone={alone}
        brand={brand}
        deleted={content.deleted}
        key={brand.id}
        parts={content.parts.get(brand.id) ?? NO_PARTS}
        project={project}
        pubkey={pubkey}
        versions={content.versions.get(brand.id) ?? NO_VERSIONS}
      />
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
