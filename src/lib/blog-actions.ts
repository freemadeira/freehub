import type { NostrEvent } from "applesauce-core/helpers/event";

import type { WebsiteConfig } from "@/config";
import { getConfig } from "@/config";
import type {
  ImageMeta,
  Post,
  PostFields,
  PostLanguage,
  SharedFields,
} from "@/lib/blog";
import {
  blankFields,
  currentVersion,
  imageSizes,
  postAddress,
  postImages,
  postTemplate,
  postTombstoneTemplate,
  resolveBlog,
  withOldSlugs,
  withShared,
} from "@/lib/blog";
import { authorize, CanceledError, uploadBlob } from "@/lib/blossom";
import type { Decoded } from "@/lib/images";
import { decodeImage, drawImage } from "@/lib/images";
import {
  isDeleted,
  newer,
  newId,
  POST_DRAFT_KIND,
  POST_KIND,
} from "@/lib/model";
import { accounts, eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { publish } from "@/lib/publish";
import { sha256 } from "@/lib/sealing";

/** Pictures bigger than this take too long to read and draw in the browser. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Past this many pixels, a picture takes more memory to draw than a browser can spare. */
const MAX_IMAGE_PIXELS = 100_000_000;
const WEBP = "image/webp";
const KINDS = [POST_KIND, POST_DRAFT_KIND];

/** Pictures uploaded on this device, by address, so a draft can describe them before it's saved. */
const uploaded = new Map<string, ImageMeta>();

/**
 * Saves a change to the fields the languages share, in a language open in
 * an editor, with what's being typed there.
 */
type SharedSaver = (shared: Partial<SharedFields>) => void;

/** The languages open in an editor on this device, by their `d` tag. */
const openLanguages = new Map<string, SharedSaver>();

/** The website whose blog the project writes, if one lists it in `config.json`. */
export function websiteOf(
  project: Pick<Project, "address">
): WebsiteConfig | undefined {
  return getConfig().websites.find(
    (website) => website.project === project.address
  );
}

/**
 * What's known of the post's pictures: what any of its versions says, in
 * any language, and those uploaded on this device since.
 */
export function knownImages(post: Post | undefined): ImageMeta[] {
  const images = post ? postImages(post) : [];
  const urls = new Set(images.map((image) => image.url));
  return [
    ...images,
    ...[...uploaded.values()].filter((image) => !urls.has(image.url)),
  ];
}

/** The post as the store has it now, not as a screen last drew it. */
export function currentPost(
  project: Project,
  website: Pick<WebsiteConfig, "locales">,
  id: string
): Post | undefined {
  const events = eventStore.getByFilters({
    "#a": [project.address],
    kinds: KINDS,
  });
  return resolveBlog(project, events, website.locales).byId.get(id);
}

/**
 * Marks a language as open in an editor here: shared changes go through it,
 * with what's being typed, instead of being written over it. Returns the way
 * to close it.
 */
export function openLanguage(
  post: string,
  locale: string,
  save: SharedSaver
): () => void {
  const d = postAddress(post, locale);
  openLanguages.set(d, save);
  return () => {
    if (openLanguages.get(d) === save) {
      openLanguages.delete(d);
    }
  };
}

/** Starts a post in the website's main language, by its author. Its id is known at once, to open it. */
export function createPost(
  project: Project,
  website: WebsiteConfig
): { id: string; saved: Promise<boolean> } {
  const id = newId();
  const creator = accounts.active?.pubkey;
  const [locale] = website.locales;
  if (!(creator && locale)) {
    return { id, saved: Promise.resolve(false) };
  }
  const saved = publish(
    postTemplate(project, blankFields(id, locale, creator), POST_DRAFT_KIND)
  );
  return { id, saved };
}

/**
 * Saves a draft of one language, edited from `prev`. A published language
 * whose link changed keeps the links it was published under, as old ones.
 */
export function saveDraft(
  project: Project,
  fields: PostFields,
  language: PostLanguage | undefined,
  prev?: NostrEvent
): Promise<boolean> {
  return publish(
    postTemplate(
      project,
      withOldSlugs(fields, language?.publishedSlugs ?? []),
      POST_DRAFT_KIND,
      prev
    ),
    language?.draft?.event
  );
}

/**
 * Puts one language on the website as the fields have it, sending its old
 * links on to the new one. It comes after the language's last 30023, even
 * one that unpublished it a moment ago.
 */
export function publishLanguage(
  project: Project,
  fields: PostFields,
  language: PostLanguage | undefined
): Promise<boolean> {
  return publish(
    postTemplate(
      project,
      withOldSlugs(fields, language?.publishedSlugs ?? []),
      POST_KIND
    ),
    language?.publishedEvent
  );
}

/**
 * Takes one language off the website. Its draft stays, to publish again, and
 * the links it was published under stay on it, as old ones.
 */
export function unpublishLanguage(
  project: Project,
  post: Post,
  language: PostLanguage
): Promise<boolean> {
  return publish(
    postTombstoneTemplate(
      project,
      post.id,
      language.locale,
      POST_KIND,
      language.publishedSlugs
    ),
    language.publishedEvent
  );
}

/** Whether the language's newest draft, from any member, discards it, as deleting the post does. */
export function isDiscarded(
  project: Project,
  post: string,
  locale: string
): boolean {
  let latest: NostrEvent | undefined;
  for (const member of project.members) {
    const event = eventStore.getReplaceable(
      POST_DRAFT_KIND,
      member,
      postAddress(post, locale)
    );
    if (event && (!latest || newer(event, latest))) {
      latest = event;
    }
  }
  return latest !== undefined && isDeleted(latest);
}

/**
 * Changes what the languages share in every language written, as the store
 * has them when it's called, so a cover that took a while to upload lands on
 * what was written meanwhile. A language open in an editor here saves it with
 * its text; the others get a new draft.
 */
export function updateShared(
  project: Project,
  website: Pick<WebsiteConfig, "locales">,
  id: string,
  shared: Partial<SharedFields>,
  cover?: ImageMeta
): Promise<boolean[]> {
  const post = currentPost(project, website, id);
  if (!post) {
    return Promise.resolve([]);
  }
  const images = knownImages(post);
  return Promise.all(
    post.languages.flatMap((language) => {
      const version = currentVersion(language);
      const open = openLanguages.get(postAddress(id, language.locale));
      if (!version || isDiscarded(project, id, language.locale)) {
        return [];
      }
      if (open) {
        open(shared);
        return [];
      }
      return [
        saveDraft(
          project,
          withShared({ ...version, images }, shared, cover),
          language,
          language.draft?.event
        ),
      ];
    })
  );
}

/** Takes every language of the post off the website, and discards its drafts. */
export function deletePost(project: Project, post: Post): Promise<boolean[]> {
  return Promise.all(
    post.languages.flatMap((language) => [
      publish(
        postTombstoneTemplate(
          project,
          post.id,
          language.locale,
          POST_DRAFT_KIND
        ),
        language.draft?.event
      ),
      ...(language.published
        ? [unpublishLanguage(project, post, language)]
        : []),
    ])
  );
}

interface Drawn {
  data: ArrayBuffer;
  hash: string;
  width: number;
  height: number;
}

/** The picture at each width it's published in, as WebP. */
async function drawSizes(file: File): Promise<Drawn[]> {
  let decoded: Decoded;
  try {
    decoded = await decodeImage(file);
  } catch {
    throw new Error(
      "This browser can’t read that picture. Try a JPEG, PNG or WebP."
    );
  }
  try {
    const { source, width, height } = decoded;
    if (!(width && height)) {
      throw new Error("That picture has no size to draw.");
    }
    if (width * height > MAX_IMAGE_PIXELS) {
      throw new Error(
        "That picture is too big to draw: make it smaller than 100 megapixels."
      );
    }
    return await Promise.all(
      imageSizes(width, height).map(async ({ width: size, height: tall }) => {
        const blob = await drawImage(source, size, tall);
        // Where the browser can't write WebP it writes PNG, which the website doesn't take.
        if (blob?.type !== WEBP) {
          throw new Error(
            "This browser can’t make WebP pictures. Try Chrome, Edge or Firefox."
          );
        }
        const data = await blob.arrayBuffer();
        return { data, hash: await sha256(data), height: tall, width: size };
      })
    );
  } finally {
    decoded.close();
  }
}

/**
 * Publishes a picture for a post: draws it at each width the website shows,
 * as WebP, then sends every size, unencrypted, to the website's media
 * server, under one signature. It's public from then on, at its address.
 * Tells how far it got, from 0 to 1.
 */
export async function uploadImage(
  file: File,
  website: Pick<WebsiteConfig, "media">,
  {
    onProgress,
    signal,
  }: { onProgress?: (share: number) => void; signal?: AbortSignal } = {}
): Promise<ImageMeta> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That isn’t a picture.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Pictures can be up to 25 MB.");
  }
  const sizes = await drawSizes(file);
  const largest = sizes.at(-1);
  if (!largest) {
    throw new Error("That picture has no size to draw.");
  }
  // Removed while it was drawn: no need to bother the signer.
  if (signal?.aborted) {
    throw new CanceledError();
  }
  const auth = await authorize(
    "upload",
    sizes.map((size) => size.hash),
    `Upload ${file.name}`
  );
  const total = sizes.reduce((sum, size) => sum + size.data.byteLength, 0);
  const sent = sizes.map(() => 0);
  await Promise.all(
    sizes.map((size, index) =>
      uploadBlob(size.data, size.hash, auth, {
        onProgress: (loaded) => {
          sent[index] = loaded;
          onProgress?.(sent.reduce((sum, bytes) => sum + bytes, 0) / total);
        },
        server: website.media,
        signal,
        type: WEBP,
      })
    )
  );
  const urlOf = (hash: string) => `${website.media}/${hash}.webp`;
  const image: ImageMeta = {
    alt: "",
    hash: largest.hash,
    height: largest.height,
    sizes: sizes.map(({ hash, width }) => ({ url: urlOf(hash), width })),
    url: urlOf(largest.hash),
    width: largest.width,
  };
  uploaded.set(image.url, image);
  return image;
}
