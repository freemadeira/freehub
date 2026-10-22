import { describe, expect, it } from "vitest";

import {
  CARD_KEY,
  hasTerms,
  matchScore,
  plainText,
  searchable,
  searchTerms,
  snippet,
} from "@/lib/search";

describe("searchTerms", () => {
  it("keeps each word once, lowercase, in the order typed", () => {
    expect(searchTerms("Café  menu, café MENU")).toEqual(["café", "menu"]);
  });

  it("splits on anything that isn't a letter or a number", () => {
    expect(searchTerms("FREE-12")).toEqual(["free", "12"]);
  });
});

describe("matchScore", () => {
  it("ranks the name itself over a start over words anywhere", () => {
    const terms = searchTerms("bitcoin shop");
    expect(matchScore("Bitcoin shop", terms)).toBe(3);
    expect(matchScore("Bitcoin shops of Funchal", terms)).toBe(2);
    expect(matchScore("The shop taking bitcoin", terms)).toBe(1);
    expect(matchScore("Bitcoin", terms)).toBe(0);
  });

  it("matches words by how they start, not anywhere inside them", () => {
    expect(matchScore("Dashboard", ["board"])).toBe(0);
    expect(matchScore("Board", ["bo"])).toBe(2);
  });
});

describe("hasTerms", () => {
  it("needs every word to start a word of the text", () => {
    const text = searchable("Ask the bakery about Lightning");
    expect(hasTerms(text, ["bake", "light"])).toBe(true);
    expect(hasTerms(text, ["bake", "night"])).toBe(false);
    expect(hasTerms(text, [])).toBe(false);
  });
});

describe("plainText", () => {
  it("reads markdown as text, without marks, targets or mentions", () => {
    expect(
      plainText(
        "# Plan\n\n- [x] **Call** the [bakery](https://example.com) ![logo](a.png)\nnostr:npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq about <https://hub.example/FREE-12>"
      )
    ).toBe("Plan Call the bakery about https://hub.example/FREE-12");
  });
});

describe("snippet", () => {
  const text =
    "We met the owner last week. The bakery on the corner wants to take bitcoin payments for coffee and cakes from next month on, once the terminal arrives and the staff learned how it works.";

  it("starts a little before the first word found, on a word", () => {
    const found = snippet(text, ["terminal"]);
    expect(found?.startsWith("…")).toBe(true);
    expect(found).toContain("terminal");
    expect(found?.at(1)).not.toBe(" ");
  });

  it("finds words by how they start", () => {
    expect(snippet(text, ["ake"])).toBeUndefined();
    expect(snippet(text, ["cake"])).toContain("cakes");
  });

  it("shows short text whole", () => {
    expect(snippet("Bitcoin accepted", ["bitcoin"])).toBe("Bitcoin accepted");
  });
});

describe("CARD_KEY", () => {
  it("takes a board code and a number in any case", () => {
    expect(CARD_KEY.test("free-12")).toBe(true);
    expect(CARD_KEY.test("FREE-12")).toBe(true);
    expect(CARD_KEY.test("free 12")).toBe(false);
    expect(CARD_KEY.test("12-free")).toBe(false);
  });
});
