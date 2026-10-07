import { readFile } from "node:fs/promises";

import type {
  Aerialway,
  LanduseKind,
  Place,
  PlaceKind,
  RoadKind,
} from "../../../src/features/map/engine/format.ts";
import type { Theme } from "./fetch.ts";
import { osmFile } from "./fetch.ts";
import type { Polygon, Ring, Vec } from "./geometry.ts";
import {
  close,
  isClosed,
  pointInRing,
  sampleLine,
  signedArea,
} from "./geometry.ts";

/** Coordinates here are [lng, lat]. */
interface RawPoint {
  lat: number;
  lon: number;
}

interface RawMember {
  type: string;
  role: string;
  geometry?: RawPoint[];
}

interface RawElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: RawPoint[];
  members?: RawMember[];
  tags?: Record<string, string>;
}

type Tags = Record<string, string>;
type Properties = Record<string, string | number>;

export interface AreaFeature {
  id: number;
  polygon: Polygon;
  properties: Properties;
}

export interface LineFeature {
  id: number;
  line: Vec[];
  properties: Properties;
}

export interface PointFeature {
  id: number;
  point: Vec;
  properties: Properties;
}

export interface OsmData {
  land: Polygon[];
  buildings: AreaFeature[];
  landuse: AreaFeature[];
  water: AreaFeature[];
  waterways: LineFeature[];
  piers: (AreaFeature | LineFeature)[];
  roads: LineFeature[];
  trees: PointFeature[];
  places: Place[];
  aerialways: Aerialway[];
}

async function readTheme(cache: string, theme: Theme): Promise<RawElement[]> {
  const text = await readFile(osmFile(cache, theme), "utf-8");
  return (JSON.parse(text) as { elements: RawElement[] }).elements;
}

function coords(points: RawPoint[] | undefined): Vec[] {
  return (points ?? []).map((point) => [point.lon, point.lat]);
}

function same(a: Vec | undefined, b: Vec | undefined): boolean {
  return a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];
}

/** Joins open ways that share end nodes into closed rings. */
export function joinRings(parts: Vec[][]): Ring[] {
  const rings: Ring[] = [];
  const open = parts.filter((part) => part.length > 1);
  while (open.length > 0) {
    const ring = [...(open.pop() ?? [])];
    let grown = true;
    while (!isClosed(ring) && grown) {
      grown = false;
      for (let index = 0; index < open.length; index += 1) {
        const part = open[index] ?? [];
        const end = ring.at(-1);
        if (same(end, part[0])) {
          ring.push(...part.slice(1));
        } else if (same(end, part.at(-1))) {
          ring.push(...part.toReversed().slice(1));
        } else if (same(ring[0], part.at(-1))) {
          ring.unshift(...part.slice(0, -1));
        } else if (same(ring[0], part[0])) {
          ring.unshift(...part.toReversed().slice(0, -1));
        } else {
          continue;
        }
        open.splice(index, 1);
        grown = true;
        break;
      }
    }
    if (isClosed(ring)) {
      rings.push(ring);
    }
  }
  return rings;
}

/** Outer rings counterclockwise and holes clockwise, holes under their outer. */
function assemble(outers: Ring[], inners: Ring[]): Polygon[] {
  const polygons = outers.map((outer) => ({
    holes: [] as Ring[],
    outer: signedArea(outer) < 0 ? outer.toReversed() : outer,
  }));
  for (const inner of inners) {
    const hole = signedArea(inner) > 0 ? inner.toReversed() : inner;
    const owner = polygons.find((polygon) =>
      pointInRing(hole[0] ?? [0, 0], polygon.outer)
    );
    owner?.holes.push(hole);
  }
  return polygons;
}

function polygonsOf(element: RawElement): Polygon[] {
  if (element.type === "way") {
    const ring = coords(element.geometry);
    return isClosed(ring) ? assemble([ring], []) : [];
  }
  if (element.type === "relation") {
    const members = element.members ?? [];
    const part = (role: string) =>
      members
        .filter((member) => member.type === "way" && member.role === role)
        .map((member) => coords(member.geometry));
    return assemble(joinRings(part("outer")), joinRings(part("inner")));
  }
  return [];
}

