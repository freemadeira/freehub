/**
 * Pictures put straight into a doc page or description: encrypted in the
 * browser and kept on the team's Blossom servers, like Drive files. The text
 * names each by a `blossom:` address that holds what it takes to show it, so
 * a picture copied into another text still shows there:
 *
 *     blossom:<hash>.<ext>?key=<hex>&nonce=<hex>&dim=<width>x<height>
 *
 * The hash is of the encrypted bytes, as the servers have them, and the key
 * and nonce open them with AES-GCM. The address names no server, so the
 * team's servers can change.
 */

const SCHEME = "blossom:";
const HEX_32 = /^[0-9a-f]{64}$/u;
const HEX_12 = /^[0-9a-f]{24}$/u;
const ADDRESS =
  /^blossom:(?<hash>[0-9a-f]{64})\.(?<ext>[a-z]+)\?(?<query>.*)$/u;
const DIMENSIONS = /^(?<width>[1-9]\d{0,5})x(?<height>[1-9]\d{0,5})$/u;

/** The picture types a text shows, by the extension its address names. */
const TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const EXTENSIONS = new Map(
  Object.entries(TYPES).map(([extension, type]) => [type, extension])
);

/** A picture on the servers, and how to open it. */
export interface SealedImage {
  /** The hash of the encrypted picture, as the servers have it. */
  hash: string;
  /** The AES-GCM key and nonce, as hex. */
  key: string;
  nonce: string;
  /** The MIME type it opens as. */
  type: string;
  /** Pixels, when they were known on upload. */
  width?: number;
  height?: number;
}

/** Whether a text can show a picture of this type as it is. */
export function showsAsIs(type: string): boolean {
  return EXTENSIONS.has(type);
}

/** The address a text names the picture by. */
export function sealedImageAddress(image: SealedImage): string {
  const extension = EXTENSIONS.get(image.type);
  if (!extension) {
    throw new Error(`Pictures of type ${image.type} can’t be shown.`);
  }
  const query = new URLSearchParams({ key: image.key, nonce: image.nonce });
  if (image.width && image.height) {
    query.set("dim", `${Math.round(image.width)}x${Math.round(image.height)}`);
  }
  return `${SCHEME}${image.hash}.${extension}?${query}`;
}

/** Whether the address names a picture on the servers, readable or not. */
export function isSealedImageAddress(src: string): boolean {
  return src.startsWith(SCHEME);
}

/** The picture an address names, or nothing when it can't be opened. */
export function parseSealedImage(src: string): SealedImage | undefined {
  const groups = ADDRESS.exec(src)?.groups;
  const type = groups?.ext ? TYPES[groups.ext] : undefined;
  if (!(groups?.hash && type)) {
    return undefined;
  }
  const query = new URLSearchParams(groups.query);
  const key = query.get("key") ?? "";
  const nonce = query.get("nonce") ?? "";
  if (!(HEX_32.test(key) && HEX_12.test(nonce))) {
    return undefined;
  }
  const dimensions = DIMENSIONS.exec(query.get("dim") ?? "")?.groups;
  return {
    hash: groups.hash,
    key,
    nonce,
    type,
    ...(dimensions && {
      height: Number(dimensions.height),
      width: Number(dimensions.width),
    }),
  };
}
