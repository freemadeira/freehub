import type { FileKind } from "@/lib/drive";

/** What the browser could learn about a file before uploading it. */
export interface Measured {
  /** A small picture of it, for tiles; missing when there's none or the file is small enough. */
  thumbnail?: Blob;
  width?: number;
  height?: number;
  duration?: number;
}

/** The longest side of a thumbnail: sharp on a tile at twice the pixels. */
export const THUMB_SIDE = 640;
/** Images this small, in pixels and bytes, are their own thumbnail. */
const OWN_THUMB_BYTES = 300 * 1024;
/** Past these, reading the file to draw it costs more than the picture is worth. */
const MAX_IMAGE_BYTES = 60 * 1024 * 1024;
const MAX_PDF_BYTES = 60 * 1024 * 1024;
const MEDIA_TIMEOUT = 15_000;

function fit(width: number, height: number): [number, number] {
  const scale = Math.min(1, THUMB_SIDE / Math.max(width, height));
  return [
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  ];
}

/**
 * Draws the source small, as WebP where the browser can write it and PNG
 * otherwise, which keeps transparency too.
 */
export async function draw(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<Blob | undefined> {
  if (typeof OffscreenCanvas === "undefined") {
    return undefined;
  }
  const [w, h] = fit(width, height);
  const canvas = new OffscreenCanvas(w, h);
  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, w, h);
  return await canvas.convertToBlob({ quality: 0.82, type: "image/webp" });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  return image.decode().then(() => image);
}

async function measureImage(file: File): Promise<Measured> {
  if (file.size > MAX_IMAGE_BYTES) {
    return {};
  }
  const url = URL.createObjectURL(file);
  try {
    // SVGs need an <img> to have a size; bitmaps decode faster off the main thread.
    const source =
      file.type === "image/svg+xml"
        ? await loadImage(url)
        : await createImageBitmap(file).catch(() => loadImage(url));
    const width = "naturalWidth" in source ? source.naturalWidth : source.width;
    const height =
      "naturalHeight" in source ? source.naturalHeight : source.height;
    const small =
      Math.max(width, height) <= THUMB_SIDE && file.size <= OWN_THUMB_BYTES;
    const thumbnail =
      small || !width || !height
        ? undefined
        : await draw(source, width, height);
    if ("close" in source) {
      source.close();
    }
    return { height, thumbnail, width };
  } catch {
    // HEIC photos and the like: the browser can't draw them, the icon stands in.
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

function once(target: EventTarget, event: string): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- media elements only tell they're ready through events
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out")),
      MEDIA_TIMEOUT
    );
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    target.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Can’t read it"));
      },
      { once: true }
    );
  });
}

async function measureVideo(file: File): Promise<Measured> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  try {
    const loaded = once(video, "loadeddata");
    video.src = url;
    await loaded;
    const { duration, videoWidth: width, videoHeight: height } = video;
    const measured: Measured = {
      duration: Number.isFinite(duration) ? duration : undefined,
      height,
      width,
    };
    // A frame a little in, past the black the first one often is.
    const seeked = once(video, "seeked");
    video.currentTime = Math.min(1.5, (measured.duration ?? 0) / 3);
    await seeked;
    if (width && height) {
      measured.thumbnail = await draw(video, width, height);
    }
    return measured;
  } catch {
    // A codec the browser doesn't play, like some phones' HEVC: no picture.
    return {};
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function measureAudio(file: File): Promise<Measured> {
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  audio.preload = "metadata";
  try {
    const loaded = once(audio, "loadedmetadata");
    audio.src = url;
    await loaded;
    return Number.isFinite(audio.duration) ? { duration: audio.duration } : {};
  } catch {
    return {};
  } finally {
    audio.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

async function measurePdf(file: File): Promise<Measured> {
  if (file.size > MAX_PDF_BYTES) {
    return {};
  }
  try {
    // PDF.js is big, so it's only fetched once someone uploads a PDF.
    const { pdfThumbnail } = await import("@/lib/pdf-thumbnail");
    return await pdfThumbnail(file);
  } catch {
    return {};
  }
}

/** Sizes, length and a thumbnail for a file about to be uploaded, as far as the browser can tell. */
export function measure(file: File, kind: FileKind): Promise<Measured> {
  switch (kind) {
    case "image": {
      return measureImage(file);
    }
    case "video": {
      return measureVideo(file);
    }
    case "audio": {
      return measureAudio(file);
    }
    case "pdf": {
      return measurePdf(file);
    }
    default: {
      return Promise.resolve({});
    }
  }
}
