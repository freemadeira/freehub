import type { NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";

import type { CatalogFields, LinkFields, ReadingFields } from "@/lib/catalogs";
import {
  catalogTemplate,
  catalogTombstoneTemplate,
  cleanLink,
  linkCommentTemplate,
  linkKey,
  linkTemplate,
  readingTemplate,
  resolveCatalogs,
  sortReportTemplate,
  splitPasted,
} from "@/lib/catalogs";
import { mentionReference } from "@/lib/mentions";
import type { Template } from "@/lib/model";
import type { Project } from "@/lib/project";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const READER = "c".repeat(64);
const STRANGER = "d".repeat(64);

const project = {
  address: `30304:${ALICE}:p1`,
  members: [ALICE, BOB],
  viewers: [],
} as unknown as Project;

let clock = 1000;

function signed(template: Template, pubkey: string): NostrEvent {
  clock += 1;
  const at = clock;
  return {
    ...template,
    created_at: at,
    id: `${pubkey.slice(0, 4)}${at}`,
    pubkey,
    sig: "sig",
  };
}

const catalog: CatalogFields = {
  categories: [
    { color: "blue", id: "c1", name: "Security" },
    { color: "red", id: "c2", name: "Design" },
  ],
  createdAt: 100,
  creator: ALICE,
  description: "Things worth keeping",
  dismissed: [],
  id: "cat1",
  sorts: [],
  title: "Research",
};

const link: LinkFields = {
  catalog: "cat1",
  createdAt: 200,
  creator: BOB,
  edits: {},
  id: "link1",
  note: "Look at this",
  url: "https://example.com/post",
};

const reading: ReadingFields = {
  byline: { name: "Someone" },
  categories: ["c2"],
  link: "link1",
  readAt: 0,
  state: "ready",
  suggested: ["Launches"],
  summary: "What it says.",
  title: "A clear title",
  type: "article",
  url: "https://example.com/post",
};

function resolve(events: NostrEvent[], readers = [READER]) {
  return resolveCatalogs(project, events, new Set(readers));
}

describe("links as kept", () => {
  it("drops tracking and keeps the address otherwise", () => {
    expect(cleanLink("youtu.be/abc?si=xyz")).toBe("https://youtu.be/abc");
    expect(cleanLink("https://x.com/a/status/1?utm_source=t&id=2")).toBe(
      "https://x.com/a/status/1?id=2"
    );
    expect(cleanLink("not a link")).toBeNull();
    expect(cleanLink("https://user:pass@example.com")).toBeNull();
  });

  it("tells the same link apart from how it was written", () => {
    expect(linkKey("https://youtu.be/abc")).toBe(
      linkKey("https://www.youtube.com/watch?v=abc&si=1")
    );
    expect(linkKey("https://twitter.com/a/status/1/")).toBe(
      linkKey("https://x.com/a/status/1")
    );
  });

  it("splits pasted links from the note", () => {
    expect(
      splitPasted("Great talk https://youtu.be/abc\nand www.example.com/x")
    ).toEqual({
      links: ["https://youtu.be/abc", "https://www.example.com/x"],
      note: "Great talk\nand",
    });
  });
});

describe("resolveCatalogs", () => {
  it("shows what was read under what people changed by hand", () => {
    const events = [
      signed(catalogTemplate(project, catalog), ALICE),
      signed(
        linkTemplate(project, {
          ...link,
          edits: { summary: "", title: "My own title" },
        }),
        BOB
      ),
      signed(readingTemplate(project, reading), READER),
    ];
    const [shown] = resolve(events).links;
    expect(shown?.title).toBe("My own title");
    expect(shown?.summary).toBe("");
    expect(shown?.type).toBe("article");
    expect(shown?.byline).toEqual({ name: "Someone" });
    expect(shown?.edited).toEqual(["title", "summary"]);
    expect(shown?.state).toBe("ready");
  });

  it("is being read until the reader answers the latest request", () => {
    const events = [
      signed(catalogTemplate(project, catalog), ALICE),
      signed(linkTemplate(project, { ...link, readAt: 5000 }), BOB),
      signed(readingTemplate(project, reading), READER),
    ];
    expect(resolve(events).links[0]?.state).toBe("reading");
    expect(resolve(events, []).links[0]?.state).toBe("ready");
    expect(resolve(events, []).links[0]?.title).toBe("example.com/post");
  });

  it("only trusts readings from the reader", () => {
    const events = [
      signed(catalogTemplate(project, catalog), ALICE),
      signed(linkTemplate(project, link), BOB),
      signed(readingTemplate(project, reading), STRANGER),
    ];
    expect(resolve(events).links[0]?.title).toBe("example.com/post");
  });

  it("files a link where it was read to go, and under suggestions taken up", () => {
    const withLaunches: CatalogFields = {
      ...catalog,
      categories: [
        ...catalog.categories,
        { color: "green", id: "c3", name: "launches" },
      ],
    };
    const events = [
      signed(catalogTemplate(project, withLaunches), ALICE),
      signed(linkTemplate(project, link), BOB),
      signed(readingTemplate(project, reading), READER),
    ];
    const [shown] = resolve(events).links;
    expect(shown?.categories).toEqual(["c2", "c3"]);
    expect(shown?.suggested).toEqual([]);
  });

  it("keeps what was filed by hand, even nothing, and hides dismissed suggestions", () => {
    const events = [
      signed(
        catalogTemplate(project, { ...catalog, dismissed: ["launches"] }),
        ALICE
      ),
      signed(linkTemplate(project, { ...link, edits: { filed: [] } }), BOB),
      signed(readingTemplate(project, reading), READER),
    ];
    const [shown] = resolve(events).links;
    expect(shown?.categories).toEqual([]);
    expect(shown?.suggested).toEqual([]);
    expect(shown?.edited).toEqual(["categories"]);
  });

  it("drops deleted links, links in deleted catalogs and strangers' versions", () => {
    const catalogEvent = signed(catalogTemplate(project, catalog), ALICE);
    const linkEvent = signed(linkTemplate(project, link), BOB);
    expect(resolve([catalogEvent, linkEvent]).links).toHaveLength(1);
    expect(
      resolve([
        catalogEvent,
        linkEvent,
        signed(
          catalogTombstoneTemplate(project, { event: linkEvent, id: "link1" }),
          ALICE
        ),
      ]).links
    ).toHaveLength(0);
    expect(
      resolve([
        catalogEvent,
        linkEvent,
        signed(
          catalogTombstoneTemplate(project, {
            event: catalogEvent,
            id: "cat1",
          }),
          BOB
        ),
      ]).catalogs
    ).toHaveLength(0);
    expect(
      resolve([
        catalogEvent,
        linkEvent,
        signed(
          linkTemplate(project, { ...link, edits: { title: "Spam" } }),
          STRANGER
        ),
      ]).links[0]?.title
    ).toBe("example.com/post");
  });

  it("reads how sorting went, by category", () => {
    const events = [
      signed(
        catalogTemplate(project, {
          ...catalog,
          sorts: [{ at: 300, category: "c1" }],
        }),
        ALICE
      ),
      signed(
        sortReportTemplate(project, "cat1", [
          { at: 300, category: "c1", checked: 4, filed: 2, ok: true },
          { at: 250, category: "c2", ok: false, reason: "limit" },
        ]),
        READER
      ),
    ];
    const content = resolve(events);
    expect(content.catalogs[0]?.sorts).toEqual([{ at: 300, category: "c1" }]);
    expect(content.sorts.get("cat1")).toEqual([
      { at: 300, category: "c1", checked: 4, filed: 2, ok: true },
      { at: 250, category: "c2", ok: false, reason: "limit" },
    ]);
  });
});

describe("linkCommentTemplate", () => {
  it("tells whoever saved the link, and everyone mentioned", () => {
    const content = `Nice, ${mentionReference(ALICE)}`;
    const template = linkCommentTemplate(
      { author: ALICE, creator: BOB, id: "link1" },
      content
    );
    const people = template.tags.filter(([name]) => name === "p");
    expect(people).toEqual([
      ["p", ALICE],
      ["p", BOB, "", "subscriber"],
    ]);
    expect(template.tags).toContainEqual(["A", `30321:${ALICE}:link1`]);
  });
});