/** The number at the start of a tag, so "12 m" reads as 12. */
function numeric(value: string | undefined): number | undefined {
  const match = /^\s*-?\d+(?:\.\d+)?/u.exec((value ?? "").replace(",", "."));
  return match ? Number(match[0]) : undefined;
}

function compact(properties: Record<string, string | number | undefined>) {
  const result: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined && value !== "") {
      result[key] = value;
    }
  }
  return result;
}

// Building kinds that carry meaning beyond "yes".
function buildingKind(tags: Tags): string {
  const kind = tags.building ?? "yes";
  if (kind !== "yes") {
    return kind;
  }
  if (tags.amenity === "place_of_worship") {
    return "church";
  }
  if (tags.tourism === "hotel") {
    return "hotel";
  }
  if (tags.shop || tags.amenity) {
    return "commercial";
  }
  return kind;
}

function buildings(elements: RawElement[]): AreaFeature[] {
  const result: AreaFeature[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    if (
      tags.building === "no" ||
      tags.location === "underground" ||
      (numeric(tags.layer) ?? 0) < 0
    ) {
      continue;
    }
    for (const polygon of polygonsOf(element)) {
      result.push({
        id: element.id,
        polygon,
        properties: compact({
          height: numeric(tags.height),
          kind: buildingKind(tags),
          levels: numeric(tags["building:levels"]),
          minHeight: numeric(tags.min_height),
          roof: tags["roof:shape"],
        }),
      });
    }
  }
  return result;
}

const ROAD_KINDS: Record<string, RoadKind> = {
  bridleway: "footway",
  busway: "service",
  cycleway: "footway",
  footway: "footway",
  living_street: "residential",
  motorway: "motorway",
  motorway_link: "motorway",
  path: "footway",
  pedestrian: "pedestrian",
  primary: "primary",
  primary_link: "primary",
  residential: "residential",
  road: "residential",
  secondary: "secondary",
  secondary_link: "secondary",
  service: "service",
  steps: "steps",
  tertiary: "tertiary",
  tertiary_link: "tertiary",
  track: "track",
  trunk: "trunk",
  trunk_link: "trunk",
  unclassified: "residential",
};

const TUNNELS = new Set(["yes", "building_passage", "culvert", "covered"]);

function roads(
  elements: RawElement[],
  areaElements: RawElement[]
): LineFeature[] {
  const result: LineFeature[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const kind = ROAD_KINDS[tags.highway ?? ""];
    if (!kind || tags.area === "yes" || element.type !== "way") {
      continue;
    }
    result.push({
      id: element.id,
      line: coords(element.geometry),
      properties: compact({
        bridge: tags.bridge && tags.bridge !== "no" ? 1 : undefined,
        kind,
        lanes: numeric(tags.lanes),
        layer: numeric(tags.layer),
        name: tags.name,
        oneway: tags.oneway === "yes" ? 1 : undefined,
        tunnel:
          TUNNELS.has(tags.tunnel ?? "") || tags.covered === "yes"
            ? 1
            : undefined,
      }),
    });
  }
  for (const element of areaElements) {
    const tags = element.tags ?? {};
    const kind = tags.aeroway;
    const line = coords(element.geometry);
    if ((kind === "runway" || kind === "taxiway") && !isClosed(line)) {
      result.push({
        id: element.id,
        line,
        properties: compact({
          bridge: tags.bridge && tags.bridge !== "no" ? 1 : undefined,
          kind,
          name: tags.ref,
          width: numeric(tags.width),
        }),
      });
    }
  }
  return result;
}

