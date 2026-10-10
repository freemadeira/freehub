import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
// oxlint-disable-next-line import/default -- Vite's ?url imports export the asset's address
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { Measured } from "@/lib/thumbnails";
import { draw, THUMB_SIDE } from "@/lib/thumbnails";

GlobalWorkerOptions.workerSrc = workerUrl;

/** The first page of a PDF, drawn small. */
export async function pdfThumbnail(file: File): Promise<Measured> {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: THUMB_SIDE / Math.max(base.width, base.height),
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return { thumbnail: await draw(canvas, canvas.width, canvas.height) };
  } finally {
    await task.destroy();
  }
}
