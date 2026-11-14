/**
 * A brand's files, fetched, opened and zipped up in the browser: every logo
 * at once, or the whole kit with illustrations, patterns, typefaces, the
 * colors and type as code, and the guidelines. Progress shows in a toast, so
 * the person can carry on meanwhile.
 */
import { toast } from "sonner";

import { copyText } from "@/components/copy";
import { fetchBrandFile } from "@/lib/brand-files";
import type {
  Brand,
  BrandFile,
  BrandParts,
  LogoKind,
  LogoMode,
  TokenFormat,
} from "@/lib/brands";
import {
  brandSlug,
  brandTokens,
  extensionOf,
  filesIn,
  filesOf,
  formatCmyk,
  formatHsl,
  formatRgb,
  fontWeights,
  libraryFontPage,
  LOGO_KINDS,
  LOGO_MODES,
} from "@/lib/brands";
import { slugify } from "@/lib/project";
import { errorMessage, plural } from "@/lib/utils";

/** Files fetched at once; the rest wait their turn. */
const CONCURRENT = 4;
const ZIP_TYPE = "application/zip";
const SAVE_URL_MS = 60_000;

const TOKEN_FILES: [TokenFormat, string][] = [
  ["css", "tokens.css"],
  ["tailwind", "tailwind.css"],
  ["json", "tokens.json"],
  ["dtcg", "tokens.tokens.json"],
];

/** Saves the blob as a download. */
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), SAVE_URL_MS);
}

/** The files' bytes by id, a few fetched at once; any that can't be had are left out. */
async function fetchAll(
  files: BrandFile[],
  onFetched: (count: number) => void
): Promise<Map<string, Uint8Array>> {
  const fetched = new Map<string, Uint8Array>();
  const queue = [...files];
  let count = 0;
  const lane = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- each lane takes the next file once it's done with one
        const blob = await fetchBrandFile(file);
        // oxlint-disable-next-line no-await-in-loop -- read before the lane moves on
        fetched.set(file.id, new Uint8Array(await blob.arrayBuffer()));
      } catch {
        // Left out; the toast says how many.
      }
      count += 1;
      onFetched(count);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENT, queue.length) }, lane)
  );
  return fetched;
}

/** A name not taken yet in its folder: `logo.svg`, then `logo-2.svg`. */
function freeName(taken: Set<string>, base: string, extension: string): string {
  const dot = extension ? `.${extension}` : "";
  let name = `${base}${dot}`;
  for (let number = 2; taken.has(name); number += 1) {
    name = `${base}-${number}${dot}`;
  }
  taken.add(name);
  return name;
}

function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** What a logo is called in downloads: `acme-symbol-on-light.svg`. */
export function logoBase(
  brand: Pick<Brand, "title">,
  logo: LogoKind,
  mode: LogoMode
): string {
  return `${brandSlug(brand)}-${logo}-on-${mode}`;
}

/** Where each logo goes in a zip, by id. */
function logoPaths(
  brand: Brand,
  files: BrandFile[],
  folder: string
): Map<string, string> {
  const taken = new Set<string>();
  const paths = new Map<string, string>();
  for (const logo of LOGO_KINDS) {
    for (const mode of LOGO_MODES) {
      for (const file of filesIn(files, { kind: "logo", logo, mode })) {
        const name = freeName(
          taken,
          logoBase(brand, logo, mode),
          extensionOf(file.name)
        );
        paths.set(file.id, `${folder}/${name}`);
      }
    }
  }
  return paths;
}

/** Illustrations, patterns, examples and typeface files, where each goes in the kit. */
function otherPaths(
  { files, fonts }: BrandParts,
  root: string
): Map<string, string> {
  const paths = new Map<string, string>();
  const folders = [
    ["illustration", "illustrations"],
    ["pattern", "patterns"],
    ["example", "examples"],
  ] as const;
  for (const [kind, folder] of folders) {
    const taken = new Set<string>();
    for (const file of filesOf(files, kind)) {
      const prefix =
        file.place.kind === "example" ? `${file.place.verdict}-` : "";
      const name = freeName(
        taken,
        `${prefix}${slugify(baseName(file.name)) || kind}`,
        extensionOf(file.name)
      );
      paths.set(file.id, `${root}/${folder}/${name}`);
    }
  }
  for (const font of fonts) {
    const folder = slugify(font.family) || font.id;
    const taken = new Set<string>();
    for (const file of filesIn(files, { font: font.id, kind: "font" })) {
      const name = freeName(taken, baseName(file.name), extensionOf(file.name));
      paths.set(file.id, `${root}/fonts/${folder}/${name}`);
    }
  }
  return paths;
}

