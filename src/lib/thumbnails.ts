import type { FileKind } from "@/lib/drive";
import type { Decoded } from "@/lib/images";
import { decodeImage, drawImage } from "@/lib/images";

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

/** Draws the source small, as a thumbnail for tiles. */
export function draw(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<Blob | undefined> {
  const [w, h] = fit(width, height);
  return drawImage(source, w, h);
}

async function measureImage(file: File): Promise<Measured> {
  if (file.size > MAX_IMAGE_BYTES) {
    return {};
  }
  let decoded: Decoded | undefined;
  try {
    decoded = await decodeImage(file);
    const { source, width, height } = decoded;
    const small =
      Math.max(width, height) <= THUMB_SIDE && file.size <= OWN_THUMB_BYTES;
    const thumbnail =
      small || !width || !height
        ? undefined
        : await draw(source, width, height);
    return { height, thumbnail, width };
  } catch {
    // HEIC photos and the like: the browser can't draw them, the icon stands in.
    return {};
  } finally {
    decoded?.close();
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