/** OSM tags to land use, tried in order; the first match wins. */
const LANDUSE_RULES: [
  key: string,
  values: string[],
  kind: LanduseKind | "water",
][] = [
  ["natural", ["water"], "water"],
  ["landuse", ["reservoir", "basin"], "water"],
  ["leisure", ["swimming_pool"], "water"],
  ["waterway", ["riverbank"], "water"],
  ["landuse", ["forest"], "forest"],
  ["natural", ["wood"], "forest"],
  ["natural", ["scrub", "heath"], "scrub"],
  [
    "landuse",
    ["grass", "meadow", "village_green", "recreation_ground", "greenfield"],
    "grass",
  ],
  ["natural", ["grassland", "fell"], "grass"],
  ["landuse", ["orchard"], "orchard"],
  ["landuse", ["vineyard"], "vineyard"],
  [
    "landuse",
    [
      "farmland",
      "farmyard",
      "allotments",
      "greenhouse_horticulture",
      "plant_nursery",
      "animal_keeping",
    ],
    "farmland",
  ],
  ["landuse", ["residential"], "residential"],
  ["landuse", ["commercial", "retail"], "commercial"],
  [
    "landuse",
    [
      "industrial",
      "port",
      "railway",
      "construction",
      "brownfield",
      "landfill",
      "quarry",
      "depot",
      "garages",
      "military",
    ],
    "industrial",
  ],
  ["landuse", ["cemetery"], "cemetery"],
  ["amenity", ["grave_yard"], "cemetery"],
  [
    "amenity",
    ["school", "university", "college", "hospital", "kindergarten"],
    "institution",
  ],
  ["landuse", ["education", "religious"], "institution"],
  ["leisure", ["park", "garden", "common", "dog_park"], "park"],
  ["tourism", ["zoo", "theme_park"], "park"],
  ["leisure", ["golf_course"], "golf"],
  ["leisure", ["pitch", "track", "stadium"], "pitch"],
  ["leisure", ["playground"], "playground"],
  ["leisure", ["marina"], "marina"],
  ["natural", ["beach", "sand"], "beach"],
  ["natural", ["bare_rock", "scree", "shingle", "stone", "rock"], "rock"],
  ["natural", ["wetland"], "wetland"],
  ["amenity", ["parking"], "parking"],
  ["amenity", ["marketplace"], "pedestrian"],
  ["place", ["square"], "pedestrian"],
  ["highway", ["pedestrian"], "pedestrian"],
  ["aeroway", ["aerodrome"], "airport"],
  ["aeroway", ["apron"], "apron"],
];

function landuseKind(tags: Tags): LanduseKind | "water" | undefined {
  return LANDUSE_RULES.find(([key, values]) =>
    values.includes(tags[key] ?? "")
  )?.[2];
}

const WATERWAYS = new Set(["river", "stream", "canal", "ditch", "drain"]);
const PIERS = new Set(["pier", "breakwater", "groyne", "quay"]);

/** Piers and breakwaters: areas when they're drawn as areas, else lines. */
function pierFeatures(
  element: RawElement,
  tags: Tags
): (AreaFeature | LineFeature)[] {
  const properties = { kind: tags.man_made ?? "pier" };
  const polygons = tags.area === "no" ? [] : polygonsOf(element);
  if (polygons.length > 0) {
    return polygons.map((polygon) => ({ id: element.id, polygon, properties }));
  }
  const line = coords(element.geometry);
  return line.length > 1 ? [{ id: element.id, line, properties }] : [];
}

function waterwayFeature(element: RawElement, tags: Tags): LineFeature {
  return {
    id: element.id,
    line: coords(element.geometry),
    properties: compact({
      kind: tags.waterway,
      name: tags.name,
      tunnel: TUNNELS.has(tags.tunnel ?? "") ? 1 : undefined,
      width: numeric(tags.width),
    }),
  };
}

function areas(elements: RawElement[]) {
  const landuse: AreaFeature[] = [];
  const water: AreaFeature[] = [];
  const waterways: LineFeature[] = [];
  const piers: (AreaFeature | LineFeature)[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    if (tags.natural === "coastline") {
      continue;
    }
    if (WATERWAYS.has(tags.waterway ?? "") && element.type === "way") {
      waterways.push(waterwayFeature(element, tags));
      continue;
    }
    if (PIERS.has(tags.man_made ?? "")) {
      piers.push(...pierFeatures(element, tags));
      continue;
    }
    const kind = landuseKind(tags);
    if (!kind) {
      continue;
    }
    for (const polygon of polygonsOf(element)) {
      if (kind === "water") {
        water.push({
          id: element.id,
          polygon,
          properties: {
            kind: tags.leisure === "swimming_pool" ? "pool" : "water",
          },
        });
      } else {
        landuse.push({ id: element.id, polygon, properties: { kind } });
      }
    }
  }
  return { landuse, piers, water, waterways };
}

