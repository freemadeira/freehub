import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

import { LAYER, TILE_EXTENT } from "../format.ts";
import type { Frame, Point, Square, TileId } from "../geo.ts";
import { tileKey, tileSquare } from "../geo.ts";
import { fetchBytes } from "../heights.ts";

export type Properties = Record<string, string | number | boolean>;

/** Outer ring first, then holes; every ring closed. */
export interface Area {
  id: number;
  rings: Point[][];
  properties: Properties;
}

export interface Line {
  id: number;
  points: Point[];
  properties: Properties;
}

export interface Spot {
  id: number;
  point: Point;
  properties: Properties;
}

/** One data tile's features, in the local frame. */
export interface TileFeatures {
  square: Square;
  land: Area[];
  landuse: Area[];
  water: Area[];
  waterways: Line[];
  roads: Line[];
  buildings: Area[];
  trees: Spot[];
  piers: (Area | Line)[];
}

function empty(square: Square): TileFeatures {
  return {
    buildings: [],
    land: [],
    landuse: [],
    piers: [],
    roads: [],
    square,
    trees: [],
    water: [],
    waterways: [],
  };
}

function decode(bytes: Uint8Array, square: Square): TileFeatures {
  const tile = new VectorTile(new PbfReader(bytes));
  const features = empty(square);
  const scale = square.size / TILE_EXTENT;
  const local = (ring: { x: number; y: number }[]): Point[] =>
    ring.map((point) => ({
      x: square.x + point.x * scale,
      z: square.z + point.y * scale,
    }));

  for (const [name, layer] of Object.entries(tile.layers)) {
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      const id = feature.id ?? index;
      const { properties } = feature;
      const geometry = feature.loadGeometry();
      if (feature.type === 3) {
        for (const polygon of classifyRings(geometry)) {
          const area = { id, properties, rings: polygon.map(local) };
          if (name === LAYER.buildings) {
            features.buildings.push(area);
          } else if (name === LAYER.land) {
            features.land.push(area);
          } else if (name === LAYER.landuse) {
            features.landuse.push(area);
          } else if (name === LAYER.water) {
            features.water.push(area);
          } else if (name === LAYER.piers) {
            features.piers.push(area);
          }
        }
      } else if (feature.type === 2) {
        for (const line of geometry) {
          const item = { id, points: local(line), properties };
          if (name === LAYER.roads) {
            features.roads.push(item);
          } else if (name === LAYER.waterways) {
            features.waterways.push(item);
          } else if (name === LAYER.piers) {
            features.piers.push(item);
          }
        }
      } else if (feature.type === 1 && name === LAYER.trees) {
        for (const ring of geometry) {
          for (const point of local(ring)) {
            features.trees.push({ id, point, properties });
          }
        }
      }
    }
  }
  return features;
}

const CACHE_SIZE = 48;

/** Fetches and decodes data tiles, keeping the recent ones. */
export class VectorSource {
  private readonly cache = new Map<string, Promise<TileFeatures>>();
  private readonly frame: Frame;
  /** With `{z}`, `{x}` and `{y}`; filled in before resolving against `base`. */
  private readonly template: string;
  private readonly base: string;
  private readonly available: Map<number, Set<string>>;

  constructor(
    frame: Frame,
    template: string,
    base: string,
    available: Record<string, string[]>
  ) {
    this.frame = frame;
    this.template = template;
    this.base = base;
    this.available = new Map(
      Object.entries(available).map(([zoom, keys]) => [
        Number(zoom),
        new Set(keys),
      ])
    );
  }

  private async load(tile: TileId, key: string): Promise<TileFeatures> {
    const square = tileSquare(this.frame, tile);
    if (!this.available.get(tile.z)?.has(`${tile.x}/${tile.y}`)) {
      return empty(square);
    }
    const path = this.template
      .replace("{z}", String(tile.z))
      .replace("{x}", String(tile.x))
      .replace("{y}", String(tile.y));
    try {
      return decode(await fetchBytes(new URL(path, this.base).href), square);
    } catch (error) {
      // A failed fetch shouldn't stay cached.
      this.cache.delete(key);
      throw error;
    }
  }

  get(tile: TileId): Promise<TileFeatures> {
    const key = tileKey(tile);
    const cached = this.cache.get(key);
    if (cached) {
      // Most recently used last.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const promise = this.load(tile, key);
    this.cache.set(key, promise);
    while (this.cache.size > CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.cache.delete(oldest);
    }
    return promise;
  }
}
