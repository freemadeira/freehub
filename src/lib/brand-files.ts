import { useEffect } from "react";

import type { BrandFile, BrandFont } from "@/lib/brands";
import { cssFamily, faceOfFile, filesIn, libraryFontUrl } from "@/lib/brands";
import { mimeOf } from "@/lib/drive";
import type { Sealed } from "@/lib/drive-files";
import { fetchSealed } from "@/lib/drive-files";

/**
 * A brand's files as the browser opens them, and its typefaces drawn on the
 * page: the library's through their stylesheet, uploaded ones fetched,
 * opened and added as font faces. Each loads once a visit; text set in them
 * redraws on its own once they arrive.
 */

export function fileSource(file: BrandFile): Sealed {
  return { blob: file.blob, key: file.key, type: mimeOf(file) };
}

/** What a tile shows of the file: its thumbnail, else the file itself. */
export function pictureSource(file: BrandFile): Sealed {
  return file.thumb
    ? { blob: file.thumb, key: file.key, type: "image/webp" }
    : fileSource(file);
}

/** The file opened, as a blob of its type. */
export function fetchBrandFile(file: BrandFile): Promise<Blob> {
  return fetchSealed(fileSource(file));
}

/** Stylesheets on the page, by address, and whether the library had them. */
const sheets = new Map<string, Promise<boolean>>();
/** Uploaded font files added as faces, or on their way, by blob. */
const faces = new Set<string>();

/** Adds a stylesheet to the page; resolves with whether it loaded. */
function addSheet(url: string): Promise<boolean> {
  let loading = sheets.get(url);
  if (!loading) {
    // oxlint-disable-next-line promise/avoid-new -- a link only answers through events
    loading = new Promise<boolean>((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.addEventListener("load", () => resolve(true), { once: true });
      link.addEventListener(
        "error",
        () => {
          link.remove();
          sheets.delete(url);
          resolve(false);
        },
        { once: true }
      );
      document.head.append(link);
    });
    sheets.set(url, loading);
  }
  return loading;
}

/** Loads a library family in the weights; resolves with whether the library has it. */
export function loadLibraryFont(
  family: string,
  weights: number[]
): Promise<boolean> {
  return addSheet(libraryFontUrl(family, weights));
}

/** Fetches the files and adds each as a face of the typeface's own family. */
async function addFaces(font: BrandFont, files: BrandFile[]): Promise<void> {
  // The family as cssFamily names it, without its quotes and fallbacks.
  const family = cssFamily(font).split('"')[1] ?? font.family;
  await Promise.all(
    files.map(async (file) => {
      faces.add(file.blob.hash);
      try {
        const blob = await fetchBrandFile(file);
        const data = await blob.arrayBuffer();
        const { style, weight } = faceOfFile(file.name);
        const face = new FontFace(family, data, {
          display: "swap",
          style,
          weight: String(weight),
        });
        document.fonts.add(await face.load());
      } catch {
        // Tried again on the next visit; the others still show.
        faces.delete(file.blob.hash);
      }
    })
  );
}

/** Loads the brand's typefaces while it's shown, each once a visit. */
export function useBrandFonts(fonts: BrandFont[], files: BrandFile[]): void {
  const library = fonts
    .filter((font) => font.source === "library")
    .map((font) => `${font.family}:${font.weights.join(";")}`)
    .join("|");

  useEffect(() => {
    for (const entry of library.split("|").filter(Boolean)) {
      const [family = "", weights = ""] = entry.split(":");
      loadLibraryFont(family, weights.split(";").filter(Boolean).map(Number));
    }
  }, [library]);

  // Runs on every change to the brand's files, but only files not yet added load.
  useEffect(() => {
    for (const font of fonts) {
      const fresh = filesIn(files, { font: font.id, kind: "font" }).filter(
        (file) => !faces.has(file.blob.hash)
      );
      if (font.source === "file" && fresh.length > 0) {
        addFaces(font, fresh);
      }
    }
  }, [fonts, files]);
}
