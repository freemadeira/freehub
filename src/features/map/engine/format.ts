/**
 * The world pack: what `tools/world` bakes and the engine reads. Bump
 * `WORLD_FORMAT` whenever either side changes shape.
 *
 * Positions live in a local frame: Web Mercator scaled to meters at the
 * origin's latitude, x to the east and z to the south. Tiles of any zoom are
 * then exact squares, and every tile maps to the frame by a scale and an offset.
 */
export const WORLD_FORMAT = 2;

/** Extent of vector tile coordinates, as in Mapbox Vector Tiles. */
export const TILE_EXTENT = 4096;

export interface LngLat {
  lat: number;
  lng: number;
}

export type Bounds = [west: number, south: number, east: number, north: number];

/** A raster over the local frame, stored north to south, west to east. */
export interface Grid {
  url: string;
  width: number;
  height: number;
  /** Local x and z of the first cell's center, in meters. */
  x: number;
  z: number;
  /** Meters between neighbouring cells. */
  step: number;
}

/**
 * Heights as gzipped little-endian Int16 rows, each value stored as the
 * difference from the cell to its west, which compresses far better than
 * the heights themselves. Meters = value * scale + offset.
 */
export interface HeightGrid extends Grid {
  scale: number;
  offset: number;
}

/** Land cover classes in `landcover.png`, one byte per cell. */
export const COVER = {
  bare: 6,
  built: 5,
  crop: 4,
  forest: 1,
  grass: 3,
  sea: 0,
  shrub: 2,
  water: 7,
  wetland: 8,
} as const;

export type Cover = (typeof COVER)[keyof typeof COVER];

/**
 * Distance from the coast out to sea, square-root encoded so the shore gets
 * the precision: meters = (byte / 255)² * `max`. 0 on land.
 */
export interface SeaGrid extends Grid {
  max: number;
}

export interface Camera {
  lat: number;
  lng: number;
  /** Meters from the camera to the point it looks at. */
  distance: number;
  /** Degrees above the horizon. */
  pitch: number;
  /** Degrees clockwise from north. */
  heading: number;
}

export type PlaceKind =
  | "city"
  | "town"
  | "village"
  | "suburb"
  | "hamlet"
  | "peak"
  | "locality";

export interface Place extends LngLat {
  name: string;
  kind: PlaceKind;
  /** Meters above sea level, for peaks. */
  ele?: number;
  /** Higher shows first when labels collide. */
  rank: number;
}

/** A hand-made model that stands in for what the map would draw there. */
export interface Landmark extends LngLat {
  id: string;
  name: string;
  /** glTF binary, relative to `world.json`. */
  model: string;
  /** Round picture shown with the label, relative to `world.json`. */
  badge?: string;
  /** Degrees clockwise from north. */
  heading: number;
  /** Map buildings within this many meters are hidden under the model. */
  clear: number;
}

/** Cable cars and lifts, drawn with moving cabins. */
export interface Aerialway {
  kind: string;
  name?: string;
  /** Stations and pylons, in order. */
  path: LngLat[];
}

export interface WorldManifest {
  format: typeof WORLD_FORMAT;
  name: string;
  origin: LngLat;
  bounds: Bounds;
  heights: HeightGrid;
  landcover: Grid;
  sea: SeaGrid;
  tiles: {
    /** With `{z}`, `{x}` and `{y}`, relative to `world.json`. Gzipped MVT. */
    url: string;
    /** Zooms that hold data: overview, middle and detail. */
    zooms: [overview: number, middle: number, detail: number];
    /** `x/y` of every tile that exists, by zoom. */
    available: Record<string, string[]>;
  };
  view: Camera;
  places: Place[];
  landmarks: Landmark[];
  aerialways: Aerialway[];
  attribution: string[];
}

/** Vector tile layers and the `kind` values the bake normalizes OSM tags to. */
export const LAYER = {
  buildings: "buildings",
  land: "land",
  landuse: "landuse",
  piers: "piers",
  roads: "roads",
  trees: "trees",
  water: "water",
  waterways: "waterways",
} as const;

export const LANDUSE_KINDS = [
  "forest",
  "scrub",
  "grass",
  "farmland",
  "orchard",
  "vineyard",
  "residential",
  "commercial",
  "industrial",
  "institution",
  "cemetery",
  "park",
  "golf",
  "pitch",
  "playground",
  "beach",
  "rock",
  "wetland",
  "parking",
  "pedestrian",
  "airport",
  "apron",
  "marina",
] as const;

export type LanduseKind = (typeof LANDUSE_KINDS)[number];

export const ROAD_KINDS = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "service",
  "pedestrian",
  "track",
  "footway",
  "steps",
  "runway",
  "taxiway",
] as const;

export type RoadKind = (typeof ROAD_KINDS)[number];
