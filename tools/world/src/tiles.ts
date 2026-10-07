import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

import vtpbf from "vt-pbf";

import { LAYER, TILE_EXTENT } from "../../../src/features/map/engine/format.ts";
import { mercatorX, mercatorY } from "../../../src/features/map/engine/geo.ts";
import type { Box, Ring, Vec } from "./geometry.ts";
import {
  boxOf,
  centroid,
  clipLine,
  clipRing,
  signedArea,
  simplify,
} from "./geometry.ts";
import type { AreaFeature, LineFeature, OsmData, PointFeature } from "./osm.ts";

type Properties = Record<string, string | number>;

interface TileFeature {
  id?: number;
  type: 1 | 2 | 3;
  geometry: number[][] | number[][][];
  tags: Properties;
}

type TileLayers = Map<string, TileFeature[]>;

/** Room around each tile so strokes and fills meet their neighbours'. */
const BUFFER = 64;
const EARTH_CIRCUMFERENCE = 40_075_016.686;

interface Level {
  z: number;
  /** Meters of simplification. */
  tolerance: number;
  /** Smallest area kept, in square meters. */
  minArea: number;
  roads: Set<string> | "all";
  waterways: Set<string> | "all";
  buildings: boolean;
  trees: boolean;
  piers: boolean;
  names: boolean;
}

function levels([overview, middle, detail]: [number, number, number]): Level[] {
  return [
    {
      buildings: false,
      minArea: 40_000,
      names: false,
      piers: false,
      roads: new Set(["motorway", "trunk", "primary", "secondary", "runway"]),
      tolerance: 15,
      trees: false,
      waterways: new Set(["river"]),
      z: overview,
    },
    {
      buildings: false,
      minArea: 2000,
      names: false,
      piers: true,
      roads: new Set([
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "residential",
        "runway",
        "taxiway",
      ]),
      tolerance: 3,
      trees: false,
      waterways: new Set(["river", "canal"]),
      z: middle,
    },
    {
      buildings: true,
      minArea: 0,
      names: true,
      piers: true,
      roads: "all",
      tolerance: 0.3,
      trees: true,
      waterways: "all",
      z: detail,
    },
  ];
}

/** Lng/lat to mercator, once per feature. */
function project(points: Vec[]): Vec[] {
  return points.map(([lng, lat]) => [mercatorX(lng), mercatorY(lat)]);
}

/** Deck height anywhere along a bridge: straight from one abutment to the other. */
export function deckOf(
  line: Vec[],
  elevation: Elevation
): (point: Vec) => number {
  const lengths = [0];
  for (let index = 1; index < line.length; index += 1) {
    const [ax, ay] = line[index - 1] ?? [0, 0];
    const [bx, by] = line[index] ?? [0, 0];
    lengths.push((lengths.at(-1) ?? 0) + Math.hypot(bx - ax, by - ay));
  }
  const total = lengths.at(-1) || 1;
  const [sx, sy] = line[0] ?? [0, 0];
  const [ex, ey] = line.at(-1) ?? [0, 0];
  const start = elevation(sx, sy) + 0.4;
  const end = elevation(ex, ey) + 0.4;
  return ([px, py]) => {
    let best = Number.POSITIVE_INFINITY;
    let along = 0;
    for (let index = 1; index < line.length; index += 1) {
      const [ax, ay] = line[index - 1] ?? [0, 0];
      const [bx, by] = line[index] ?? [0, 0];
      const dx = bx - ax;
      const dy = by - ay;
      const length = dx * dx + dy * dy;
      const t =
        length === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)
            );
      const distance = Math.hypot(ax + dx * t - px, ay + dy * t - py);
      if (distance < best) {
        best = distance;
        along = (lengths[index - 1] ?? 0) + t * Math.sqrt(length);
      }
    }
    return Math.round((start + ((end - start) * along) / total) * 10) / 10;
  };
}

class Tiler {
  readonly tiles = new Map<string, TileLayers>();
  private readonly level: Level;
  private readonly count: number;
  /** Meters per mercator unit, near enough for tolerances and areas. */
  private readonly meters: number;

  /** Ground height in meters at a mercator point, for bridge decks. */
  private readonly elevation: Elevation;

