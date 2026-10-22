import type { Link } from "@/lib/catalogs";
import { useOpened } from "@/lib/drive-files";

/** Whether the link has a picture to show. */
export function hasPicture(link: Pick<Link, "thumb" | "image">): boolean {
  return Boolean(link.thumb || link.image);
}

/**
 * Where the link's picture shows from: its copy on the team's file server,
 * opened in the browser, or else where it is on the web.
 */
export function useLinkPicture(
  link: Pick<Link, "thumb" | "image">
): string | undefined {
  const { thumb } = link;
  const opened = useOpened(
    thumb
      ? {
          blob: { hash: thumb.hash, nonce: thumb.nonce },
          key: thumb.key,
          type: thumb.type,
        }
      : undefined
  );
  return thumb ? opened.url : link.image;
}
