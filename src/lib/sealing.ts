/**
 * Sealing blobs with AES-GCM before they go to the team's Blossom servers,
 * which hand any blob to whoever asks for its hash, and the BUD-11 event that
 * lets an upload or a deletion through. No browser APIs here beyond Web
 * Crypto: the reader service seals its pictures the same way.
 */
import type { EventTemplate } from "applesauce-core/helpers/event";
import { bytesToHex, hexToBytes } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";

/** BUD-11's kind for the event that lets a request through. */
const AUTH_KIND = 24_242;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

/** A new key for one file and its thumbnail, as hex. */
export function newKey(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

/** A new nonce: never use one twice with the same key. */
export function newNonce(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

/** The hex as bytes Web Crypto takes, which must sit in a plain ArrayBuffer. */
function bytes(hex: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(hexToBytes(hex));
}

function importKey(key: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bytes(key), "AES-GCM", false, [usage]);
}

export async function seal(
  data: BufferSource,
  key: string,
  nonce: string
): Promise<ArrayBuffer> {
  return await crypto.subtle.encrypt(
    { iv: bytes(nonce), name: "AES-GCM" },
    await importKey(key, "encrypt"),
    data
  );
}

/** The sealed data as it was; throws when it's been tampered with or the key is wrong. */
export async function open(
  data: BufferSource,
  key: string,
  nonce: string
): Promise<ArrayBuffer> {
  return await crypto.subtle.decrypt(
    { iv: bytes(nonce), name: "AES-GCM" },
    await importKey(key, "decrypt"),
    data
  );
}

export async function sha256(data: BufferSource): Promise<string> {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data))
  );
}

/** The event to sign for uploading or deleting these blobs. One names them all. */
export function blossomAuthTemplate(
  verb: "upload" | "delete",
  hashes: string[],
  content: string,
  seconds: number
): EventTemplate {
  return {
    content,
    created_at: unixNow(),
    kind: AUTH_KIND,
    tags: [
      ["t", verb],
      ["expiration", String(unixNow() + seconds)],
      ...hashes.map((hash) => ["x", hash]),
    ],
  };
}

function base64Url(text: string): string {
  return btoa(String.fromCodePoint(...new TextEncoder().encode(text)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

/** The Authorization header that carries a signed BUD-11 event. */
export function blossomAuthHeader(signed: object): string {
  return `Nostr ${base64Url(JSON.stringify(signed))}`;
}
