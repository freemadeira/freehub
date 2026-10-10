import type { Grid } from "./format.ts";

/** `landcover.png` as one `COVER` class per cell, rows north to south. */
export async function loadCover(url: string, grid: Grid): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const canvas = new OffscreenCanvas(grid.width, grid.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("2D canvas unavailable");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context.getImageData(0, 0, grid.width, grid.height).data;
  const classes = new Uint8Array(grid.width * grid.height);
  for (let cell = 0; cell < classes.length; cell += 1) {
    classes[cell] = pixels[cell * 4] ?? 0;
  }
  return classes;
}
