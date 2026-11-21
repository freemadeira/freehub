import { beforeAll, describe, expect, it, vi } from "vitest";

import { CONTENT_MARKDOWN } from "@/components/markdown-editor/content";
import type { SealedImage } from "@/lib/sealed-images";
import {
  isSealedImageAddress,
  parseSealedImage,
  sealedImageAddress,
} from "@/lib/sealed-images";

const IMAGE: SealedImage = {
  hash: "a".repeat(64),
  height: 900,
  key: "b".repeat(64),
  nonce: "c".repeat(24),
  type: "image/webp",
  width: 1600,
};

describe("sealed image addresses", () => {
  it("name the blob, its type, its key and its size", () => {
    const address = sealedImageAddress(IMAGE);
    expect(address).toBe(
      `blossom:${"a".repeat(64)}.webp?key=${"b".repeat(64)}&nonce=${"c".repeat(24)}&dim=1600x900`
    );
    expect(parseSealedImage(address)).toEqual(IMAGE);
  });

  it("leave out a size that wasn't known", () => {
    const { width: _, height: __, ...unsized } = IMAGE;
    const address = sealedImageAddress({ ...unsized, type: "image/svg+xml" });
    expect(address).not.toContain("dim=");
    expect(parseSealedImage(address)).toEqual({
      ...unsized,
      type: "image/svg+xml",
    });
  });

  it("refuse types a text can't show", () => {
    expect(() =>
      sealedImageAddress({ ...IMAGE, type: "image/heic" })
    ).toThrow();
  });

  it("can't be opened without a whole key and nonce", () => {
    const address = sealedImageAddress(IMAGE);
    for (const broken of [
      address.replace(`key=${"b".repeat(64)}`, "key=bb"),
      address.replace(`&nonce=${"c".repeat(24)}`, ""),
      address.replace(".webp", ".exe"),
      address.replace("a".repeat(64), "A".repeat(64)),
      `https://example.com/${"a".repeat(64)}.webp`,
    ]) {
      expect(parseSealedImage(broken)).toBeUndefined();
    }
    expect(isSealedImageAddress(address.replace("key=", "kee="))).toBe(true);
  });

  it("ignore a size that isn't one", () => {
    const address = sealedImageAddress(IMAGE).replace("1600x900", "0x900");
    expect(parseSealedImage(address)?.width).toBeUndefined();
  });
});

describe("images in a text's Markdown", () => {
  const { parse, serialize, unwritten } = CONTENT_MARKDOWN;
  // Links to the app are told apart by the page's origin.
  beforeAll(() => {
    vi.stubGlobal("location", new URL("https://app.example"));
    return () => vi.unstubAllGlobals();
  });
  const address = sealedImageAddress(IMAGE);

  it("keep their address as written", () => {
    const markdown = `Before\n\n![A boat](${address})\n\nAfter`;
    expect(serialize(parse(markdown))).toBe(markdown);
  });

  it("aren't written while they upload, nor is a line of only those", () => {
    const uploading = { attrs: { upload: "u1" }, type: "image" };
    const doc = {
      content: [
        { content: [{ text: "Text", type: "text" }], type: "paragraph" },
        { content: [uploading], type: "paragraph" },
        {
          content: [{ text: "Beside ", type: "text" }, uploading],
          type: "paragraph",
        },
      ],
      type: "doc",
    };
    expect(serialize(doc)).toBe("Text\n\nBeside");
    expect(unwritten({ content: [uploading], type: "paragraph" })).toBe(true);
    expect(unwritten({ content: [], type: "paragraph" })).toBe(false);
  });
});
