import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { ARTICLE_MARKDOWN } from "@/components/markdown-editor/article";

const { parse, serialize } = ARTICLE_MARKDOWN;

/** The Markdown as it's saved after being opened in the editor. */
function resaved(markdown: string): string {
  return serialize(parse(markdown));
}

function blocks(markdown: string): JSONContent[] {
  return parse(markdown).content ?? [];
}

function marksOf(markdown: string): string[][] {
  return (blocks(markdown)[0]?.content ?? []).map(
    (node) => node.marks?.map((mark) => mark.type) ?? []
  );
}

describe("pull quotes", () => {
  it("reads one, its text inline", () => {
    expect(blocks("> [!PULLQUOTE]\n> The money does **both** jobs.")).toEqual([
      {
        content: [
          { text: "The money does ", type: "text" },
          { marks: [{ type: "bold" }], text: "both", type: "text" },
          { text: " jobs.", type: "text" },
        ],
        type: "pullQuote",
      },
    ]);
  });

  it("writes and reads back the same", () => {
    const markdown =
      "Before.\n\n> [!PULLQUOTE]\n> The money does both jobs.  \n> At once.\n\nAfter.";
    expect(resaved(markdown)).toBe(markdown);
    expect(resaved(resaved(markdown))).toBe(markdown);
  });

  it("reads the marker in any case, right after a line", () => {
    expect(blocks("Line\n> [!pullquote]\n> Loud.")).toEqual([
      { content: [{ text: "Line", type: "text" }], type: "paragraph" },
      { content: [{ text: "Loud.", type: "text" }], type: "pullQuote" },
    ]);
  });

  it("leaves other quotes and alerts as quotes", () => {
    expect(blocks("> Someone said this.")[0]?.type).toBe("blockquote");
    expect(blocks("> [!NOTE]\n> A note.")[0]?.type).toBe("blockquote");
  });

  it("keeps an empty one", () => {
    expect(resaved("> [!PULLQUOTE]")).toBe("> [!PULLQUOTE]");
  });

  it("keeps a line that reads like a heading as text", () => {
    const markdown = "> [!PULLQUOTE]\n> \\# not a heading";
    expect(blocks(markdown)[0]?.content?.[0]?.text).toBe("# not a heading");
    expect(resaved(markdown)).toBe(markdown);
  });

  it("gives a picture inside one a line of its own", () => {
    const url = "https://media.example.org/a.webp";
    expect(
      blocks(`> [!PULLQUOTE]\n> Look ![A beach](${url})`).map(
        (node) => node.type
      )
    ).toEqual(["pullQuote", "image"]);
  });
});

describe("highlighted text", () => {
  it("reads ==text== as highlighted", () => {
    expect(marksOf("The sats ==stay inside== the loop.")).toEqual([
      [],
      ["highlight"],
      [],
    ]);
  });

  it("writes and reads back the same", () => {
    for (const markdown of [
      "The sats ==stay inside== the loop.",
      "==**Bold** and marked==",
      "> [!PULLQUOTE]\n> One ==marked== word.",
      "- a ==marked== item",
    ]) {
      expect(resaved(markdown)).toBe(markdown);
    }
  });

  it("needs text right inside the marks, as bold does", () => {
    for (const markdown of ["a == b == c", "== a ==", "===a===", "a ==b"]) {
      expect(marksOf(markdown).flat()).toEqual([]);
    }
  });

  it("allows a single = inside", () => {
    expect(marksOf("==E=mc2==")).toEqual([["highlight"]]);
  });
});

/** A paragraph of text runs, each highlighted or not. */
function line(...runs: [string, boolean][]): JSONContent {
  return {
    content: [
      {
        content: runs.map(([text, marked]) =>
          marked
            ? { marks: [{ type: "highlight" }], text, type: "text" }
            : { text, type: "text" }
        ),
        type: "paragraph",
      },
    ],
    type: "doc",
  };
}

describe("= in text", () => {
  it("stays text where it could read as a highlight", () => {
    for (const text of ["x ==a== y", "x==a==y", "= 5", "five =", "a === b"]) {
      expect(parse(serialize(line([text, false])))).toEqual(
        line([text, false])
      );
    }
  });

  it("stays unescaped where it can't", () => {
    expect(serialize(line(["E=mc2 and a = b", false]))).toBe("E=mc2 and a = b");
  });

  it("stays text inside a highlight, even at its ends", () => {
    for (const runs of [
      [["a=", true]],
      [["=a", true]],
      [["a == b", true]],
      [
        ["x", true],
        ["=y", false],
      ],
      [
        ["y=", false],
        ["x", true],
      ],
    ] as [string, boolean][][]) {
      expect(parse(serialize(line(...runs)))).toEqual(line(...runs));
    }
  });

  it("stays as written in code", () => {
    expect(resaved("`a == b ==c==`")).toBe("`a == b ==c==`");
  });
});

describe("saving twice", () => {
  it("writes what it wrote the first time", () => {
    const url = "https://media.example.org/a.webp";
    for (const markdown of [
      "> [!PULLQUOTE]\n>  spaced",
      `> [!PULLQUOTE]\n> Look ![A beach](${url}) after`,
      "x \\=\\=a\\=\\= y",
    ]) {
      expect(resaved(resaved(markdown))).toBe(resaved(markdown));
    }
  });
});
