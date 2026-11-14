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

/** The brand as it is now, with the changes made. */
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
    brandTemplate(project, { ...brandFields(latest), ...changes }, prev),
    latest.event
  );
}

export function updateBrand(
  project: Project,
  brand: Brand,
  draft: BrandDraft
): Promise<boolean> {
  const fields = cleanDraft(draft);
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

/** The part as it is now, with the changes made. */
export function updatePart<T extends BrandPart>(
  project: Project,
  part: T,
  changes: Partial<PartFields>
): Promise<boolean> {
  const content = currentBrands(project);
  const parts = content.parts.get(part.brand) ?? NO_PARTS;
  const latest = [...parts.colors, ...parts.fonts, ...parts.files].find(
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

/** Puts the part between two others of its kind, either of which may be missing at an end. */
export function movePart(
  project: Project,
  part: BrandPart,
  before?: BrandPart,
  after?: BrandPart
): Promise<boolean> {
  return updatePart(project, part, {
    rank: rankBetween(before?.rank, after?.rank),
  });
}

/** Deletes the part for everyone; your own files leave the servers too. */
export async function removePart(
  project: Project,
  part: BrandPart,
  { undoable = true } = {}
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
  forgetOwnBlobs(gone.filter((_, index) => saved[index]));
  // Colors and library typefaces come back as they were; files are gone for good.
  if (saved[0] && undoable && part.part !== "file" && files.length === 0) {
    toast.success(
      part.part === "color" ? "Color removed" : "Typeface removed",
      {
        action: {
          label: "Undo",
          onClick: () => publish(partTemplate(project, stored(part))),
        },
      }
    );
  }
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
