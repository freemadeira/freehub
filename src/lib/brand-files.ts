import { useEffect } from "react";

import type { BrandFile, BrandFont } from "@/lib/brands";
import {
  cssWeight,
  fileFace,
  filesIn,
  libraryFontUrl,
  uploadedFamily,
} from "@/lib/brands";
import type { Sealed } from "@/lib/drive-files";
import { fetchSealed, fileSource } from "@/lib/drive-files";

/**
 * A brand's files as the browser opens them, and its typefaces drawn on the
 * page: the library's through their stylesheet, uploaded ones fetched,
 * opened and added as font faces. Each loads once a visit; text set in them
 * redraws on its own once they arrive.
 */

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
/** Uploaded font files added as faces, or on their way, by blob and face. */
const faces = new Set<string>();

/** A file as a face: set again in another weight or style, it's added again. */
function faceKey(file: BrandFile): string {
  const face = fileFace(file);
  return `${file.blob.hash}:${face.weight}:${face.style}`;
}

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
  const family = uploadedFamily(font);
  await Promise.all(
    files.map(async (file) => {
      const key = faceKey(file);
      faces.add(key);
      try {
        const blob = await fetchBrandFile(file);
        const data = await blob.arrayBuffer();
        const face = fileFace(file);
        const loaded = await new FontFace(family, data, {
          display: "swap",
          style: face.style,
          weight: cssWeight(face),
        }).load();
        document.fonts.add(loaded);
      } catch {
        // Left out until the page is loaded again; the others still show.
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
        (file) => !faces.has(faceKey(file))
      );
      if (font.source === "file" && fresh.length > 0) {
        addFaces(font, fresh);
      }
    }
  }, [fonts, files]);
}
