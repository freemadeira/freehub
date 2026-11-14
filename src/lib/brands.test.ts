import type { NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";

import type {
  BrandFields,
  ColorFields,
  FileFields,
  FontFields,
} from "@/lib/brands";
import {
  brandTemplate,
  brandTokens,
  brandTombstoneTemplate,
  contrast,
  contrastGrade,
  faceOfFile,
  formatCmyk,
  formatHsl,
  logoFor,
  parseHex,
  partTemplate,
  partTombstoneTemplate,
  pickMark,
  resolveBrands,
  textFonts,
  tokenNames,
} from "@/lib/brands";
import type { Template } from "@/lib/model";
import type { Project } from "@/lib/project";
import { blobsToDelete } from "@/lib/sealed-files";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const STRANGER = "d".repeat(64);
const HASH = "e".repeat(64);
const THUMB = "f".repeat(64);
const KEY = "1".repeat(64);
const NONCE = "2".repeat(24);

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

const brand: BrandFields = {
  createdAt: 100,
  creator: ALICE,
  description: "Bitcoin on the island",
  guide: "## Do\n\nUse the symbol on light backgrounds.",
  id: "b1",
  socials: ["https://x.com/freemadeira"],
  title: "Free Madeira",
  website: "https://freemadeira.org/",
};

const yellow: ColorFields = {
  brand: "b1",
  createdAt: 200,
  hex: "#ffcb05",
  id: "c1",
  name: "Sunshine",
  part: "color",
  rank: 1,
};

const ink: ColorFields = {
  ...yellow,
  hex: "#0a0d14",
  id: "c2",
  name: "Ink",
  rank: 2,
};

const inter: FontFields = {
  brand: "b1",
  createdAt: 300,
  family: "Inter",
  id: "f1",
  part: "font",
  rank: 1,
  role: "Body",
  source: "library",
  weights: [400, 700],
};

const symbol: FileFields = {
  blob: { hash: HASH, nonce: NONCE },
  brand: "b1",
  caption: "",
  createdAt: 400,
  creator: BOB,
  height: 64,
  id: "file1",
  key: KEY,
  name: "symbol.svg",
  part: "file",
  place: { kind: "logo", logo: "symbol", mode: "dark" },
  rank: 1,
  size: 1234,
  thumb: { hash: THUMB, nonce: NONCE },
  type: "image/svg+xml",
  width: 64,
};

describe("resolveBrands", () => {
  it("reads a brand and its parts back as written, in order", () => {
    const events = [
      signed(brandTemplate(project, brand), ALICE),
      signed(partTemplate(project, ink), BOB),
      signed(partTemplate(project, yellow), ALICE),
      signed(partTemplate(project, inter), ALICE),
      signed(partTemplate(project, symbol), BOB),
    ];
    const content = resolveBrands(project, events);
    expect(content.brands.map((item) => item.title)).toEqual(["Free Madeira"]);
    const [read] = content.brands;
    expect(read?.guide).toBe(brand.guide);
    expect(read?.website).toBe("https://freemadeira.org/");
    expect(read?.socials).toEqual(["https://x.com/freemadeira"]);
    const parts = content.parts.get("b1");
    expect(parts?.colors.map((color) => color.name)).toEqual([
      "Sunshine",
      "Ink",
    ]);
    expect(parts?.fonts[0]).toMatchObject({
      family: "Inter",
      role: "Body",
      source: "library",
      weights: [400, 700],
    });
    expect(parts?.files[0]).toMatchObject({
      blob: symbol.blob,
      creator: BOB,
      place: symbol.place,
      thumb: symbol.thumb,
      type: "image/svg+xml",
      width: 64,
    });
  });

  it("lets the newest version across members win, and ignores outsiders", () => {
    const events = [
      signed(brandTemplate(project, brand), ALICE),
      signed(brandTemplate(project, { ...brand, title: "Renamed" }), BOB),
      signed(brandTemplate(project, { ...brand, title: "Hijacked" }), STRANGER),
    ];
    const content = resolveBrands(project, events);
    expect(content.brands[0]?.title).toBe("Renamed");
    expect(content.versions.get("b1")).toHaveLength(2);
  });

  it("drops deleted brands and their parts, keeping file tombstones for cleanup", () => {
    const filePart = signed(partTemplate(project, symbol), BOB);
    const content = resolveBrands(project, [
      signed(brandTemplate(project, brand), ALICE),
      signed(partTemplate(project, yellow), ALICE),
      filePart,
      signed(
        partTombstoneTemplate(
          project,
          resolveBrands(project, [
            signed(brandTemplate(project, brand), ALICE),
            filePart,
          ]).parts.get("b1")?.files[0] as never
        ),
        ALICE
      ),
      signed(brandTombstoneTemplate(project, brand), ALICE),
    ]);
    expect(content.brands).toEqual([]);
    expect(content.parts.size).toBe(0);
    expect(content.deleted).toHaveLength(1);
    const [tombstone] = content.deleted;
    expect(tombstone && blobsToDelete(tombstone, BOB)).toEqual([HASH, THUMB]);
    expect(tombstone && blobsToDelete(tombstone, ALICE)).toEqual([]);
  });

  it("leaves out parts it can't read", () => {
    const content = resolveBrands(project, [
      signed(brandTemplate(project, brand), ALICE),
      signed(
        partTemplate(project, { ...yellow, hex: "#nothex" as never }),
        ALICE
      ),
      signed(partTemplate(project, { ...symbol, key: "short" }), ALICE),
    ]);
    expect(content.parts.get("b1")).toBeUndefined();
  });
});

describe("guidelines", () => {
  it("names the version they were edited from", () => {
    const prev = signed(brandTemplate(project, brand), ALICE);
    const next = brandTemplate(project, { ...brand, guide: "New" }, prev);
    expect(next.content).toBe("New");
    expect(next.tags).toContainEqual(["prev", prev.id]);
  });
});

function readFiles(file: FileFields) {
  return (
    resolveBrands(project, [
      signed(brandTemplate(project, brand), ALICE),
      signed(partTemplate(project, file), ALICE),
    ]).parts.get("b1")?.files ?? []
  );
}

describe("logos", () => {
  it("falls back to the other background's logo", () => {
    const files = readFiles(symbol);
    expect(logoFor(files, ["symbol"], "light")?.mode).toBe("dark");
    expect(pickMark(files)?.file.id).toBe("file1");
  });

  it("never shows print files in place", () => {
    const files = readFiles({
      ...symbol,
      name: "logo.pdf",
      type: "application/pdf",
    });
    expect(pickMark(files)).toBeUndefined();
  });
});

describe("colors", () => {
  it("reads hex as typed", () => {
    expect(parseHex("FC0")).toBe("#ffcc00");
    expect(parseHex("#AABBCC")).toBe("#aabbcc");
    expect(parseHex("#abcd")).toBeUndefined();
  });

  it("converts and grades contrast", () => {
    expect(formatHsl("#ff0000")).toBe("0°, 100%, 50%");
    expect(formatCmyk("#000000")).toBe("0, 0, 0, 100");
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21);
    expect(contrastGrade(4.6)).toBe("AA");
    expect(contrastGrade(2)).toBe("Fails");
  });

  it("names tokens once each", () => {
    expect(
      tokenNames([{ name: "Brand Blue" }, { name: "Brand blue" }, { name: "" }])
    ).toEqual(["brand-blue", "brand-blue-2", "color-3"]);
  });
});

