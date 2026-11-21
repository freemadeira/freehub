import { authorize, CanceledError, uploadBlob } from "@/lib/blossom";
import type { ImageSender } from "@/lib/image-uploads";
import type { Decoded } from "@/lib/images";
import { decodeImage, drawImage } from "@/lib/images";
import { sealedImageAddress, showsAsIs } from "@/lib/sealed-images";
import { newKey, newNonce, seal, sha256 } from "@/lib/sealing";

/** Big enough for a phone photo, sealed whole in memory. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Past this many pixels, a picture takes more memory to draw than a browser can spare. */
const MAX_IMAGE_PIXELS = 100_000_000;
/** The longest side a text needs: sharp on a wide screen, light to load. */
const MAX_SIDE = 2560;
/** Pictures lighter than this, and not too big, go up as they are. */
const LIGHT_BYTES = 3 * 1024 * 1024;

/** The picture as it goes up, and its size in pixels. */
interface Prepared {
  data: Blob;
  width: number;
  height: number;
}

async function decode(file: File): Promise<Decoded> {
  try {
    return await decodeImage(file);
  } catch {
    throw new Error(
      "This browser can’t read that picture. Try a JPEG, PNG or WebP."
    );
  }
}

/**
 * The picture made fit for a text: big photos drawn smaller, as WebP. GIFs
 * keep their motion and SVGs their lines; light pictures go as they are.
 */
async function prepare(file: File): Promise<Prepared> {
  const decoded = await decode(file);
  try {
    const { source, width, height } = decoded;
    // An SVG may name no size of its own; it still draws at any.
    if (file.type === "image/gif" || file.type === "image/svg+xml") {
      return { data: file, height, width };
    }
    if (!(width && height)) {
      throw new Error("That picture has no size to draw.");
    }
    const asIs = showsAsIs(file.type);
    const longest = Math.max(width, height);
    if (asIs && longest <= MAX_SIDE && file.size <= LIGHT_BYTES) {
      return { data: file, height, width };
    }
    if (width * height > MAX_IMAGE_PIXELS) {
      throw new Error(
        "That picture is too big to draw: make it smaller than 100 megapixels."
      );
    }
    const scale = Math.min(1, MAX_SIDE / longest);
    const drawnWidth = Math.max(1, Math.round(width * scale));
    const drawnHeight = Math.max(1, Math.round(height * scale));
    const drawn = await drawImage(source, drawnWidth, drawnHeight);
    // Drawn no smaller than it was, it goes as it was.
    if (asIs && (!drawn || (scale === 1 && drawn.size >= file.size))) {
      return { data: file, height, width };
    }
    if (!drawn) {
      throw new Error(
        "This browser can’t read that picture. Try a JPEG, PNG or WebP."
      );
    }
    return { data: drawn, height: drawnHeight, width: drawnWidth };
  } finally {
    decoded.close();
  }
}

/**
 * Encrypts a picture and sends it to the team's Blossom server; resolves
 * with the `blossom:` address the text shows it by.
 */
export const uploadSealedImage: ImageSender = async (
  file,
  { onProgress, signal }
) => {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Pictures can be up to 25 MB.");
  }
  const { data, width, height } = await prepare(file);
  const key = newKey();
  const nonce = newNonce();
  const sealed = await seal(await data.arrayBuffer(), key, nonce);
  const hash = await sha256(sealed);
  // Removed while it was drawn: no need to bother the signer.
  if (signal.aborted) {
    throw new CanceledError();
  }
  const auth = await authorize("upload", [hash], `Upload ${file.name}`);
  if (signal.aborted) {
    throw new CanceledError();
  }
  await uploadBlob(sealed, hash, auth, {
    onProgress: (loaded) => onProgress(loaded / sealed.byteLength),
    signal,
  });
  return sealedImageAddress({
    hash,
    height,
    key,
    nonce,
    type: data.type,
    width,
  });
};
