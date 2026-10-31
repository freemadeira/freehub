import type { Post, PostStatus } from "@/lib/blog";
import { currentVersion } from "@/lib/blog";
import type { Project } from "@/lib/project";
import { slugify } from "@/lib/project";

/** Where a project's blog lives, after its tables: `/p/:project/blog`. */
export const BLOG_SEGMENT = "blog";

const POST_ID = /(?:^|-)(?<id>[0-9a-f]{16})$/u;

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

export const STATUS_LABELS: Record<PostStatus, string> = {
  changed: "Changes not published",
  draft: "Draft",
  published: "Published",
};

/** A status as a dot's color: grey for drafts, green once published, amber with changes waiting. */
export const STATUS_DOTS: Record<PostStatus, string> = {
  changed: "bg-amber-500",
  draft: "bg-muted-foreground/40",
  published: "bg-emerald-500",
};

export function blogPath(project: Pick<Project, "slug">): string {
  return `/p/${project.slug}/${BLOG_SEGMENT}`;
}

/** The title a post goes by in the app: its first language's. */
export function postName(post: Post): string {
  return (
    post.languages
      .map((language) => currentVersion(language)?.title.trim())
      .find(Boolean) ?? ""
  );
}

/** The post's link: its title for people to read, then its id, which is what counts. */
export function postPath(
  project: Pick<Project, "slug">,
  post: Pick<Post, "id">,
  title = ""
): string {
  const slug = slugify(title);
  return `${blogPath(project)}/${slug ? `${slug}-` : ""}${post.id}`;
}

/** The post id at the end of a post link, whatever title came before it. */
export function parsePostParam(param: string): string | undefined {
  return POST_ID.exec(param.toLowerCase())?.groups?.id;
}

/** A language's name in English, like "Portuguese" for `pt`. */
export function languageName(locale: string): string {
  return LANGUAGE_NAMES.of(locale) ?? locale.toUpperCase();
}
