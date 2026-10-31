/**
 * Pictures read and drawn in the browser: the Drive's thumbnails, and the
 * sizes a blog post's pictures are published in.
 */

/** Good enough to look sharp, small enough to load fast. */
export const WEBP_QUALITY = 0.82;

/** A picture decoded and ready to draw, and its size in pixels. */
export interface Decoded {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  /** Lets go of the decoded pixels. */
  close: () => void;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  return image.decode().then(() => image);
}

/**
 * Decodes a picture, off the main thread where the browser can. Throws when
 * it can't read it, as with HEIC photos in most browsers.
 */
export async function decodeImage(file: Blob): Promise<Decoded> {
  const url = URL.createObjectURL(file);
  try {
    // SVGs need an <img> to have a size; bitmaps decode faster off the main thread.
    const source =
      file.type === "image/svg+xml"
        ? await loadImage(url)
        : await createImageBitmap(file).catch(() => loadImage(url));
    const bitmap = "close" in source;
    return {
      close: () => {
        if (bitmap) {
          source.close();
        }
      },
      height: bitmap ? source.height : source.naturalHeight,
      source,
      width: bitmap ? source.width : source.naturalWidth,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Draws the source at this size, as WebP where the browser can write it and
 * PNG otherwise, which keeps transparency too. Undefined where there's no
 * canvas to draw on.
 */
export async function drawImage(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<Blob | undefined> {
  if (typeof OffscreenCanvas === "undefined") {
    return undefined;
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return await canvas.convertToBlob({
    quality: WEBP_QUALITY,
    type: "image/webp",
  });
}
