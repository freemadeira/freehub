import { cn } from "cn";
import { NewspaperIcon, PlusIcon } from "lucide-react";
import { Link, useLocation } from "wouter";

import { ProjectAvatar } from "@/components/project-avatar";
import { TimelineTime } from "@/components/timeline";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { WebsiteConfig } from "@/config";
import {
  languageName,
  postName,
  postPath,
  STATUS_DOTS,
  STATUS_LABELS,
} from "@/features/blog/blog-context";
import { AvatarStack } from "@/features/card/card-parts";
import type { BlogContent, Post, PostStatus } from "@/lib/blog";
import { currentVersion, languageStatus } from "@/lib/blog";
import { createPost } from "@/lib/blog-actions";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";

const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-3 sm:grid-cols-[minmax(0,1fr)_7rem_11rem_8rem_4.5rem]";

/** How the post stands overall: waiting changes first, then whether any language is out. */
function overall(post: Post): PostStatus {
  const statuses = new Set(post.languages.map(languageStatus));
  if (statuses.has("changed")) {
    return "changed";
  }
  return statuses.has("published") ? "published" : "draft";
}

/** Who the post is from, as its newest version says. */
function bylineOf(post: Post): string[] {
  return post.languages.map(currentVersion).find(Boolean)?.authors ?? [];
}

/** Starts a post and opens it. */
export function useNewPost(project: Project, website: WebsiteConfig) {
  const [, navigate] = useLocation();
  return () => {
    const { id } = createPost(project, website);
    navigate(postPath(project, { id }));
  };
}

function PostRow({
  project,
  website,
  post,
}: {
  project: Project;
  website: WebsiteConfig;
  post: Post;
}) {
  const name = postName(post);
  const status = overall(post);
  return (
    <li>
      <Link
        className={cn(
          ROW,
          "hover:bg-foreground/5 focus-visible:ring-ring/50 rounded-xl py-3 transition-colors duration-150 outline-none focus-visible:ring-3"
        )}
        href={postPath(project, post, name)}
      >
        <span
          className={cn(
            "truncate font-medium",
            !name && "text-muted-foreground"
          )}
        >
          {name || "Untitled"}
        </span>
        <span className="flex gap-1">
          {website.locales.map((locale) => {
            const language = post.languages.find(
              (each) => each.locale === locale
            );
            const written = language ? languageStatus(language) : undefined;
            return (
              <span
                className={cn(
                  "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium uppercase",
                  written
                    ? "bg-foreground/6"
                    : "text-muted-foreground/60 line-through"
                )}
                key={locale}
                title={`${languageName(locale)}: ${written ? STATUS_LABELS[written] : "not written"}`}
              >
                {written && (
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      STATUS_DOTS[written]
                    )}
                  />
                )}
                {locale}
              </span>
            );
          })}
        </span>
        <span className="text-muted-foreground flex items-center gap-2 text-sm max-sm:hidden">
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", STATUS_DOTS[status])}
          />
          <span className="truncate">{STATUS_LABELS[status]}</span>
        </span>
        <TimelineTime at={post.updatedAt} className="text-sm max-sm:hidden" />
        <AvatarStack className="max-sm:hidden" pubkeys={bylineOf(post)} />
      </Link>
    </li>
  );
}

/** A project's blog: every post, the one changed last first, and a way to start one. */
export function BlogPage({
  project,
  website,
  blog,
  loaded,
  pubkey,
}: {
  project: Project;
  website: WebsiteConfig;
  blog: BlogContent;
  loaded: boolean;
  pubkey: string;
}) {
  const editable = canEdit(project, pubkey);
  const newPost = useNewPost(project, website);
  const languages = website.locales.map(languageName).join(" and ");

  let body = (
    <div className="flex flex-col gap-1">
      <div
        aria-hidden
        className={cn(
          ROW,
          "text-muted-foreground pb-1 text-xs font-medium max-sm:hidden"
        )}
      >
        <span>Title</span>
        <span>Languages</span>
        <span>Status</span>
        <span>Last change</span>
        <span>Byline</span>
      </div>
      <ul className="flex flex-col">
        {blog.posts.map((post) => (
          <PostRow
            key={post.id}
            post={post}
            project={project}
            website={website}
          />
        ))}
      </ul>
    </div>
  );
  if (blog.posts.length === 0 && !loaded) {
    body = (
      <div aria-busy className="flex flex-col gap-2">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
    );
  } else if (blog.posts.length === 0) {
    body = editable ? (
      <Empty className="bg-muted/60 rounded-2xl py-10">
        <EmptyDescription className="mt-0 max-w-sm">
          Write the posts {website.name} publishes, in {languages}. They stay
          drafts until you publish them.
        </EmptyDescription>
        <Button onClick={newPost}>
          <PlusIcon />
          New post
        </Button>
      </Empty>
    ) : (
      <p className="text-muted-foreground text-sm">No posts yet.</p>
    );
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
              <NewspaperIcon className="text-muted-foreground size-4 shrink-0" />
            ),
            label: "Blog",
          },
        ]}
      >
        {editable && blog.posts.length > 0 && (
          <Button onClick={newPost} size="sm" variant="outline">
            <PlusIcon />
            New post
          </Button>
        )}
      </TopBar>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 pt-4 pb-10 sm:px-6">
        <p className="text-muted-foreground text-sm">
          Published on{" "}
          <a
            className="text-foreground underline decoration-current/30 underline-offset-3 hover:decoration-current"
            href={website.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            {website.name}
          </a>
          , in {languages}.
        </p>
        {body}
      </main>
    </>
  );
}
