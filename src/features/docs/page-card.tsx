import { cn } from "cn";
import { Link } from "wouter";

import { MentionText } from "@/components/mention-text";
import { CARD_SURFACE } from "@/features/boards/board-card";
import { pagePath } from "@/features/docs/docs-context";
import { PageIcon } from "@/features/docs/page-icon";
import type { DocPage } from "@/lib/docs";
import { pageExcerpt, pageTitle } from "@/lib/docs";
import type { Project } from "@/lib/project";

export function PageCard({
  project,
  page,
}: {
  project: Project;
  page: DocPage;
}) {
  const excerpt = pageExcerpt(page);
  return (
    <Link className={CARD_SURFACE} href={pagePath(project, page)}>
      <div className="flex items-center gap-3">
        <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
          <PageIcon className="text-base" page={page} />
        </span>
        <h3
          className={cn(
            "min-w-0 truncate leading-snug font-medium",
            !page.title.trim() && "text-muted-foreground"
          )}
        >
          {pageTitle(page)}
        </h3>
      </div>
      {excerpt && (
        <p className="text-muted-foreground line-clamp-2 text-sm">
          <MentionText content={excerpt} />
        </p>
      )}
    </Link>
  );
}
