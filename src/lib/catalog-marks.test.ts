import { describe, expect, it } from "vitest";

import type { CatalogsDoc } from "@/lib/catalog-marks";
import {
  isNewTo,
  mergeCatalogsDocs,
  parseCatalogsDoc,
  serializeCatalogsDoc,
  starredLinks,
  withAllSeen,
  withSeen,
  withStars,
} from "@/lib/catalog-marks";

const ME = "me";
const THEM = "them";
const catalog = { createdAt: 100, id: "cat" };
const link = (id: string, savedAt: number, savedBy = THEM) => ({
  id,
  savedAt,
  savedBy,
});
const started: CatalogsDoc = { seen: {}, since: 50, stars: [] };

describe("what's new", () => {
  it("is nothing before marks are read", () => {
    expect(isNewTo({ seen: {}, stars: [] }, catalog, link("a", 200), ME)).toBe(
      false
    );
  });

  it("is what others saved since the catalog was made, that same second too", () => {
    expect(isNewTo(started, catalog, link("a", 100), ME)).toBe(true);
    expect(isNewTo(started, catalog, link("b", 99), ME)).toBe(false);
    expect(isNewTo(started, catalog, link("c", 150, ME), ME)).toBe(false);
  });

  it("moves on past whole seconds only, keeping the rest seen out of order", () => {
    const links = [link("a", 101), link("b", 101), link("c", 102)];
    const once = withSeen(started, catalog, links, ["a"], ME);
    expect(once.seen.cat).toEqual({ seen: ["a"], upTo: 99 });
    expect(isNewTo(once, catalog, links[1] ?? link("", 0), ME)).toBe(true);
    const twice = withSeen(once, catalog, links, ["b"], ME);
    expect(twice.seen.cat).toEqual({ seen: [], upTo: 101 });
    expect(isNewTo(twice, catalog, links[2] ?? link("", 0), ME)).toBe(true);
  });

  it("is nothing once everything is marked seen", () => {
    const all = withAllSeen(started, catalog, 500);
    expect(isNewTo(all, catalog, link("a", 400), ME)).toBe(false);
    expect(isNewTo(all, catalog, link("b", 501), ME)).toBe(true);
  });
});

describe("two devices' marks", () => {
  it("keep the earliest start, the furthest caught up, and the newest star", () => {
    const a: CatalogsDoc = {
      seen: { cat: { seen: ["x"], upTo: 120 } },
      since: 60,
      stars: [{ at: 5, id: "l1", starred: true }],
    };
    const b: CatalogsDoc = {
      seen: { cat: { seen: ["y"], upTo: 110 } },
      since: 40,
      stars: [
        { at: 9, id: "l1", starred: false },
        { at: 3, id: "l2", starred: true },
      ],
    };
    const merged = mergeCatalogsDocs(a, b);
    expect(merged.since).toBe(40);
    expect(merged.seen.cat?.upTo).toBe(120);
    expect(new Set(merged.seen.cat?.seen)).toEqual(new Set(["x", "y"]));
    expect([...starredLinks(merged)]).toEqual(["l2"]);
  });

  it("read back as written", () => {
    const doc = withStars(started, ["l1", "l2"], true, 7);
    const again = parseCatalogsDoc(serializeCatalogsDoc(doc));
    expect(again && [...starredLinks(again)].toSorted()).toEqual(["l1", "l2"]);
    expect(again?.since).toBe(50);
    expect(parseCatalogsDoc("not json")).toBeUndefined();
  });
});
