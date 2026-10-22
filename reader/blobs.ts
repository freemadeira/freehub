/**
 * Links' pictures on the team's Blossom server, sealed as Drive files are,
 * so the server only ever holds what it can't read. The reader uploads them
 * with its own key, so only it can delete them again.
 */
import type { PrivateKeySigner } from "applesauce-signers";

import type { LinkThumb } from "@/lib/catalogs";
import {
  blossomAuthHeader,
  blossomAuthTemplate,
  newKey,
  newNonce,
  seal,
  sha256,
} from "@/lib/sealing";

import type { FetchedImage } from "./linkmeta";

const AUTH_SECONDS = 5 * 60;
const TIMEOUT = 60_000;

export class Blobs {
  private readonly server: string;
  private readonly signer: PrivateKeySigner;

  constructor(server: string, signer: PrivateKeySigner) {
    this.server = server.replace(/\/+$/u, "");
    this.signer = signer;
  }

  private async auth(verb: "upload" | "delete", hash: string, what: string) {
    const signed = await this.signer.signEvent(
      blossomAuthTemplate(verb, [hash], what, AUTH_SECONDS)
    );
    return blossomAuthHeader(signed);
  }

  /** Seals the picture under a key of its own and uploads it. Throws when the server won't take it. */
  async upload(image: FetchedImage): Promise<LinkThumb> {
    const key = newKey();
    const nonce = newNonce();
    const data = await seal(image.bytes, key, nonce);
    const hash = await sha256(data);
    const response = await fetch(`${this.server}/upload`, {
      body: data,
      headers: {
        Authorization: await this.auth("upload", hash, "Link picture"),
        "Content-Type": "application/octet-stream",
        "X-SHA-256": hash,
      },
      method: "PUT",
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!response.ok) {
      throw new Error(
        response.headers.get("x-reason") ??
          `The file server answered ${response.status}.`
      );
    }
    return {
      hash,
      height: image.height,
      key,
      nonce,
      type: image.type,
      width: image.width,
    };
  }

  /** Deletes a picture the reader uploaded. Whether it's gone, or was never there. */
  async delete(hash: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.server}/${hash}`, {
        headers: {
          Authorization: await this.auth("delete", hash, "Link picture"),
        },
        method: "DELETE",
        signal: AbortSignal.timeout(TIMEOUT),
      });
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  }
}