const PALMS =
  /palm|phoenix|washingtonia|archontophoenix|syagrus|livistona|cocos|howea/iu;

function trees(elements: RawElement[]): PointFeature[] {
  const result: PointFeature[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    if (tags.natural !== "tree" && tags.natural !== "tree_row") {
      continue;
    }
    const botany = `${tags.genus ?? ""} ${tags.species ?? ""} ${tags.taxon ?? ""}`;
    let kind = tags.leaf_type ?? "";
    if (PALMS.test(botany) || kind === "palm") {
      kind = "palm";
    }
    const properties = compact({ height: numeric(tags.height), kind });
    if (
      element.type === "node" &&
      element.lat !== undefined &&
      element.lon !== undefined
    ) {
      result.push({
        id: element.id,
        point: [element.lon, element.lat],
        properties,
      });
    } else if (element.type === "way") {
      // About one tree every eight meters along a row.
      const line = coords(element.geometry);
      const spacing = 8 / 111_000;
      for (const point of sampleLine(line, spacing)) {
        result.push({ id: element.id, point, properties });
      }
    }
  }
  return result;
}

const PLACE_RANK: Partial<Record<string, [PlaceKind, number]>> = {
  city: ["city", 100],
  hamlet: ["hamlet", 20],
  locality: ["locality", 10],
  suburb: ["suburb", 40],
  town: ["town", 80],
  village: ["village", 50],
};

function places(elements: RawElement[]): Place[] {
  const result: Place[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const { name } = tags;
    if (
      !name ||
      element.type !== "node" ||
      element.lat === undefined ||
      element.lon === undefined
    ) {
      continue;
    }
    const place = PLACE_RANK[tags.place ?? ""];
    if (place) {
      const population = numeric(tags.population) ?? 0;
      result.push({
        kind: place[0],
        lat: element.lat,
        lng: element.lon,
        name,
        rank: place[1] + Math.min(19, Math.log10(population + 1) * 3),
      });
    } else if (tags.natural === "peak" || tags.natural === "volcano") {
      const ele = numeric(tags.ele);
      result.push({
        ele,
        kind: "peak",
        lat: element.lat,
        lng: element.lon,
        name,
        rank: 30 + (ele ?? 0) / 100,
      });
    }
  }
  return result.toSorted((a, b) => b.rank - a.rank);
}

const LIFTS = new Set(["cable_car", "gondola", "chair_lift", "mixed_lift"]);

function aerialways(elements: RawElement[]): Aerialway[] {
  return elements.flatMap((element) => {
    const tags = element.tags ?? {};
    if (element.type !== "way" || !LIFTS.has(tags.aerialway ?? "")) {
      return [];
    }
    return [
      {
        kind: tags.aerialway ?? "cable_car",
        name: tags.name,
        path: coords(element.geometry).map(([lng, lat]) => ({ lat, lng })),
      },
    ];
  });
}

/** Land from the coastline, which runs with the land on its left. */
function land(elements: RawElement[]): Polygon[] {
  const rings = joinRings(
    elements
      .filter((element) => element.type === "way")
      .map((element) => coords(element.geometry))
  );
  return rings.map((ring) => ({
    holes: [],
    outer: signedArea(ring) < 0 ? close(ring.toReversed()) : ring,
  }));
}

export async function readOsm(cache: string): Promise<OsmData> {
  const [coastline, points, rawAreas, rawRoads, rawBuildings] =
    await Promise.all(
      (["coastline", "points", "areas", "roads", "buildings"] as const).map(
        (theme) => readTheme(cache, theme)
      )
    );
  const areaFeatures = areas(rawAreas ?? []);
  return {
    aerialways: aerialways(points ?? []),
    buildings: buildings(rawBuildings ?? []),
    land: land(coastline ?? []),
    landuse: areaFeatures.landuse,
    piers: areaFeatures.piers,
    places: places(points ?? []),
    roads: roads(rawRoads ?? [], rawAreas ?? []),
    trees: trees(points ?? []),
    water: areaFeatures.water,
    waterways: areaFeatures.waterways,
  };
}
