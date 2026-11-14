import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import { integer, isPubkey } from "@/lib/model";

/**
 * Files kept on the team's Blossom servers, encrypted in the browser, as the
 * events that point at them tell it: Drive files and brand files alike. The
 * tags follow NIP-17's file messages: `x` is the hash of the encrypted file,
 * as the servers have it, and the key to open it sits beside it.
 */

/** The only cipher files are kept in. */
const ALGORITHM = "aes-gcm";
const HEX_32 = /^[0-9a-f]{64}$/u;
const HEX_12 = /^[0-9a-f]{24}$/u;
const DIMENSIONS = /^(?<width>\d+)x(?<height>\d+)$/u;
const MAX_TYPE = 100;

/** Something encrypted on the Blossom servers: its hash there, and the nonce it was sealed with. */
export interface SealedBlob {
  hash: string;
  nonce: string;
}

/** A file on the servers, and what the browser learned of it on upload. */
export interface SealedFileFields {
  /** In bytes, before it was encrypted. */
  size: number;
  /** MIME type, or empty when the browser didn't know it. */
  type: string;
  /** Pixels, for images and videos the browser could read. */
  width?: number;
  height?: number;
  /** The AES-GCM key of the file and its thumbnail, as hex. */
  key: string;
  blob: SealedBlob;
  /** A small picture of it, made in the browser on upload. */
  thumb?: SealedBlob;
  /** Who uploaded it: only they can delete its blobs from the servers. */
  creator: string;
}

/** A positive, finite number, or nothing. */
export function measure(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function parseSealed(
  hash: string | undefined,
  nonce: string | undefined
): SealedBlob | undefined {
  return hash && nonce && HEX_32.test(hash) && HEX_12.test(nonce)
    ? { hash, nonce }
    : undefined;
}

/** The file an event points at, or nothing when it can't be opened, like one without its key. */
export function parseSealedFile(
  event: NostrEvent
): SealedFileFields | undefined {
  const key = getTagValue(event, "decryption-key");
  const blob = parseSealed(
    getTagValue(event, "x"),
    getTagValue(event, "decryption-nonce")
  );
  const thumbTag = event.tags.find(([name]) => name === "thumbnail");
  const size = integer(getTagValue(event, "size"));
  if (
    getTagValue(event, "encryption-algorithm") !== ALGORITHM ||
    !(key && HEX_32.test(key) && blob) ||
    size === undefined ||
    size < 0
  ) {
    return undefined;
  }
  const dimensions = DIMENSIONS.exec(getTagValue(event, "dim") ?? "")?.groups;
  return {
    blob,
    creator: [getTagValue(event, "creator")].find(isPubkey) ?? event.pubkey,
    height: measure(Number(dimensions?.height)),
    key,
    size,
    thumb: parseSealed(thumbTag?.[1], thumbTag?.[2]),
    type: (getTagValue(event, "m") ?? "").slice(0, MAX_TYPE),
    width: measure(Number(dimensions?.width)),
  };
}

/** The tags that point an event at its file. */
export function sealedFileTags(file: SealedFileFields): string[][] {
  const tags = [
    ["size", String(file.size)],
    ["encryption-algorithm", ALGORITHM],
    ["decryption-key", file.key],
    ["decryption-nonce", file.blob.nonce],
    ["x", file.blob.hash],
    ["creator", file.creator],
  ];
  if (file.type) {
    tags.push(["m", file.type]);
  }
  if (file.thumb) {
    tags.push(["thumbnail", file.thumb.hash, file.thumb.nonce]);
  }
  if (file.width && file.height) {
    tags.push(["dim", `${Math.round(file.width)}x${Math.round(file.height)}`]);
  }
  return tags;
}

/** The file's blobs on the servers: itself, and its thumbnail if it has one. */
export function blobHashes(
  file: Pick<SealedFileFields, "blob" | "thumb">
): string[] {
  return file.thumb ? [file.blob.hash, file.thumb.hash] : [file.blob.hash];
}

/**
 * What a tombstone keeps of a file deleted for good: its blobs and who
 * uploaded them, so their client can delete them from the servers.
 */
export function tombstoneFileTags(
  file: Pick<SealedFileFields, "blob" | "thumb" | "creator">
): string[][] {
  return [
    ["creator", file.creator],
    ...blobHashes(file).map((hash) => ["x", hash]),
  ];
}

/** The blobs a deleted file's tombstone names, if `pubkey` uploaded them. */
export function blobsToDelete(tombstone: NostrEvent, pubkey: string): string[] {
  return getTagValue(tombstone, "creator") === pubkey
    ? tombstone.tags.flatMap(([name, hash]) =>
        name === "x" && hash && HEX_32.test(hash) ? [hash] : []
      )
    : [];
}
