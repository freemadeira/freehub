import { unixNow } from "applesauce-core/helpers/time";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { authorize, deleteBlobs, uploadBlob } from "@/lib/blossom";
import { currentBrands } from "@/lib/brand-actions";
import type { Brand, BrandPlace, FileFields } from "@/lib/brands";
import {
  clean,
  faceOfFile,
  filesIn,
  MAX_CAPTION,
  MAX_FONT_FILES,
  MAX_SLOT_FILES,
  NO_PARTS,
  partTemplate,
  placeFit,
  sameBrandPlace,
} from "@/lib/brands";
import {
  cleanName,
  fileKind,
  MAX_DRIVE_FILE_BYTES,
  mimeOf,
  TOO_BIG,
} from "@/lib/drive";
import { newId, rankBetween } from "@/lib/model";
import { accounts } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { publish } from "@/lib/publish";
import { sealFile } from "@/lib/sealed-upload";
import { errorMessage, plural } from "@/lib/utils";

/**
 * Files going into brands: sealed in the browser like the Drive's, sent to
 * the team's Blossom server with their thumbnails, then kept as parts of the
 * brand. Kept outside any screen, so they carry on while the person moves on;
 * the brand page shows the ones on their way where they'll land.
 */

/** A file on its way into a brand. */
export interface BrandUpload {
  id: string;
  brand: string;
  place: BrandPlace;
  name: string;
  /** Where it'll sit among the place's files. */
  rank: number;
  /** How much has gone, 0 to 1. */
  progress: number;
  /** A local picture of an image, to show before it's uploaded. */
  preview?: string;
}

/** Uploads running at once; the rest wait their turn. */
const CONCURRENT = 3;
/** Progress shows at most this often per file, plenty for a bar. */
const SAMPLE_MS = 150;
/** Local previews of images bigger than this cost more memory than they're worth. */
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;

let uploads: BrandUpload[] = [];
const listeners = new Set<() => void>();
let running = 0;
const waiting: (() => void)[] = [];

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function patch(id: string, change: Partial<BrandUpload>): void {
  uploads = uploads.map((item) =>
    item.id === id ? { ...item, ...change } : item
  );
  emit();
}

function drop(id: string): void {
  const item = uploads.find((upload) => upload.id === id);
  if (item?.preview) {
    URL.revokeObjectURL(item.preview);
  }
  uploads = uploads.filter((upload) => upload.id !== id);
  emit();
}

const NO_UPLOADS: BrandUpload[] = [];
let cache: { brand: string; all: BrandUpload[]; mine: BrandUpload[] } = {
  all: NO_UPLOADS,
  brand: "",
  mine: NO_UPLOADS,
};

function snapshot(brand: string): BrandUpload[] {
  if (cache.brand !== brand || cache.all !== uploads) {
    const mine = uploads.filter((upload) => upload.brand === brand);
    cache = { all: uploads, brand, mine: mine.length > 0 ? mine : NO_UPLOADS };
  }
  return cache.mine;
}

/** The brand's files on their way, oldest first. */
export function useBrandUploads(brand: string): BrandUpload[] {
  return useSyncExternalStore(subscribe, () => snapshot(brand));
}

/** Waits until fewer than CONCURRENT uploads run, then counts this one in. */
async function turn(): Promise<void> {
  if (running >= CONCURRENT) {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    waiting.push(() => resolve(true));
    await promise;
  }
  running += 1;
}

function done(): void {
  running -= 1;
  waiting.shift()?.();
}

/** Whether the brand, and the typeface for a font file, are still there to take the file. */
function stillThere(project: Project, item: BrandUpload): boolean {
  const content = currentBrands(project);
  const { place } = item;
  return (
    content.byId.has(item.brand) &&
    (place.kind !== "font" ||
      (content.parts.get(item.brand)?.fonts ?? []).some(
        (font) => font.id === place.font
      ))
  );
}

/** Takes blobs nothing points at off the servers again. */
async function discard(hashes: string[]): Promise<void> {
  try {
    await deleteBlobs(hashes);
  } catch {
    // Left on the server: nothing points at it, and nobody can read it.
  }
}

