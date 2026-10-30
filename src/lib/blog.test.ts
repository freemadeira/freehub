import type { NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";

import type { ImageMeta, PostFields } from "@/lib/blog";
import {
  blankFields,
  followTitle,
  imageMarkdown,
  imageSizes,
  imagesIn,
  imageWidths,
  imetaTag,
  isImageAddress,
  isPublicLink,
  languageStatus,
  parseImeta,
  parsePostVersion,
  postImages,
  postTemplate,
  postTombstoneTemplate,
  postUrl,
  publishProblem,
  resolveBlog,
  slugTakenBy,
  startLanguage,
  usedImages,
  wasPublished,
  withOldSlugs,
  withShared,
} from "@/lib/blog";
import type { Template } from "@/lib/model";
import { nextCreatedAt, POST_DRAFT_KIND, POST_KIND } from "@/lib/model";
import type { Project } from "@/lib/project";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const STRANGER = "d".repeat(64);
const POST = "0123456789abcdef";
const OTHER = "fedcba9876543210";
const MEDIA = "https://media.example.org";

const project = {
  address: `30304:${ALICE}:p1`,
  members: [ALICE, BOB],
  viewers: [],
} as unknown as Project;
const LOCALES = ["pt", "en"];

let clock = 1000;

function signed(template: Template, pubkey: string): NostrEvent {
  clock += 1;
  return {
    ...template,
    created_at: clock,
    id: `${pubkey.slice(0, 4)}${clock}`,
    pubkey,
    sig: "sig",
  };
}

function image(name: string, width = 1920, height = 1080): ImageMeta {
  return {
    alt: "",
    hash: name.repeat(64).slice(0, 64),
    height,
    sizes: imageWidths(width).map((size) => ({
      url: `${MEDIA}/${name}${size}.webp`,
      width: size,
    })),
    url: `${MEDIA}/${name}${Math.min(width, 1920)}.webp`,
    width: Math.min(width, 1920),
  };
}

const cover = image("c");
const photo = image("e", 1000, 750);

const fields: PostFields = {
  ...blankFields(POST, "pt", ALICE),
  content: `Olá.\n\n${imageMarkdown({ alt: "A harbour", caption: "Funchal, at dusk", url: photo.url })}`,
  cover: cover.url,
  coverAlt: "The island",
  images: [cover, photo],
  publishedAt: 1_700_000_000,
  slug: "ola-mundo",
  summary: "Uma saudação.",
  title: "Olá mundo",
  topics: ["Bitcoin", "education"],
};

describe("post events", () => {
  it("writes the tags the websites read, in order", () => {
    const template = postTemplate(project, fields, POST_KIND);
    expect(template.kind).toBe(POST_KIND);
    expect(template.content).toBe(fields.content);
    expect(template.tags).toEqual([
      ["d", `${POST}-pt`],
      ["a", project.address],
      ["post", POST],
      ["L", "ISO-639-1"],
      ["l", "pt", "ISO-639-1"],
      ["title", "Olá mundo"],
      ["slug", "ola-mundo"],
      ["summary", "Uma saudação."],
      ["image", cover.url],
      ["published_at", "1700000000"],
      ["t", "bitcoin"],
      ["t", "education"],
      ["p", ALICE, "", "author"],
      [
        "imeta",
        `url ${cover.url}`,
        "m image/webp",
        `x ${cover.hash}`,
        "dim 1920x1080",
        "alt The island",
        `srcset ${MEDIA}/c640.webp 640w, ${MEDIA}/c1280.webp 1280w, ${MEDIA}/c1920.webp 1920w`,
      ],
      [
        "imeta",
        `url ${photo.url}`,
        "m image/webp",
        `x ${photo.hash}`,
        "dim 1000x750",
        "alt A harbour",
        `srcset ${MEDIA}/e640.webp 640w, ${MEDIA}/e1000.webp 1000w`,
      ],
      ["alt", "Blog post: Olá mundo"],
    ]);
  });

  it("names the draft it was edited from, on drafts only", () => {
    const base = signed(postTemplate(project, fields, POST_DRAFT_KIND), BOB);
    const edited = postTemplate(project, fields, POST_DRAFT_KIND, base);
    expect(edited.tags).toContainEqual(["prev", base.id]);
    expect(
      postTemplate(project, fields, POST_KIND, base).tags
    ).not.toContainEqual(["prev", base.id]);
    const unsigned = { ...base, id: "draft-123" };
    expect(
      postTemplate(project, fields, POST_DRAFT_KIND, unsigned).tags.some(
        ([name]) => name === "prev"
      )
    ).toBe(false);
  });

  it("leaves out what isn't set, and describes only pictures in use", () => {
    const bare = postTemplate(
      project,
      { ...blankFields(POST, "en", BOB), images: [photo] },
      POST_DRAFT_KIND
    );
    const names = bare.tags.map(([name]) => name);
    expect(names).toEqual([
      "d",
      "a",
      "post",
      "L",
      "l",
      "title",
      "slug",
      "summary",
      "p",
      "alt",
    ]);
    expect(bare.tags.at(-1)).toEqual(["alt", "Blog post: Untitled"]);
  });

  it("reads back what it wrote", () => {
    const event = signed(postTemplate(project, fields, POST_KIND), ALICE);
    const version = parsePostVersion(event);
    expect(version).toMatchObject({
      author: ALICE,
      authors: [ALICE],
      content: fields.content,
      cover: cover.url,
      coverAlt: "The island",
      locale: "pt",
      post: POST,
      publishedAt: 1_700_000_000,
      slug: "ola-mundo",
      summary: "Uma saudação.",
      title: "Olá mundo",
      topics: ["bitcoin", "education"],
    });
    expect(version?.images).toEqual([
      { ...cover, alt: "The island" },
      { ...photo, alt: "A harbour" },
    ]);
  });

  it("ignores a version whose d tag and post tag disagree", () => {
    const template = postTemplate(project, fields, POST_KIND);
    const event = signed(
      {
        ...template,
        tags: template.tags.map((tag) =>
          tag[0] === "post" ? ["post", OTHER] : tag
        ),
      },
      ALICE
    );
    expect(parsePostVersion(event)).toBeUndefined();
  });

  it("takes a language off the website with a tombstone naming it", () => {
    expect(postTombstoneTemplate(project, POST, "en", POST_KIND)).toEqual({
      content: "",
      kind: POST_KIND,
      tags: [
        ["d", `${POST}-en`],
        ["a", project.address],
        ["post", POST],
        ["L", "ISO-639-1"],
        ["l", "en", "ISO-639-1"],
        ["deleted"],
      ],
    });
  });
});

describe("pictures", () => {
  it("draws the standard widths below the picture's own, never wider", () => {
    expect(imageWidths(4000)).toEqual([640, 1280, 1920]);
    expect(imageWidths(1920)).toEqual([640, 1280, 1920]);
    expect(imageWidths(1500)).toEqual([640, 1280, 1500]);
    expect(imageWidths(1280)).toEqual([640, 1280]);
    expect(imageWidths(640)).toEqual([640]);
    expect(imageWidths(300)).toEqual([300]);
  });

  it("writes Markdown that reads back as written", () => {
    const written = imageMarkdown({
      alt: "a [tricky] *alt* \\ & more",
      caption: 'Said "hi"\nthen left',
      url: photo.url,
    });
    expect(written).toBe(
      `![a \\[tricky\\] \\*alt\\* \\\\ \\& more](${photo.url} "Said \\"hi\\" then left")`
    );
    expect(imagesIn(written)).toEqual([
      { alt: "a [tricky] *alt* \\ & more", url: photo.url },
    ]);
    expect(imageMarkdown({ alt: "", url: "https://x.org/a b.webp" })).toBe(
      "![](<https://x.org/a b.webp>)"
    );
  });

  it("finds each picture in the text once, in lists and tables too", () => {
    const text = [
      "![one](https://x.org/1.webp)",
      "- ![two](https://x.org/2.webp)",
      "| a |\n| - |\n| ![three](https://x.org/3.webp) |",
      "again ![](https://x.org/1.webp)",
    ].join("\n\n");
    expect(imagesIn(text).map(({ alt }) => alt)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("keeps every size within what WebP can hold", () => {
    expect(imageSizes(2400, 1600)).toEqual([
      { height: 427, width: 640 },
      { height: 853, width: 1280 },
      { height: 1280, width: 1920 },
    ]);
    // Very tall: narrower, so no side passes 16383 pixels, and each size once.
    expect(imageSizes(1000, 40_000)).toEqual([{ height: 16_360, width: 409 }]);
  });

  it("shows pictures over https, or http on this machine only", () => {
    expect(isImageAddress("https://media.example.org/a.webp")).toBe(true);
    expect(isImageAddress("http://localhost:3000/a.webp")).toBe(true);
    expect(isImageAddress("http://example.org/a.png")).toBe(false);
    expect(isImageAddress("data:image/png;base64,AAAA")).toBe(false);
  });

  it("reads imeta tags, and skips ones missing what the website needs", () => {
    expect(parseImeta(imetaTag({ ...photo, alt: "Boats" }))).toEqual({
      ...photo,
      alt: "Boats",
    });
    expect(parseImeta(["imeta", `url ${photo.url}`, "m image/webp"])).toBe(
      undefined
    );
  });

  it("describes the cover first, with each picture's current alt text", () => {
    expect(
      usedImages({
        ...fields,
        content:
          "![Now a boat](https://media.example.org/e1000.webp) ![](https://elsewhere.org/x.png)",
      })
    ).toEqual([
      { ...cover, alt: "The island" },
      { ...photo, alt: "Now a boat" },
    ]);
  });
});

describe("links", () => {
  it("follows the title until edited by hand or published", () => {
    expect(followTitle("", "", "Olá Mundo!", false)).toBe("ola-mundo");
    expect(followTitle("ola", "Ola", "Olá Mundo", false)).toBe("ola-mundo");
    expect(followTitle("my-own", "Ola", "Olá Mundo", false)).toBe("my-own");
    expect(followTitle("ola", "Ola", "Olá Mundo", true)).toBe("ola");
  });

  it("keeps the links a language was published under as old ones", () => {
    const published = ["second", "first"];
    const moved = withOldSlugs({ ...fields, slug: "third" }, published);
    expect(moved.oldSlugs).toEqual(["second", "first"]);
    // Taking an old link back makes it current, and no longer old.
    expect(
      withOldSlugs({ ...moved, slug: "first" }, published).oldSlugs
    ).toEqual(["second"]);
    // Never published: no old links.
    expect(withOldSlugs({ ...fields, slug: "x" }, []).oldSlugs).toEqual([]);
  });

  it("counts a language with a date or known links as published", () => {
    expect(wasPublished({ publishedAt: 1 })).toBe(true);
    expect(wasPublished({}, { publishedSlugs: ["ola"] })).toBe(true);
    expect(wasPublished({}, { publishedSlugs: [] })).toBe(false);
  });

  it("only links to the web and mail, never into the app", () => {
    const app = "https://hub.example.org";
    expect(isPublicLink("https://example.org/a", app)).toBe(true);
    expect(isPublicLink("http://example.org", app)).toBe(true);
    expect(isPublicLink("mailto:hello@example.org", app)).toBe(true);
    expect(isPublicLink("https://hub.example.org/p/x/docs/a-1", app)).toBe(
      false
    );
    expect(isPublicLink(["javascript", "alert(1)"].join(":"), app)).toBe(false);
    expect(isPublicLink("/p/x", app)).toBe(false);
  });

  it("writes old links right after the current one, and reads them back", () => {
    const template = postTemplate(
      project,
      { ...fields, oldSlugs: ["first", "ola-mundo", "second"] },
      POST_KIND
    );
    const at = template.tags.findIndex(([name]) => name === "slug");
    expect(template.tags.slice(at, at + 4)).toEqual([
      ["slug", "ola-mundo"],
      ["old_slug", "first"],
      ["old_slug", "second"],
      ["summary", "Uma saudação."],
    ]);
    expect(parsePostVersion(signed(template, ALICE))?.oldSlugs).toEqual([
      "first",
      "second",
    ]);
  });

  it("goes under /blog in the main language, and the code in others", () => {
    const website = { locales: ["pt", "en"], url: "https://example.org" };
    expect(postUrl(website, "pt", "ola")).toBe("https://example.org/blog/ola");
    expect(postUrl(website, "en", "hello")).toBe(
      "https://example.org/en/blog/hello"
    );
  });
});

function draft(changes: Partial<PostFields>, by = ALICE): NostrEvent {
  return signed(
    postTemplate(project, { ...fields, ...changes }, POST_DRAFT_KIND),
    by
  );
}

function live(changes: Partial<PostFields>, by = ALICE): NostrEvent {
  return signed(
    postTemplate(project, { ...fields, ...changes }, POST_KIND),
    by
  );
}

describe("resolving the blog", () => {
  it("groups languages under their post, newest version by a member winning", () => {
    const events = [
      draft({ title: "Primeiro" }),
      draft({ title: "Segundo" }, BOB),
      draft({ title: "Intruso" }, STRANGER),
      draft({ locale: "en", slug: "hello", title: "Hello" }),
      draft({ locale: "fr", title: "Bonjour" }),
    ];
    const blog = resolveBlog(project, events, LOCALES);
    const post = blog.byId.get(POST);
    expect(post?.languages.map((language) => language.locale)).toEqual([
      "pt",
      "en",
    ]);
    expect(post?.languages[0]?.draft?.title).toBe("Segundo");
    expect(post?.languages[0]?.drafts).toHaveLength(2);
  });

  it("ignores versions from another project", () => {
    const elsewhere = signed(
      postTemplate({ address: `30304:${ALICE}:p2` }, fields, POST_DRAFT_KIND),
      ALICE
    );
    expect(resolveBlog(project, [elsewhere], LOCALES).posts).toEqual([]);
  });

  it("tells drafts, published posts and unpublished changes apart", () => {
    const status = (events: NostrEvent[]) => {
      const language = resolveBlog(project, events, LOCALES).byId.get(POST)
        ?.languages[0];
      return language && languageStatus(language);
    };
    expect(status([draft({})])).toBe("draft");
    expect(status([draft({}), live({})])).toBe("published");
    expect(status([draft({ title: "Novo" }), live({})])).toBe("changed");
    // A draft without a date keeps the published one.
    expect(status([draft({ publishedAt: undefined }), live({})])).toBe(
      "published"
    );
    const before = [draft({}), live({})];
    const unpublished = signed(
      postTombstoneTemplate(project, POST, "pt", POST_KIND),
      BOB
    );
    expect(status([...before, unpublished])).toBe("draft");
  });

  it("drops a post whose every version was deleted", () => {
    const events = [
      draft({}),
      live({}),
      signed(postTombstoneTemplate(project, POST, "pt", POST_DRAFT_KIND), BOB),
      signed(postTombstoneTemplate(project, POST, "pt", POST_KIND), BOB),
    ];
    expect(resolveBlog(project, events, LOCALES).posts).toEqual([]);
  });

  it("warns of a link another post uses, and refuses a published one", () => {
    const other = (kind: typeof POST_KIND | typeof POST_DRAFT_KIND) =>
      signed(
        postTemplate(project, { ...fields, post: OTHER, slug: "taken" }, kind),
        BOB
      );
    const drafted = resolveBlog(project, [other(POST_DRAFT_KIND)], LOCALES);
    const mine = { locale: "pt", post: POST, slug: "taken", title: "Olá" };
    expect(slugTakenBy(drafted, mine)).toMatchObject({ published: false });
    expect(publishProblem(drafted, mine)).toBeUndefined();
    const published = resolveBlog(project, [other(POST_KIND)], LOCALES);
    expect(publishProblem(published, mine)).toBe(
      "Another published post has this link."
    );
    expect(slugTakenBy(published, { ...mine, locale: "en" })).toBeUndefined();
    // Another post's old links still lead to it; the post's own are free to take back.
    const moved = resolveBlog(
      project,
      [
        signed(
          postTemplate(
            project,
            { ...fields, oldSlugs: ["before"], post: OTHER, slug: "after" },
            POST_KIND
          ),
          BOB
        ),
      ],
      LOCALES
    );
    expect(slugTakenBy(moved, { ...mine, slug: "before" })).toMatchObject({
      published: true,
    });
    expect(
      slugTakenBy(moved, { ...mine, post: OTHER, slug: "before" })
    ).toBeUndefined();
    expect(publishProblem(drafted, { ...mine, title: " " })).toBe(
      "Give it a title first."
    );
    expect(publishProblem(drafted, { ...mine, slug: "Not ok" })).toMatch(
      /link first/u
    );
  });

  it("starts a new language with what the languages share", () => {
    const blog = resolveBlog(project, [draft({})], LOCALES);
    const post = blog.byId.get(POST);
    if (!post) {
      throw new Error("No post");
    }
    const english = startLanguage(post, "en", BOB);
    expect(english).toMatchObject({
      authors: [ALICE],
      content: "",
      cover: cover.url,
      coverAlt: "The island",
      locale: "en",
      title: "",
      topics: ["bitcoin", "education"],
    });
    expect(english.images).toEqual([{ ...cover, alt: "The island" }]);
  });

  it("changes the shared fields, keeping what's known of a new cover", () => {
    const next = image("n");
    const changed = withShared(
      fields,
      { cover: next.url, topics: ["x"] },
      next
    );
    expect(changed.cover).toBe(next.url);
    expect(changed.topics).toEqual(["x"]);
    expect(changed.images).toContainEqual(next);
    // The old cover's alt text doesn't describe the new one.
    expect(changed.coverAlt).toBe("");
    expect(withShared(fields, { topics: ["y"] }).coverAlt).toBe("The island");
  });

  it("keeps the links of an unpublished language, and publishes after it", () => {
    const published = live({ oldSlugs: ["first"], slug: "second" });
    const unpublished = signed(
      postTombstoneTemplate(project, POST, "pt", POST_KIND, [
        "second",
        "first",
      ]),
      BOB
    );
    expect(unpublished.tags).toContainEqual(["old_slug", "second"]);
    expect(unpublished.tags.at(-1)).toEqual(["deleted"]);
    const language = resolveBlog(
      project,
      [draft({ slug: "second" }), published, unpublished],
      LOCALES
    ).byId.get(POST)?.languages[0];
    expect(language?.published).toBeUndefined();
    expect(language?.publishedSlugs).toEqual(["second", "first"]);
    // The next publication comes after the unpublishing, even right away.
    expect(language?.publishedEvent).toBe(unpublished);
    expect(nextCreatedAt(language?.publishedEvent)).toBeGreaterThan(
      unpublished.created_at
    );
    // Retitled while it was off the website: the link stays, and the old ones with it.
    expect(language && wasPublished({}, language)).toBe(true);
    expect(
      withOldSlugs({ ...fields, slug: "third" }, language?.publishedSlugs ?? [])
        .oldSlugs
    ).toEqual(["second", "first"]);
  });

  it("knows each picture any version of the post describes", () => {
    const other = image("o");
    const events = [
      draft({ images: [photo] }),
      draft({
        content: `![](${other.url})`,
        images: [other],
        locale: "en",
      }),
    ];
    const post = resolveBlog(project, events, LOCALES).byId.get(POST);
    const known = post ? postImages(post).map((each) => each.url) : [];
    expect(known).toEqual(expect.arrayContaining([photo.url, other.url]));
    // A text pasted from English into Portuguese keeps its picture's sizes.
    expect(
      usedImages({
        ...fields,
        content: `![Boat](${other.url})`,
        cover: undefined,
        images: post ? postImages(post) : [],
      })
    ).toEqual([{ ...other, alt: "Boat" }]);
  });
});
