import { describe, expect, it } from "vitest";

import type { LinkMeta } from "./linkmeta";
import { isPrivateAddress, metaTags } from "./pages";
import type { AiReading } from "./reading";
import {
  parseAiReading,
  readingFields,
  readingSchema,
  sortMatches,
} from "./reading";

const catalog = {
  categories: [
    { color: "blue" as const, id: "c1", name: "Security" },
    { color: "red" as const, id: "c2", name: "Design" },
  ],
  dismissed: ["old topic"],
};

const link = { id: "link1", readAt: 7, url: "https://example.com/a" };

const meta: LinkMeta = {
  creator: { name: "Ana" },
  images: [],
  publishedAt: "2026-01-02",
  siteName: "Example",
  text: "A long look at keys.",
  title: "Keys, explained",
  type: "article",
};

const ai: AiReading = {
  categories: ["security", "Unknown"],
  creator: null,
  newCategories: ["Cryptography", "Old Topic", "design", "cryptography"],
  publishedAt: null,
  summary: "How keys work.",
  title: "How keys work",
  type: "article",
};

describe("readingFields", () => {
  it("takes the model's words, keeping the page's title when it differs", () => {
    const fields = readingFields(link, catalog, meta, ai, {});
    expect(fields).toMatchObject({
      byline: { name: "Ana" },
      categories: ["c1"],
      originalTitle: "Keys, explained",
      readAt: 7,
      state: "ready",
      suggested: ["Cryptography"],
      summary: "How keys work.",
      title: "How keys work",
    });
  });

  it("stands on the page alone without the model", () => {
    const fields = readingFields(link, catalog, meta, undefined, {});
    expect(fields).toMatchObject({
      categories: [],
      state: "ready",
      suggested: [],
      summary: "A long look at keys.",
      title: "Keys, explained",
    });
    expect(fields.originalTitle).toBeUndefined();
  });

  it("fails when nothing could be read", () => {
    expect(readingFields(link, catalog, null, undefined, {}).state).toBe(
      "failed"
    );
  });

  it("titles a post by its first words, and doesn't repeat them as a summary", () => {
    const post = {
      ...meta,
      text: "Shipping today!\nMore soon",
      title: undefined,
    };
    const fields = readingFields(link, catalog, post, undefined, {});
    expect(fields.title).toBe("Shipping today!");
    expect(fields.summary).toBeUndefined();
  });
});

describe("the model's answers", () => {
  it("are read only when in shape", () => {
    expect(parseAiReading({ title: 1 })).toBeUndefined();
    expect(
      parseAiReading({ ...ai, creator: "Bo", type: "nonsense" })
    ).toMatchObject({ creator: "Bo", type: "other" });
  });

  it("asks for the catalog's categories by name, and any name when it has none", () => {
    const schema = readingSchema(["Security"]) as {
      properties: { categories: { items: unknown } };
    };
    expect(schema.properties.categories.items).toEqual({
      enum: ["Security"],
      type: "string",
    });
    const open = readingSchema([]) as typeof schema;
    expect(open.properties.categories.items).toEqual({ type: "string" });
  });

  it("picks sorted links by their numbers, each once", () => {
    const batch = [
      { id: "a", note: "", summary: "", title: "A" },
      { id: "b", note: "", summary: "", title: "B" },
    ];
    expect(
      sortMatches({ matches: [2, 2, 9, 1.2] }, batch).map((item) => item.id)
    ).toEqual(["b", "a"]);
    expect(sortMatches("nonsense", batch)).toEqual([]);
  });
});

describe("pages", () => {
  it("keeps the reader's own network out", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.1",
      "172.20.0.1",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });

  it("reads meta tags by property, name or itemprop, the first of each", () => {
    const tags = metaTags(
      `<meta property="og:title" content="One"><meta name="og:title" content="Two"><meta itemprop="duration" content="PT1M2S">`
    );
    expect(tags.get("og:title")).toBe("One");
    expect(tags.get("duration")).toBe("PT1M2S");
  });
});