/** The brand as data, for whoever builds with it. */
function brandJson(brand: Brand, { colors, files, fonts }: BrandParts): string {
  const data = {
    colors: colors.map((color) => ({
      cmyk: formatCmyk(color.hex),
      hex: color.hex,
      hsl: formatHsl(color.hex),
      name: color.name,
      rgb: formatRgb(color.hex),
    })),
    description: brand.description,
    name: brand.title,
    socials: brand.socials,
    typefaces: fonts.map((font) => ({
      family: font.family,
      role: font.role,
      source:
        font.source === "library" ? libraryFontPage(font.family) : "files",
      weights: fontWeights(font, files),
    })),
    website: brand.website,
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

async function zipUp(entries: Map<string, Uint8Array | string>): Promise<Blob> {
  const { strToU8, zip } = await import("fflate");
  const data: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [path, content] of entries) {
    // Text squeezes down; images and fonts are compressed already.
    data[path] =
      typeof content === "string"
        ? [strToU8(content), { level: 6 }]
        : [content, { level: 0 }];
  }
  // oxlint-disable-next-line promise/avoid-new -- fflate answers through a callback
  return await new Promise<Blob>((resolve, reject) => {
    zip(data, (error, zipped) => {
      if (error) {
        reject(error);
      } else {
        resolve(
          new Blob([zipped as Uint8Array<ArrayBuffer>], { type: ZIP_TYPE })
        );
      }
    });
  });
}

/**
 * Fetches the files to their paths, adds the texts, zips it all and saves it,
 * telling progress in a toast.
 */
async function pack(
  name: string,
  paths: Map<string, string>,
  files: BrandFile[],
  texts = new Map<string, string>()
): Promise<void> {
  const wanted = files.filter((file) => paths.has(file.id));
  const id = toast.loading(`Gathering ${plural(wanted.length, "file")}…`);
  try {
    const fetched = await fetchAll(wanted, (count) =>
      toast.loading(`Fetching ${count} of ${wanted.length}…`, { id })
    );
    toast.loading("Zipping…", { id });
    const entries = new Map<string, Uint8Array | string>(texts);
    for (const file of wanted) {
      const bytes = fetched.get(file.id);
      const path = paths.get(file.id);
      if (bytes && path) {
        entries.set(path, bytes);
      }
    }
    save(await zipUp(entries), `${name}.zip`);
    const missing = wanted.length - fetched.size;
    toast.success(`${name}.zip downloaded`, {
      description:
        missing > 0
          ? `${plural(missing, "file")} couldn’t be fetched and ${missing === 1 ? "was" : "were"} left out.`
          : undefined,
      id,
    });
  } catch (error) {
    toast.error(errorMessage(error), { id });
  }
}

/** Every logo of the brand, in one zip. */
export function downloadLogos(brand: Brand, files: BrandFile[]): Promise<void> {
  const name = `${brandSlug(brand)}-logos`;
  return pack(name, logoPaths(brand, files, name), filesOf(files, "logo"));
}

/** Everything: files, the colors and type as code, the brand as data and its guidelines. */
export function downloadKit(brand: Brand, parts: BrandParts): Promise<void> {
  const root = `${brandSlug(brand)}-brand-kit`;
  const paths = new Map([
    ...logoPaths(brand, parts.files, `${root}/logos`),
    ...otherPaths(parts, root),
  ]);
  const texts = new Map([[`${root}/brand.json`, brandJson(brand, parts)]]);
  if (parts.colors.length + parts.fonts.length > 0) {
    for (const [format, file] of TOKEN_FILES) {
      texts.set(
        `${root}/tokens/${file}`,
        brandTokens(brand, parts.colors, parts.fonts, format)
      );
    }
  }
  if (brand.guide.trim()) {
    texts.set(`${root}/guidelines.md`, `# ${brand.title}\n\n${brand.guide}\n`);
  }
  return pack(root, paths, parts.files, texts);
}

/** One file, saved under the name given, or its own. */
export async function downloadBrandFile(
  file: BrandFile,
  name: string = file.name
): Promise<void> {
  try {
    save(await fetchBrandFile(file), name);
  } catch (error) {
    toast.error(`“${file.name}” couldn’t be downloaded.`, {
      description: errorMessage(error),
    });
  }
}

/** An uploaded typeface's files: the file itself when there's one, else a zip of them. */
export function downloadFontFiles(
  family: string,
  files: BrandFile[]
): Promise<void> {
  const [only] = files;
  if (files.length === 1 && only) {
    return downloadBrandFile(only);
  }
  const name = slugify(family) || "typeface";
  const taken = new Set<string>();
  const paths = new Map(
    files.map((file) => [
      file.id,
      `${name}/${freeName(taken, baseName(file.name), extensionOf(file.name))}`,
    ])
  );
  return pack(name, paths, files);
}

/** Copies an SVG's code, to paste straight into a design or a page. */
export async function copySvg(file: BrandFile): Promise<boolean> {
  try {
    const blob = await fetchBrandFile(file);
    const copied = await copyText(await blob.text());
    if (copied) {
      toast.success("SVG code copied");
    }
    return copied;
  } catch (error) {
    toast.error(errorMessage(error));
    return false;
  }
}

export function isSvg(file: Pick<BrandFile, "name" | "type">): boolean {
  return file.type === "image/svg+xml" || extensionOf(file.name) === "svg";
}