describe("type", () => {
  it("tells a font file's face by its name", () => {
    expect(faceOfFile("Inter-SemiBoldItalic.woff2")).toEqual({
      style: "italic",
      weight: 600,
    });
    expect(faceOfFile("Brand-700.otf").weight).toBe(700);
  });

  it("picks heading and body typefaces by role, else by order", () => {
    const display = { ...inter, id: "f2", role: "Headings" };
    expect(textFonts([inter, display])).toMatchObject({
      body: { id: "f1" },
      heading: { id: "f2" },
    });
    expect(textFonts([{ ...inter, role: "" }]).body?.id).toBe("f1");
  });
});

describe("brandTokens", () => {
  it("writes colors and typefaces as CSS, Tailwind and design tokens", () => {
    const colors = [yellow, ink];
    const fonts = [{ ...inter, role: "Headings, Body" }];
    expect(brandTokens(brand, colors, fonts, "css")).toBe(
      ':root {\n  --free-madeira-sunshine: #ffcb05;\n  --free-madeira-ink: #0a0d14;\n  --free-madeira-font-headings: "Inter", sans-serif;\n  --free-madeira-font-body: "Inter", sans-serif;\n}\n'
    );
    expect(brandTokens(brand, colors, fonts, "tailwind")).toContain(
      "  --color-sunshine: #ffcb05;"
    );
    expect(JSON.parse(brandTokens(brand, colors, fonts, "dtcg"))).toEqual({
      color: {
        ink: { $type: "color", $value: "#0a0d14" },
        sunshine: { $type: "color", $value: "#ffcb05" },
      },
      font: {
        body: { $type: "fontFamily", $value: ["Inter", "sans-serif"] },
        headings: { $type: "fontFamily", $value: ["Inter", "sans-serif"] },
      },
    });
  });
});
