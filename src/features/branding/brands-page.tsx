import { PlusIcon, SwatchBookIcon } from "lucide-react";
import { useState } from "react";

import { ProjectAvatar } from "@/components/project-avatar";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandGrid, NoBrands } from "@/features/branding/brand-card";
import { NewBrandDialog } from "@/features/branding/brand-dialog";
import type { BrandsContent } from "@/lib/brands";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";

/** A project's brands, each as a card. */
export function BrandsPage({
  project,
  content,
  loaded,
  pubkey,
}: {
  project: Project;
  content: BrandsContent;
  loaded: boolean;
  pubkey: string;
}) {
  const [creating, setCreating] = useState(false);
  const editable = canEdit(project, pubkey);
  const { brands } = content;

  let body = <BrandGrid content={content} project={project} />;
  if (brands.length === 0 && !loaded) {
    body = (
      <div aria-busy className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl max-sm:hidden" />
      </div>
    );
  } else if (brands.length === 0) {
    body = <NoBrands editable={editable} onNew={() => setCreating(true)} />;
  }

  return (
    <>
      <TopBar
        crumbs={[
          {
            href: `/p/${project.slug}`,
            icon: <ProjectAvatar project={project} />,
            label: project.title,
          },
          {
            icon: (
              <SwatchBookIcon className="text-muted-foreground size-4 shrink-0" />
            ),
            label: "Branding",
          },
        ]}
      >
        {editable && brands.length > 0 && (
          <Button onClick={() => setCreating(true)} size="sm" variant="outline">
            <PlusIcon />
            New brand
          </Button>
        )}
      </TopBar>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-4 pb-10 sm:px-6">
        {body}
      </main>
      {editable && (
        <NewBrandDialog
          onOpenChange={setCreating}
          open={creating}
          project={project}
        />
      )}
    </>
  );
}