  constructor(level: Level, latitude: number, elevation: Elevation) {
    this.level = level;
    this.count = 2 ** level.z;
    this.meters = EARTH_CIRCUMFERENCE * Math.cos((latitude * Math.PI) / 180);
    this.elevation = elevation;
  }

  private add(x: number, y: number, layer: string, feature: TileFeature) {
    const key = `${x}/${y}`;
    let layers = this.tiles.get(key);
    if (!layers) {
      layers = new Map();
      this.tiles.set(key, layers);
    }
    const list = layers.get(layer) ?? [];
    list.push(feature);
    layers.set(layer, list);
  }

  private tileBox(x: number, y: number): Box {
    const pad = BUFFER / TILE_EXTENT;
    return {
      maxX: (x + 1 + pad) / this.count,
      maxY: (y + 1 + pad) / this.count,
      minX: (x - pad) / this.count,
      minY: (y - pad) / this.count,
    };
  }

  private range(box: Box): [number, number, number, number] {
    return [
      Math.floor(box.minX * this.count),
      Math.floor(box.minY * this.count),
      Math.floor(box.maxX * this.count),
      Math.floor(box.maxY * this.count),
    ];
  }

  private toTile(points: Vec[], x: number, y: number): number[][] {
    const result: number[][] = [];
    for (const [mx, my] of points) {
      const px = Math.round((mx * this.count - x) * TILE_EXTENT);
      const py = Math.round((my * this.count - y) * TILE_EXTENT);
      const last = result.at(-1);
      if (!last || last[0] !== px || last[1] !== py) {
        result.push([px, py]);
      }
    }
    return result;
  }

  private simplified(points: Vec[]): Vec[] {
    return simplify(points, this.level.tolerance / this.meters);
  }

  /** MVT wants outer rings with positive area in tile space, holes negative. */
  private static orient(ring: number[][], outer: boolean): number[][] {
    const area = signedArea(ring as Vec[]);
    return area > 0 === outer ? ring : ring.toReversed();
  }

  addPolygon(
    layer: string,
    feature: AreaFeature,
    properties: Properties
  ): void {
    const outer = this.simplified(project(feature.polygon.outer));
    const holes = feature.polygon.holes.map((hole) =>
      this.simplified(project(hole))
    );
    const area = Math.abs(signedArea(outer)) * this.meters * this.meters;
    if (outer.length < 4 || area < this.level.minArea) {
      return;
    }
    const [x0, y0, x1, y1] = this.range(boxOf(outer));
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const box = this.tileBox(x, y);
        const rings: number[][][] = [];
        const clippedOuter = this.toTile(clipRing(outer, box), x, y);
        if (clippedOuter.length < 4 || signedArea(clippedOuter as Ring) === 0) {
          continue;
        }
        rings.push(Tiler.orient(clippedOuter, true));
        for (const hole of holes) {
          const clipped = this.toTile(clipRing(hole, box), x, y);
          if (clipped.length >= 4 && signedArea(clipped as Ring) !== 0) {
            rings.push(Tiler.orient(clipped, false));
          }
        }
        this.add(x, y, layer, {
          geometry: rings,
          id: feature.id,
          tags: properties,
          type: 3,
        });
      }
    }
  }

  /** Whole, in the tile holding its centroid: cut buildings would grow walls. */
  addBuilding(feature: AreaFeature): void {
    const outer = project(feature.polygon.outer);
    const [cx, cy] = centroid(outer);
    const x = Math.floor(cx * this.count);
    const y = Math.floor(cy * this.count);
    const rings = [
      Tiler.orient(this.toTile(outer, x, y), true),
      ...feature.polygon.holes.map((hole) =>
        Tiler.orient(this.toTile(project(hole), x, y), false)
      ),
    ].filter((ring) => ring.length >= 4);
    if (rings.length > 0) {
      this.add(x, y, LAYER.buildings, {
        geometry: rings,
        id: feature.id,
        tags: feature.properties,
        type: 3,
      });
    }
  }

  addLine(layer: string, feature: LineFeature, properties: Properties): void {
    const line = this.simplified(project(feature.line));
    if (line.length < 2) {
      return;
    }
    const deck = properties.bridge === 1 ? this.deck(line) : undefined;
    const [x0, y0, x1, y1] = this.range(boxOf(line));
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (const piece of clipLine(line, this.tileBox(x, y))) {
          const geometry = this.toTile(piece, x, y);
          if (geometry.length < 2) {
            continue;
          }
          // Each piece of a bridge carries the deck height at its two ends.
          const tags = deck
            ? {
                ...properties,
                e0: deck(piece[0] ?? [0, 0]),
                e1: deck(piece.at(-1) ?? [0, 0]),
              }
            : properties;
          this.add(x, y, layer, {
            geometry: [geometry],
            id: feature.id,
            tags,
            type: 2,
          });
        }
      }
    }
  }

  private deck(line: Vec[]): (point: Vec) => number {
    return deckOf(line, this.elevation);
  }

  addPoint(layer: string, feature: PointFeature): void {
    const [point] = project([feature.point]);
    if (!point) {
      return;
    }
    const x = Math.floor(point[0] * this.count);
    const y = Math.floor(point[1] * this.count);
    const [tilePoint] = this.toTile([point], x, y);
    if (tilePoint) {
      this.add(x, y, layer, {
        geometry: [tilePoint],
        id: feature.id,
        tags: feature.properties,
        type: 1,
      });
    }
  }
}

