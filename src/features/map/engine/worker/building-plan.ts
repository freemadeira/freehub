/**
 * How tall a building stands and how it's roofed, from its tags and size.
 * Shared with the bake, which keeps cable cars clear of the buildings drawn.
 */

export const STOREY = 3.1;

const HOUSES = new Set([
  "house",
  "detached",
  "semidetached_house",
  "bungalow",
  "terrace",
  "farm",
  "cabin",
  "residential",
  "yes",
]);
const SHEDS = new Set([
  "garage",
  "garages",
  "shed",
  "hut",
  "kiosk",
  "toilets",
  "roof",
  "carport",
  "greenhouse",
  "service",
  "storage_tank",
  "container",
]);
const PITCHED = new Set([
  "gabled",
  "hipped",
  "pyramidal",
  "half-hipped",
  "side_hipped",
]);
const INDUSTRY = new Set(["industrial", "warehouse", "manufacture"]);
const WORSHIP = new Set(["church", "chapel", "cathedral"]);

/** Highest a roof or what stands on one reaches above the eaves. */
export const ROOF_ROOM = 4.6;

export interface BuildingPlan {
  levels: number;
  /** Wall height from the highest ground to the eaves. */
  walls: number;
  roof: "flat" | "hipped" | "gabled";
  /** Height of a pitched roof's ridge over the eaves, when OSM gives it. */
  ridge?: number;
  windows: boolean;
}

type Properties = Record<string, unknown>;

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function isIndustrial(properties: Properties): boolean {
  return INDUSTRY.has(String(properties.kind));
}

/** Storeys from the footprint and kind, when OSM doesn't say. */
function guessLevels(
  kind: string,
  footprint: number,
  random: () => number
): number {
  if (INDUSTRY.has(kind)) {
    return 2;
  }
  if (WORSHIP.has(kind)) {
    return kind === "chapel" ? 2 : 4;
  }
  if (kind === "apartments" || kind === "hotel") {
    return 3 + Math.floor(random() * (footprint > 500 ? 6 : 3));
  }
  if (footprint < 45) {
    return 1;
  }
  if (footprint < 140) {
    return 1 + Math.round(random() * 1.2);
  }
  if (footprint < 450) {
    return 2 + Math.floor(random() * 2);
  }
  return 3 + Math.floor(random() * (footprint < 1500 ? 3 : 4));
}

/**
 * OSM's roof shape; tiled roofs and many small houses, as Madeira has,
 * otherwise get a hipped one.
 */
function roofOf(
  properties: Properties,
  footprint: number,
  levels: number,
  random: () => number
): BuildingPlan["roof"] {
  const tag = String(properties.roof ?? "");
  if (PITCHED.has(tag)) {
    return tag === "gabled" ? "gabled" : "hipped";
  }
  if (tag !== "") {
    return "flat";
  }
  if (properties.roofMaterial === "tiles") {
    return "hipped";
  }
  const house =
    HOUSES.has(String(properties.kind ?? "yes")) &&
    footprint < 260 &&
    levels <= 3;
  return house && random() < 0.62 ? "hipped" : "flat";
}

export function planOf(
  properties: Properties,
  footprint: number,
  random: () => number
): BuildingPlan {
  const kind = String(properties.kind ?? "yes");
  const height = numberOf(properties.height);
  if (SHEDS.has(kind)) {
    return {
      levels: 1,
      roof: "flat",
      walls: height ?? 2.8 + random() * 0.8,
      windows: false,
    };
  }
  const tagged = numberOf(properties.levels);
  const levels = Math.max(
    1,
    Math.min(40, Math.round(tagged ?? guessLevels(kind, footprint, random)))
  );
  const roof = roofOf(properties, footprint, levels, random);
  const roofLevels = numberOf(properties.roofLevels) ?? 0;
  let ridge = numberOf(properties.roofHeight);
  if (ridge === undefined && roofLevels > 0) {
    ridge = roofLevels * STOREY;
  }
  let walls = height ?? levels * STOREY + 0.4;
  if (roof === "flat" && height === undefined) {
    // Storeys in a flat-roofed building's roof are set-back floors on top.
    walls += roofLevels * STOREY;
  }
  if (roof !== "flat" && height !== undefined) {
    walls = Math.max(2.6, height - (ridge ?? 2));
  }
  return { levels, ridge, roof, walls, windows: walls > 3.4 };
}

/**
 * The most a building can rise above the highest ground under it, however
 * its untagged storeys and roof come out.
 */
export function tallestOf(properties: Properties, footprint: number): number {
  const plan = planOf(properties, footprint, () => 0.9999);
  return plan.walls + Math.max(ROOF_ROOM, plan.ridge ?? 0);
}
