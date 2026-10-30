import { map, of } from "rxjs";

import type { WebsiteConfig } from "@/config";
import { useObservableValue } from "@/hooks/use-observable-value";
import type { BlogContent } from "@/lib/blog";
import { EMPTY_BLOG, resolveBlog } from "@/lib/blog";
import { websiteOf } from "@/lib/blog-actions";
import { POST_DRAFT_KIND, POST_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { addressFilters, sync, whileLoading } from "@/lib/relays";

const KINDS = [POST_KIND, POST_DRAFT_KIND];
const NO_BLOGS = new Map<string, BlogContent>();

/** One project's blog, drafts and published posts, in the website's languages. */
export function useBlog(
  project: Project,
  website: WebsiteConfig
): { blog: BlogContent; loaded: boolean } {
  const filters = [{ "#a": [project.address], kinds: KINDS }];
  const feed = () =>
    sync(
      addressFilters("#a", [project.address], { kinds: KINDS }, project.members)
    );
  const loaded = useObservableValue(feed, [
    project.address,
    project.members.join(","),
  ]);
  const blog = useObservableValue(
    () =>
      whileLoading(eventStore.timeline(filters), feed()).pipe(
        map((events) => resolveBlog(project, events, website.locales))
      ),
    [project.address, project.event.id, website.locales.join(",")]
  );
  return { blog: blog ?? EMPTY_BLOG, loaded: loaded ?? false };
}

/** The blogs of the projects a website lists, keyed by project address, for views across them. */
export function useBlogs(projects: Project[]): {
  blogs: Map<string, BlogContent>;
  loaded: boolean;
} {
  const linked = projects.filter((project) => websiteOf(project));
  const addresses = linked.map((project) => project.address);
  const key = linked.map((project) => project.event.id).join(",");
  const members = [...new Set(linked.flatMap((project) => project.members))];
  const feed = () =>
    addresses.length > 0
      ? sync(addressFilters("#a", addresses, { kinds: KINDS }, members))
      : of(true);
  const loaded = useObservableValue(feed, [key]);
  const blogs = useObservableValue(
    () =>
      addresses.length > 0
        ? whileLoading(
            eventStore.timeline([{ "#a": addresses, kinds: KINDS }]),
            feed()
          ).pipe(
            map(
              (events) =>
                new Map(
                  linked.map((project) => [
                    project.address,
                    resolveBlog(
                      project,
                      events,
                      websiteOf(project)?.locales ?? []
                    ),
                  ])
                )
            )
          )
        : of(NO_BLOGS),
    [key]
  );
  return { blogs: blogs ?? NO_BLOGS, loaded: loaded ?? false };
}
