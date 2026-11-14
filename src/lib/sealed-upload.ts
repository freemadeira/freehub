import type { FileKind } from "@/lib/drive";
import { MAX_THUMB_BYTES } from "@/lib/drive";
import type { SealedBlob } from "@/lib/sealed-files";
import { newKey, newNonce, seal, sha256 } from "@/lib/sealing";
import type { Measured } from "@/lib/thumbnails";
import { measure } from "@/lib/thumbnails";

/** A file sealed for the Blossom servers, with its thumbnail sealed by the same key. */
export interface SealedData {
  key: string;
  nonce: string;
  /** The file, encrypted. */
  data: ArrayBuffer;
  /** The hash of the encrypted file, as the servers will have it. */
  hash: string;
  /** What the browser could learn of the file. */
  measured: Measured;
  thumb?: { data: ArrayBuffer; blob: SealedBlob };
}

/** The file's thumbnail sealed with the same key, if the browser could draw one. */
async function sealThumbnail(
  thumbnail: Blob | undefined,
  key: string
): Promise<SealedData["thumb"]> {
  if (!thumbnail || thumbnail.size > MAX_THUMB_BYTES) {
    return undefined;
  }
  try {
    const nonce = newNonce();
    const data = await seal(await thumbnail.arrayBuffer(), key, nonce);
    return { blob: { hash: await sha256(data), nonce }, data };
  } catch {
    // Previews are a nicety: the file itself still goes in.
    return undefined;
  }
}

/** Measures the file and seals it under a new key, with a thumbnail when it has one. */
export async function sealFile(
  file: File,
  kind: FileKind
): Promise<SealedData> {
  // Thumbnails are drawn while the file is sealed.
  const measuring = measure(file, kind);
  const key = newKey();
  const nonce = newNonce();
  const data = await seal(await file.arrayBuffer(), key, nonce);
  const hash = await sha256(data);
  const measured = await measuring;
  const thumb = await sealThumbnail(measured.thumbnail, key);
  return { data, hash, key, measured, nonce, thumb };
}
