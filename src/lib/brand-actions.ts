import type { NostrEvent } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";
import { toast } from "sonner";

import { forgetBlobs } from "@/lib/blob-cleanup";
import type {
  Brand,
  BrandFields,
  BrandPart,
  BrandsContent,
  ColorFields,
  FileFields,
  FontFields,
  HexColor,
  PartFields,
} from "@/lib/brands";
import {
  brandTemplate,
  brandTombstoneTemplate,
  clean,
  filesIn,
  MAX_BRAND_DESCRIPTION,
  MAX_BRAND_NAME,
  MAX_COLOR_NAME,
  MAX_COLORS,
  MAX_FONT_FAMILY,
  MAX_FONT_ROLE,
  MAX_FONTS,
  MAX_SOCIALS,
  MAX_URL,
  NO_PARTS,
  partTemplate,
  partTombstoneTemplate,
  resolveBrands,
} from "@/lib/brands";
import { cleanLink } from "@/lib/catalogs";
import { BRAND_KIND, BRAND_PART_KIND, newId, rankBetween } from "@/lib/model";
import { accounts, eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { publish } from "@/lib/publish";
import { blobHashes } from "@/lib/sealed-files";

/** How long a removal offers to be undone. */
const UNDO_MS = 8000;

function me(): string | undefined {
  return accounts.active?.pubkey;
}

/**
 * The project's brands as the store has them now, changes still at the
 * signer included: each change in a batch sees the ones before it.
 */
export function currentBrands(project: Project): BrandsContent {
  return resolveBrands(
    project,
    eventStore.getTimeline([
      { "#a": [project.address], kinds: [BRAND_KIND, BRAND_PART_KIND] },
    ])
  );
}

// ———————————————————————————————————————— Brands

export interface BrandDraft {
  title: string;
  description: string;
  website: string;
  socials: string[];
}

function brandFields(brand: Brand): BrandFields {
  return {
    createdAt: brand.createdAt,
    creator: brand.creator,
    description: brand.description,
    guide: brand.guide,
    id: brand.id,
    socials: brand.socials,
    title: brand.title,
    website: brand.website,
  };
}

/** A link as kept, or nothing; `undefined` when what was typed isn't one. */
function cleanUrl(typed: string): string | null | undefined {
  const text = typed.trim();
  if (!text) {
    return null;
  }
  const link = cleanLink(text);
  return link && link.length <= MAX_URL ? link : undefined;
}

function cleanDraft(draft: BrandDraft): BrandDraft | undefined {
  const title = clean(draft.title, MAX_BRAND_NAME);
  if (!title) {
    toast.error("Give the brand a name.");
    return undefined;
  }
  const website = cleanUrl(draft.website);
  if (website === undefined) {
    toast.error("The website isn’t a web address.");
    return undefined;
  }
  const socials: string[] = [];
  for (const typed of draft.socials) {
    const link = cleanUrl(typed);
    if (link === undefined) {
      toast.error(`${typed.trim()} isn’t a web address.`);
      return undefined;
    }
    if (link && !socials.includes(link)) {
      socials.push(link);
    }
  }
  return {
    description: draft.description.trim().slice(0, MAX_BRAND_DESCRIPTION),
    socials: socials.slice(0, MAX_SOCIALS),
    title,
    website: website ?? "",
  };
}

/** Starts a brand in the project. Its id is known at once, to open it. */
export function createBrand(
  project: Project,
  draft: BrandDraft
): { id: string; saved: Promise<boolean> } | undefined {
  const fields = cleanDraft(draft);
  if (!fields) {
    return undefined;
  }
  const id = newId();
  const saved = publish(
    brandTemplate(project, {
      ...fields,
      createdAt: unixNow(),
      creator: me(),
      guide: "",
      id,
    })
  );
  return { id, saved };
}

/**
 * The brand as it is now, with the changes made. Its guidelines are those
 * of `prev`, or of the newest version, which `prev` then names, so a
 * teammate's editor merges from the right place and keeps their edits.
 */
function saveBrand(
  project: Project,
  brand: Brand,
  changes: Partial<BrandFields>,
  prev?: NostrEvent
): Promise<boolean> {
  const latest = currentBrands(project).byId.get(brand.id);
  // A brand someone deleted stays deleted, even with edits left to save.
  if (!latest) {
    return Promise.resolve(false);
  }
  return publish(
    brandTemplate(
      project,
      { ...brandFields(latest), ...changes },
      prev ?? latest.event
    ),
    latest.event
  );
}

/** Changes the brand's details given, over its newest version, leaving the rest as they are. */
export function updateBrand(
  project: Project,
  brand: Brand,
  changes: Partial<BrandDraft>
): Promise<boolean> {
  const latest = currentBrands(project).byId.get(brand.id);
  const fields = latest && cleanDraft({ ...brandFields(latest), ...changes });
  return fields ? saveBrand(project, brand, fields) : Promise.resolve(false);
}

/** Saves the guidelines as edited from `prev`, which teammates' editors merge from. */
export function saveGuide(
  project: Project,
  brand: Brand,
  guide: string,
  prev: NostrEvent
): Promise<boolean> {
  return saveBrand(project, brand, { guide }, prev);
}

/** Deletes the blobs of your own files among these, once their tombstones are out. */
function forgetOwnBlobs(parts: BrandPart[]): void {
  const pubkey = me();
  if (!pubkey) {
    return;
  }
  const hashes = parts.flatMap((part) =>
    part.part === "file" && part.creator === pubkey ? blobHashes(part) : []
  );
  if (hashes.length > 0) {
    forgetBlobs(pubkey, hashes);
  }
}

/** Deletes the brand for everyone, with its parts; your own files leave the servers too. */
export async function deleteBrand(
  project: Project,
  brand: Brand
): Promise<boolean> {
  const { colors, files, fonts } =
    currentBrands(project).parts.get(brand.id) ?? NO_PARTS;
  const parts: BrandPart[] = [...colors, ...fonts, ...files];
  const [deleted, ...removed] = await Promise.all([
    publish(brandTombstoneTemplate(project, brand), brand.event),
    ...parts.map((part) =>
      publish(partTombstoneTemplate(project, part), part.event)
    ),
  ]);
  forgetOwnBlobs(parts.filter((_, index) => removed[index]));
  return deleted === true;
}

// ———————————————————————————————————————— Parts

function stored(part: BrandPart): PartFields {
  const {
    author: _author,
    event: _event,
    project: _project,
    updatedAt: _updatedAt,
    ...fields
  } = part;
  return fields;
}

type Changes<T> = Partial<Omit<T, "part" | "id" | "brand">>;

/** What can change about a part, whichever kind it is. */
export type PartChanges = Changes<ColorFields> &
  Changes<FontFields> &
  Changes<FileFields>;

function partsOf(project: Project, brand: string): BrandPart[] {
  const { colors, fonts, files } =
    currentBrands(project).parts.get(brand) ?? NO_PARTS;
  return [...colors, ...fonts, ...files];
}

/** The part as it is now, with the changes made. */
export function updatePart(
  project: Project,
  part: BrandPart,
  changes: PartChanges
): Promise<boolean> {
  const latest = partsOf(project, part.brand).find(
    (item) => item.id === part.id
  );
  if (!latest) {
    return Promise.resolve(false);
  }
  return publish(
    partTemplate(project, { ...stored(latest), ...changes } as PartFields),
    latest.event
  );
}

/**
 * Puts the part where it now sits among `ordered`, ranked between its new
 * neighbors, so only it changes. Neighbors ranked alike leave no room
 * between them: then the whole run is ranked again, in order.
 */
export function placePart(
  project: Project,
  ordered: BrandPart[],
  part: BrandPart
): void {
  const at = ordered.indexOf(part);
  const before = ordered[at - 1];
  const after = ordered[at + 1];
  if (!(before && after && before.rank >= after.rank)) {
    updatePart(project, part, {
      rank: rankBetween(before?.rank, after?.rank),
    });
    return;
  }
  for (const [index, item] of ordered.entries()) {
    if (item.rank !== index + 1) {
      updatePart(project, item, { rank: index + 1 });
    }
  }
}

/** What a removal says it removed. */
const REMOVED: Record<BrandPart["part"], string> = {
  color: "Color removed",
  file: "File removed",
  font: "Typeface removed",
};

/** Puts removed parts back as they were, each winning over its tombstone. */
function restore(project: Project, parts: BrandPart[]): void {
  const pubkey = me();
  for (const part of parts) {
    const tombstone = pubkey
      ? eventStore.getReplaceable(BRAND_PART_KIND, pubkey, part.id)
      : undefined;
    publish(partTemplate(project, stored(part)), tombstone ?? part.event);
  }
}

/**
 * Deletes the part for everyone, a typeface with its files, with a moment
 * to undo it. Your own files leave the servers once that moment has passed;
 * teammates' apps wait a good while longer before cleaning up after theirs.
 */
export async function removePart(
  project: Project,
  part: BrandPart
): Promise<boolean> {
  const files =
    part.part === "font"
      ? filesIn(currentBrands(project).parts.get(part.brand)?.files ?? [], {
          font: part.id,
          kind: "font",
        })
      : [];
  const gone = [part, ...files];
  const saved = await Promise.all(
    gone.map((item) =>
      publish(partTombstoneTemplate(project, item), item.event)
    )
  );
  const removed = gone.filter((_, index) => saved[index]);
  if (removed.length === 0) {
    return false;
  }
  // Your files leave the servers once the toast goes without an undo.
  let undone = false;
  let settled = false;
  const settle = () => {
    if (!(settled || undone)) {
      forgetOwnBlobs(removed);
    }
    settled = true;
  };
  toast.success(REMOVED[part.part], {
    action: {
      label: "Undo",
      onClick: () => {
        undone = true;
        restore(project, removed);
      },
    },
    duration: UNDO_MS,
    onAutoClose: settle,
    onDismiss: settle,
  });
  return saved.every(Boolean);
}

/** The rank that puts a new part after the others like it. */
function lastRank(parts: { rank: number }[]): number {
  return rankBetween(parts.at(-1)?.rank);
}

function newPartBase(brand: Brand, rank: number) {
  return {
    brand: brand.id,
    createdAt: unixNow(),
    creator: me(),
    id: newId(),
    rank,
  };
}

export interface ColorDraft {
  name: string;
  hex: HexColor;
}

/** Adds a color at the end of the palette. Its id is known at once. */
export function addColor(
  project: Project,
  brand: Brand,
  draft: ColorDraft
): string | undefined {
  const { colors } = currentBrands(project).parts.get(brand.id) ?? NO_PARTS;
  if (colors.length >= MAX_COLORS) {
    toast.error(`A brand keeps up to ${MAX_COLORS} colors.`);
    return undefined;
  }
  const color: ColorFields = {
    ...newPartBase(brand, lastRank(colors)),
    hex: draft.hex,
    name: clean(draft.name, MAX_COLOR_NAME),
    part: "color",
  };
  publish(partTemplate(project, color));
  return color.id;
}

export interface FontDraft {
  family: string;
  source: FontFields["source"];
  weights: number[];
  role: string;
}

/** Adds a typeface after the others. Its id is known at once, for its files to go with. */
export function addFont(
  project: Project,
  brand: Brand,
  draft: FontDraft
): { id: string; saved: Promise<boolean> } | undefined {
  const { fonts } = currentBrands(project).parts.get(brand.id) ?? NO_PARTS;
  if (fonts.length >= MAX_FONTS) {
    toast.error(`A brand keeps up to ${MAX_FONTS} typefaces.`);
    return undefined;
  }
  const family = clean(draft.family, MAX_FONT_FAMILY);
  if (!family) {
    toast.error("Name the typeface.");
    return undefined;
  }
  const font: FontFields = {
    ...newPartBase(brand, lastRank(fonts)),
    family,
    part: "font",
    role: clean(draft.role, MAX_FONT_ROLE),
    source: draft.source,
    weights: draft.weights,
  };
  return { id: font.id, saved: publish(partTemplate(project, font)) };
}