/** Seals the file, sends it with its thumbnail, then keeps it in the brand. */
async function send(
  project: Project,
  item: BrandUpload,
  file: File,
  fields: { caption: string }
): Promise<void> {
  const creator = accounts.active?.pubkey;
  if (!creator) {
    throw new Error("You’re logged out.");
  }
  const type = mimeOf(file);
  const { data, hash, key, measured, nonce, thumb } = await sealFile(
    file,
    fileKind({ name: file.name, type })
  );
  const auth = await authorize(
    "upload",
    thumb ? [hash, thumb.blob.hash] : [hash],
    `Upload ${item.name}`
  );
  const sent: string[] = [];
  let shownAt = 0;
  try {
    await uploadBlob(data, hash, auth, {
      onProgress: (loaded) => {
        const now = performance.now();
        if (now - shownAt > SAMPLE_MS) {
          shownAt = now;
          patch(item.id, { progress: Math.min(1, loaded / data.byteLength) });
        }
      },
    });
    sent.push(hash);
    let thumbBlob = thumb?.blob;
    if (thumb) {
      try {
        await uploadBlob(thumb.data, thumb.blob.hash, auth);
        sent.push(thumb.blob.hash);
      } catch {
        // Previews are a nicety: the file itself still goes in.
        thumbBlob = undefined;
      }
    }
    // The brand, or the typeface it goes with, may have gone meanwhile.
    if (!stillThere(project, item)) {
      throw new Error("What it was going into was deleted.");
    }
    const part: FileFields = {
      blob: { hash, nonce },
      brand: item.brand,
      caption: fields.caption,
      createdAt: unixNow(),
      creator,
      face: item.place.kind === "font" ? faceOfFile(item.name) : undefined,
      height: measured.height,
      id: newId(),
      key,
      name: item.name,
      part: "file",
      place: item.place,
      rank: item.rank,
      size: file.size,
      thumb: thumbBlob,
      type,
      width: measured.width,
    };
    if (!(await publish(partTemplate(project, part)))) {
      throw new Error("It wasn’t saved in the brand.");
    }
  } catch (error) {
    // Nothing points at what was sent: take it off the servers again.
    if (sent.length > 0) {
      discard(sent);
    }
    throw error;
  }
}

/** How many more files the place takes, and what to say when it's full. */
function room(
  brand: Brand,
  project: Project,
  place: BrandPlace
): { left: number; full: string } {
  const { files } = currentBrands(project).parts.get(brand.id) ?? NO_PARTS;
  const kept =
    filesIn(files, place).length +
    uploads.filter(
      (upload) =>
        upload.brand === brand.id && sameBrandPlace(upload.place, place)
    ).length;
  if (place.kind === "logo") {
    return {
      full: `A logo keeps up to ${MAX_SLOT_FILES} formats.`,
      left: MAX_SLOT_FILES - kept,
    };
  }
  if (place.kind === "font") {
    return {
      full: `A typeface keeps up to ${MAX_FONT_FILES} files.`,
      left: MAX_FONT_FILES - kept,
    };
  }
  return { full: "", left: Number.POSITIVE_INFINITY };
}

/**
 * Uploads files to a place in the brand, telling the person about any it
 * doesn't take. Resolves once they're all kept, or with false if any failed.
 */
export async function uploadToBrand(
  project: Project,
  brand: Brand,
  place: BrandPlace,
  picked: File[],
  { caption = "" } = {}
): Promise<boolean> {
  const { fits, misfit } = placeFit(place.kind);
  const fitting = picked.filter(
    (file) =>
      fits({ name: file.name, type: mimeOf(file) }) &&
      file.size <= MAX_DRIVE_FILE_BYTES
  );
  if (picked.some((file) => file.size > MAX_DRIVE_FILE_BYTES)) {
    toast.error(TOO_BIG);
  } else if (fitting.length < picked.length) {
    toast.error(misfit);
  }
  const { left, full } = room(brand, project, place);
  if (fitting.length > left) {
    toast.error(full);
  }
  const taken = fitting.slice(0, Math.max(0, left));
  if (taken.length === 0) {
    return false;
  }
  const { files } = currentBrands(project).parts.get(brand.id) ?? NO_PARTS;
  // After the files there, and after those still on their way.
  let rank = Math.max(
    filesIn(files, place).at(-1)?.rank ?? 0,
    ...uploads
      .filter(
        (upload) =>
          upload.brand === brand.id && sameBrandPlace(upload.place, place)
      )
      .map((upload) => upload.rank)
  );
  const queued = taken.map((file) => {
    rank = rankBetween(rank);
    const type = mimeOf(file);
    const item: BrandUpload = {
      brand: brand.id,
      id: crypto.randomUUID(),
      name: cleanName(file.name) || "Untitled",
      place,
      preview:
        type.startsWith("image/") && file.size <= MAX_PREVIEW_BYTES
          ? URL.createObjectURL(file)
          : undefined,
      progress: 0,
      rank,
    };
    return { file, item };
  });
  uploads = [...uploads, ...queued.map(({ item }) => item)];
  emit();
  const results = await Promise.all(
    queued.map(async ({ file, item }) => {
      await turn();
      try {
        await send(project, item, file, {
          caption: clean(caption, MAX_CAPTION),
        });
        return true;
      } catch (error) {
        toast.error(`${item.name} wasn’t uploaded`, {
          description: errorMessage(error),
        });
        return false;
      } finally {
        done();
        drop(item.id);
      }
    })
  );
  const failed = results.filter((ok) => !ok).length;
  if (failed > 1) {
    toast.error(`${plural(failed, "file")} weren’t uploaded.`);
  }
  return failed === 0;
}
