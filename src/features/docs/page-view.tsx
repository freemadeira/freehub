import type { NostrEvent } from "applesauce-core/helpers/event";
import { cn } from "cn";
import {
  BookOpenTextIcon,
  EllipsisIcon,
  FileIcon,
  SmilePlusIcon,
} from "lucide-react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";

import { IconButton } from "@/components/icon-button";
import { MarkdownView } from "@/components/markdown-editor";
import type { BlockCommand } from "@/components/markdown-editor/blocks";
import { dropEmptyLine } from "@/components/markdown-editor/blocks";
import { ProjectAvatar } from "@/components/project-avatar";
import type { Crumb } from "@/components/top-bar";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { docsPath, pagePath } from "@/features/docs/docs-context";
import { IconPicker } from "@/features/docs/icon-picker";
import type { PageEditorHandle } from "@/features/docs/page-editor";
import { PageEditor } from "@/features/docs/page-editor";
import { PageIcon } from "@/features/docs/page-icon";
import { PageMenu } from "@/features/docs/page-menu";
import type { DocPage, DocsContent } from "@/lib/docs";
import { ancestors, pageTemplate, pageTitle } from "@/lib/docs";
import { createPage, isPageDeleted, updatePage } from "@/lib/docs-actions";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";
import { publish } from "@/lib/publish";

const ICON =
  "-ml-1 flex size-16 items-center justify-center self-start rounded-xl text-5xl leading-none";
const TITLE = "text-3xl leading-tight font-bold tracking-tight sm:text-4xl";

interface PageViewProps {
  project: Project;
  docs: DocsContent;
  page: DocPage;
  pubkey: string;
}

function crumbsFor(
  project: Project,
  docs: DocsContent,
  page: DocPage
): Crumb[] {
  return [
    {
      href: `/p/${project.slug}`,
      icon: <ProjectAvatar project={project} />,
      label: project.title,
    },
    {
      href: docsPath(project),
      icon: (
        <BookOpenTextIcon className="text-muted-foreground size-4 shrink-0" />
      ),
      label: "Docs",
    },
    ...ancestors(docs, page).map((parent) => ({
      href: pagePath(project, parent),
      icon: <PageIcon className="text-muted-foreground" page={parent} />,
      label: pageTitle(parent),
    })),
    {
      icon: <PageIcon className="text-muted-foreground" page={page} />,
      label: pageTitle(page),
    },
  ];
}

/** The pages under this one, listed after its text. */
function SubPages({ project, pages }: { project: Project; pages: DocPage[] }) {
  return (
    <section
      aria-label="Pages inside"
      className="flex flex-col gap-1 border-t pt-6"
    >
      {pages.map((child) => (
        <Link
          className="hover:bg-foreground/5 focus-visible:ring-ring/50 -mx-2 flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-150 outline-none focus-visible:ring-3"
          href={pagePath(project, child)}
          key={child.id}
        >
          <PageIcon className="text-muted-foreground" page={child} />
          <span
            className={cn(
              "truncate font-medium underline decoration-current/20 underline-offset-3",
              !child.title.trim() && "text-muted-foreground"
            )}
          >
            {pageTitle(child)}
          </span>
        </Link>
      ))}
    </section>
  );
}

