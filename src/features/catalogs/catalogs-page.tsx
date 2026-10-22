import { BookmarkIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { ProjectAvatar } from "@/components/project-avatar";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CatalogGrid, NoCatalogs } from "@/features/catalogs/catalog-card";
import { CatalogDialog } from "@/features/catalogs/catalog-dialog";
import type { CatalogsContent } from "@/lib/catalogs";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";

/** A project's catalogs, each as a card. */
export function CatalogsPage({
  project,
  content,
  loaded,
  pubkey,
}: {
  project: Project;
  /** The project's catalogs and links. */
  content: CatalogsContent;
  loaded: boolean;
  pubkey: string;
}) {
  const [creating, setCreating] = useState(false);
  const editable = canEdit(project, pubkey);
  const { catalogs } = content;

  let body = (
    <CatalogGrid content={content} project={project} pubkey={pubkey} />
  );
  if (catalogs.length === 0 && !loaded) {
    body = (
      <div aria-busy className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl max-sm:hidden" />
      </div>
    );
  } else if (catalogs.length === 0) {
    body = <NoCatalogs editable={editable} onNew={() => setCreating(true)} />;
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
              <BookmarkIcon className="text-muted-foreground size-4 shrink-0" />
            ),
            label: "Catalogs",
          },
        ]}
      >
        {editable && catalogs.length > 0 && (
          <Button onClick={() => setCreating(true)} size="sm" variant="outline">
            <PlusIcon />
            New catalog
          </Button>
        )}
      </TopBar>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-4 pb-10 sm:px-6">
        {body}
      </main>
      <CatalogDialog
        onOpenChange={setCreating}
        open={creating}
        project={project}
      />
    </>
  );
}
