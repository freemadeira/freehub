import type { NostrEvent } from "applesauce-core/helpers/event";

import { MarkdownView } from "@/components/markdown-editor";
import { BrandSection } from "@/features/branding/brand-parts";
import { PageEditor } from "@/features/docs/page-editor";
import { saveGuide } from "@/lib/brand-actions";
import type { Brand } from "@/lib/brands";
import type { Project } from "@/lib/project";

/**
 * How to use the brand, written like a doc page: edited in place by its
 * editors, merged with teammates' edits made at once, and read as it is by
 * everyone else. Viewers never get the editor, which saves as it merges.
 */
export function GuideSection({
  project,
  brand,
  versions,
  editable,
  pubkey,
}: {
  project: Project;
  brand: Brand;
  /** Each member's newest version of the brand, to merge as they arrive. */
  versions: NostrEvent[];
  editable: boolean;
  pubkey: string;
}) {
  return (
    <BrandSection id="guidelines">
      <div className="bg-card shadow-surface rounded-2xl px-5 py-6 sm:px-8 sm:py-7">
        {editable ? (
          <PageEditor
            key={brand.id}
            label="Guidelines"
            onPublish={(content, prev) =>
              saveGuide(project, brand, content, prev)
            }
            opened={brand.event}
            project={project.address}
            pubkey={pubkey}
            versions={versions}
          />
        ) : (
          <MarkdownView className="page-text" value={brand.guide} />
        )}
      </div>
    </BrandSection>
  );
}