/** The page's icon, title and text, edited in place. */
function EditablePage({ project, docs, page, pubkey }: PageViewProps) {
  const [, navigate] = useLocation();
  const editor = useRef<PageEditorHandle>(null);
  // The title being typed, until it's saved and the field left.
  const [title, setTitle] = useState<string>();

  const addPage = () => {
    const { id } = createPage(project, docs, { parent: page.id });
    navigate(pagePath(project, { id, title: "" }));
  };

  const commands: BlockCommand[] = [
    {
      icon: FileIcon,
      id: "page",
      keywords: ["page", "subpage", "child", "document"],
      label: "Page inside",
      run: (chain) => {
        addPage();
        return dropEmptyLine(chain);
      },
    },
  ];

  const onPublish = (content: string, prev: NostrEvent) => {
    // A page someone deleted stays deleted, even with edits left to save.
    if (isPageDeleted(project, page.id)) {
      return Promise.resolve(false);
    }
    return publish(
      pageTemplate(
        project,
        { ...page, content, title: title ?? page.title },
        prev
      ),
      page.event
    );
  };

  const onTitleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget;
    const atEnd = field.selectionStart === field.value.length;
    if (
      (event.key === "Enter" && !event.nativeEvent.isComposing) ||
      (event.key === "ArrowDown" && atEnd)
    ) {
      event.preventDefault();
      editor.current?.focus("start");
    }
  };

  return (
    <>
      <div className="group/title flex flex-col gap-2">
        <IconPicker
          icon={page.icon}
          onChange={(icon) => updatePage(project, page, { icon })}
          trigger={
            page.icon ? (
              <button
                aria-label="Change icon"
                className={cn(
                  ICON,
                  "hover:bg-foreground/5 focus-visible:ring-ring/50 transition-colors duration-150 outline-none focus-visible:ring-3"
                )}
                type="button"
              >
                {page.icon}
              </button>
            ) : (
              <Button
                className="text-muted-foreground -ml-2 self-start opacity-0 transition-opacity duration-150 group-hover/title:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
                size="sm"
                variant="ghost"
              >
                <SmilePlusIcon />
                Add icon
              </Button>
            )
          }
        />
        <textarea
          aria-label="Title"
          className={cn(
            TITLE,
            "placeholder:text-muted-foreground/60 field-sizing-content w-full resize-none bg-transparent outline-none"
          )}
          onBlur={() => {
            if (title !== undefined) {
              editor.current?.save();
              setTitle(undefined);
            }
          }}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            setTitle(event.target.value.replaceAll("\n", " "));
            editor.current?.changed();
          }}
          onKeyDown={onTitleKeyDown}
          placeholder="Untitled"
          rows={1}
          value={title ?? page.title}
        />
      </div>
      <div className="mt-4">
        <PageEditor
          commands={commands}
          key={page.id}
          onPublish={onPublish}
          opened={page.event}
          pubkey={pubkey}
          ref={editor}
          versions={docs.versions.get(page.id) ?? []}
        />
      </div>
      {/* Clicking under the text carries on writing at its end. */}
      <div
        aria-hidden
        className="min-h-24 grow cursor-text"
        onClick={() => editor.current?.focus("end")}
      />
    </>
  );
}

/**
 * The page as its newest version reads, for viewers of the project. It never
 * saves, so teammates' versions aren't merged here: the newest one shows.
 */
function ReadOnlyPage({ page }: { page: DocPage }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        {page.icon && <span className={ICON}>{page.icon}</span>}
        <h2
          className={cn(
            TITLE,
            "wrap-break-word",
            !page.title.trim() && "text-muted-foreground/60"
          )}
        >
          {pageTitle(page)}
        </h2>
      </div>
      <MarkdownView className="page-text mt-4" value={page.content} />
      <div aria-hidden className="min-h-24 grow" />
    </>
  );
}

/** One doc page: its icon, title and text, then the pages inside it. */
export function PageView({ project, docs, page, pubkey }: PageViewProps) {
  const children = docs.children.get(page.id) ?? [];
  const editable = canEdit(project, pubkey);
  return (
    <>
      <TopBar crumbs={crumbsFor(project, docs, page)}>
        <PageMenu
          canEdit={editable}
          docs={docs}
          page={page}
          project={project}
          trigger={
            <IconButton label="Page options">
              <EllipsisIcon />
            </IconButton>
          }
        />
      </TopBar>
      <main className="flex grow flex-col">
        <article className="mx-auto flex w-full max-w-3xl grow flex-col px-4 pt-6 pb-10 sm:px-16 sm:pt-14">
          {editable ? (
            <EditablePage
              docs={docs}
              page={page}
              project={project}
              pubkey={pubkey}
            />
          ) : (
            <ReadOnlyPage page={page} />
          )}
          {children.length > 0 && (
            <SubPages pages={children} project={project} />
          )}
        </article>
      </main>
    </>
  );
}