function withoutName(properties: Properties, names: boolean): Properties {
  if (names || !("name" in properties)) {
    return properties;
  }
  const { name: _name, ...rest } = properties;
  return rest;
}

function allowed(set: Set<string> | "all", kind: string | number | undefined) {
  return set === "all" || set.has(String(kind));
}

/** Writes every tile; returns which ones exist, by zoom. */
export type Elevation = (mx: number, my: number) => number;

export async function writeTiles(
  data: OsmData,
  zooms: [number, number, number],
  latitude: number,
  elevation: Elevation,
  out: string
): Promise<Record<string, string[]>> {
  const available: Record<string, string[]> = {};
  for (const level of levels(zooms)) {
    const tiler = new Tiler(level, latitude, elevation);
    for (const polygon of data.land) {
      tiler.addPolygon(LAYER.land, { id: 0, polygon, properties: {} }, {});
    }
    for (const feature of data.landuse) {
      tiler.addPolygon(LAYER.landuse, feature, feature.properties);
    }
    for (const feature of data.water) {
      tiler.addPolygon(LAYER.water, feature, feature.properties);
    }
    for (const feature of data.waterways) {
      if (
        allowed(level.waterways, feature.properties.kind) &&
        !feature.properties.tunnel
      ) {
        tiler.addLine(
          LAYER.waterways,
          feature,
          withoutName(feature.properties, level.names)
        );
      }
    }
    for (const feature of data.roads) {
      if (
        allowed(level.roads, feature.properties.kind) &&
        !feature.properties.tunnel
      ) {
        tiler.addLine(
          LAYER.roads,
          feature,
          withoutName(feature.properties, level.names)
        );
      }
    }
    if (level.piers) {
      for (const feature of data.piers) {
        if ("polygon" in feature) {
          tiler.addPolygon(LAYER.piers, feature, feature.properties);
        } else {
          tiler.addLine(LAYER.piers, feature, feature.properties);
        }
      }
    }
    if (level.buildings) {
      for (const feature of data.buildings) {
        tiler.addBuilding(feature);
      }
    }
    if (level.trees) {
      for (const feature of data.trees) {
        tiler.addPoint(LAYER.trees, feature);
      }
    }
    const keys = [...tiler.tiles.keys()].toSorted();
    available[String(level.z)] = keys;
    // oxlint-disable-next-line no-await-in-loop -- one zoom at a time keeps memory flat
    await Promise.all(
      [...tiler.tiles].map(async ([key, layers]) => {
        const buffer = vtpbf.fromGeojsonVt(
          Object.fromEntries(
            [...layers].map(([name, features]) => [name, { features }])
          ),
          { extent: TILE_EXTENT, version: 2 }
        );
        const file = path.join(out, "tiles", String(level.z), `${key}.mvt`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, gzipSync(buffer, { level: 9 }));
      })
    );
    console.log(`  zoom ${level.z}: ${keys.length} tiles`);
  }
  return available;
}
