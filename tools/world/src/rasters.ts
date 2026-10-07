import { gzipSync } from "node:zlib";

import { encode } from "fast-png";
import { fromFile } from "geotiff";

import type { Cover } from "../../../src/features/map/engine/format.ts";
import { COVER } from "../../../src/features/map/engine/format.ts";
import type { Frame } from "../../../src/features/map/engine/geo.ts";
import { toLngLat, toLocal } from "../../../src/features/map/engine/geo.ts";
import type { Polygon } from "./geometry.ts";

/** A geographic raster: values and where its pixel centers sit. */
interface GeoRaster {
  data: ArrayLike<number>;
  width: number;
  height: number;
  /** Longitude and latitude of pixel (0, 0)'s center. */
  lng: number;
  lat: number;
  /** Degrees per pixel. */
  step: number;
}

/** A raster over the local frame; cell (0, 0) is the north-west one. */
export interface LocalGrid<T extends ArrayLike<number>> {
  data: T;
  width: number;
  height: number;
  /** Local x and z of cell (0, 0)'s center. */
  x: number;
  z: number;
  step: number;
}

export interface Extent {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

function gridOver<T extends ArrayLike<number>>(
  extent: Extent,
  step: number,
  make: (size: number) => T
): LocalGrid<T> {
  const width = Math.ceil((extent.maxX - extent.minX) / step);
  const height = Math.ceil((extent.maxZ - extent.minZ) / step);
  return {
    data: make(width * height),
    height,
    step,
    width,
    x: extent.minX + step / 2,
    z: extent.minZ + step / 2,
  };
}

/** Reads a GeoTIFF window, honoring whether its tie point is a pixel center or corner. */
async function readRaster(
  file: string,
  bounds?: [number, number, number, number]
): Promise<GeoRaster> {
  const tiff = await fromFile(file);
  const image = await tiff.getImage();
  const [originLng, originLat] = image.getOrigin();
  const [step] = image.getResolution();
  const pointRegistered = image.getGeoKeys()?.GTRasterTypeGeoKey === 2;
  const half = pointRegistered ? 0 : 0.5;
  const firstLng = (originLng ?? 0) + half * (step ?? 1);
  const firstLat = (originLat ?? 0) - half * (step ?? 1);
  const size = step ?? 1;
  let window = [0, 0, image.getWidth(), image.getHeight()];
  if (bounds) {
    const [west, south, east, north] = bounds;
    window = [
      Math.max(0, Math.floor((west - firstLng) / size) - 2),
      Math.max(0, Math.floor((firstLat - north) / size) - 2),
      Math.min(image.getWidth(), Math.ceil((east - firstLng) / size) + 3),
      Math.min(image.getHeight(), Math.ceil((firstLat - south) / size) + 3),
    ];
  }
  const [left = 0, top = 0, right = 0, bottom = 0] = window;
  const data = (await image.readRasters({
    interleave: true,
    window,
  })) as unknown as ArrayLike<number>;
  return {
    data,
    height: bottom - top,
    lat: firstLat - top * size,
    lng: firstLng + left * size,
    step: size,
    width: right - left,
  };
}

function inside(raster: GeoRaster, lng: number, lat: number): boolean {
  const column = (lng - raster.lng) / raster.step;
  const row = (raster.lat - lat) / raster.step;
  return (
    column >= -0.5 &&
    row >= -0.5 &&
    column <= raster.width - 0.5 &&
    row <= raster.height - 0.5
  );
}

function bilinear(raster: GeoRaster, lng: number, lat: number): number {
  const column = Math.min(
    raster.width - 1.001,
    Math.max(0, (lng - raster.lng) / raster.step)
  );
  const row = Math.min(
    raster.height - 1.001,
    Math.max(0, (raster.lat - lat) / raster.step)
  );
  const c = Math.floor(column);
  const r = Math.floor(row);
  const fx = column - c;
  const fy = row - r;
  const at = (dc: number, dr: number) =>
    raster.data[(r + dr) * raster.width + c + dc] ?? 0;
  const top = at(0, 0) * (1 - fx) + at(1, 0) * fx;
  const bottom = at(0, 1) * (1 - fx) + at(1, 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

function nearest(raster: GeoRaster, lng: number, lat: number): number {
  const column = Math.round((lng - raster.lng) / raster.step);
  const row = Math.round((raster.lat - lat) / raster.step);
  if (column < 0 || row < 0 || column >= raster.width || row >= raster.height) {
    return 0;
  }
  return raster.data[row * raster.width + column] ?? 0;
}

/** Even–odd scanline fill of polygons given in the local frame. */
export function rasterize(
  grid: LocalGrid<Uint8Array>,
  polygons: { x: number; z: number }[][][]
): void {
  interface Edge {
    x1: number;
    z1: number;
    x2: number;
    z2: number;
  }
  const rows: Edge[][] = Array.from({ length: grid.height }, () => []);
  for (const rings of polygons) {
    for (const ring of rings) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        const a = ring[index] ?? { x: 0, z: 0 };
        const b = ring[index + 1] ?? { x: 0, z: 0 };
        if (a.z === b.z) {
          continue;
        }
        const top = Math.min(a.z, b.z);
        const first = Math.max(0, Math.ceil((top - grid.z) / grid.step));
        rows[Math.min(first, grid.height - 1)]?.push({
          x1: a.x,
          x2: b.x,
          z1: a.z,
          z2: b.z,
        });
      }
    }
  }
  let active: Edge[] = [];
  for (let row = 0; row < grid.height; row += 1) {
    const z = grid.z + row * grid.step;
    active = [...active, ...(rows[row] ?? [])].filter(
      (edge) => Math.max(edge.z1, edge.z2) > z
    );
    const crossings = active
      .filter((edge) => Math.min(edge.z1, edge.z2) <= z)
      .map(
        (edge) =>
          edge.x1 + ((z - edge.z1) * (edge.x2 - edge.x1)) / (edge.z2 - edge.z1)
      )
      .toSorted((a, b) => a - b);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const from = Math.max(
        0,
        Math.ceil(((crossings[index] ?? 0) - grid.x) / grid.step)
      );
      const to = Math.min(
        grid.width - 1,
        Math.floor(((crossings[index + 1] ?? 0) - grid.x) / grid.step)
      );
      for (let column = from; column <= to; column += 1) {
        const cell = row * grid.width + column;
        grid.data[cell] = 1 - (grid.data[cell] ?? 0);
      }
    }
  }
}

/** Squared distances along one line (Felzenszwalb & Huttenlocher). */
function distance1d(
  f: Float64Array,
  length: number,
  out: Float64Array,
  v: Int32Array,
  z: Float64Array
): void {
  let k = 0;
  v[0] = 0;
  z[0] = Number.NEGATIVE_INFINITY;
  z[1] = Number.POSITIVE_INFINITY;
  for (let q = 1; q < length; q += 1) {
    let s = 0;
    for (;;) {
      const p = v[k] ?? 0;
      s = ((f[q] ?? 0) + q * q - ((f[p] ?? 0) + p * p)) / (2 * q - 2 * p);
      if (s > (z[k] ?? 0) || k === 0) {
        break;
      }
      k -= 1;
    }
    if (s <= (z[k] ?? 0)) {
      v[0] = q;
      z[0] = Number.NEGATIVE_INFINITY;
      z[1] = Number.POSITIVE_INFINITY;
      k = 0;
      continue;
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Number.POSITIVE_INFINITY;
  }
  k = 0;
  for (let q = 0; q < length; q += 1) {
    while ((z[k + 1] ?? 0) < q) {
      k += 1;
    }
    const p = v[k] ?? 0;
    out[q] = (q - p) * (q - p) + (f[p] ?? 0);
  }
}

/** Meters from each cell to the nearest land cell. */
export function distanceToLand(mask: LocalGrid<Uint8Array>): Float32Array {
  const { width, height } = mask;
  const big = 1e20;
  const grid = new Float64Array(width * height);
  for (let cell = 0; cell < grid.length; cell += 1) {
    grid[cell] = mask.data[cell] ? 0 : big;
  }
  const longest = Math.max(width, height);
  const f = new Float64Array(longest);
  const out = new Float64Array(longest);
  const v = new Int32Array(longest);
  const z = new Float64Array(longest + 1);
  for (let column = 0; column < width; column += 1) {
    for (let row = 0; row < height; row += 1) {
      f[row] = grid[row * width + column] ?? big;
    }
    distance1d(f, height, out, v, z);
    for (let row = 0; row < height; row += 1) {
      grid[row * width + column] = out[row] ?? big;
    }
  }
  const result = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      f[column] = grid[row * width + column] ?? big;
    }
    distance1d(f, width, out, v, z);
    for (let column = 0; column < width; column += 1) {
      result[row * width + column] = Math.sqrt(out[column] ?? big) * mask.step;
    }
  }
  return result;
}

function sampleGrid<T extends ArrayLike<number>>(
  grid: LocalGrid<T>,
  x: number,
  z: number
): number {
  const column = Math.round((x - grid.x) / grid.step);
  const row = Math.round((z - grid.z) / grid.step);
  if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) {
    return 0;
  }
  return grid.data[row * grid.width + column] ?? 0;
}

export function landMask(
  frame: Frame,
  extent: Extent,
  land: Polygon[],
  step: number
): LocalGrid<Uint8Array> {
  const grid = gridOver(extent, step, (size) => new Uint8Array(size));
  rasterize(
    grid,
    land.map((polygon) =>
      [polygon.outer, ...polygon.holes].map((ring) =>
        ring.map(([lng, lat]) => toLocal(frame, { lat, lng }))
      )
    )
  );
  return grid;
}

// WorldCover classes to ours.
const WORLDCOVER: Record<number, Cover> = {
  10: COVER.forest,
  100: COVER.grass,
  20: COVER.shrub,
  30: COVER.grass,
  40: COVER.crop,
  50: COVER.built,
  60: COVER.bare,
  70: COVER.bare,
  80: COVER.water,
  90: COVER.wetland,
  95: COVER.wetland,
};

/** Land cover, cleaned of single-cell speckle, with the sea from the land mask. */
export async function landcover(
  frame: Frame,
  extent: Extent,
  files: string[],
  mask: LocalGrid<Uint8Array>,
  bounds: [number, number, number, number],
  step: number
): Promise<LocalGrid<Uint8Array>> {
  const rasters = await Promise.all(
    files.map((file) => readRaster(file, bounds))
  );
  const grid = gridOver(extent, step, (size) => new Uint8Array(size));
  const raw = new Uint8Array(grid.data.length);
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const x = grid.x + column * step;
      const z = grid.z + row * step;
      const cell = row * grid.width + column;
      if (!sampleGrid(mask, x, z)) {
        raw[cell] = COVER.sea;
        continue;
      }
      const { lat, lng } = toLngLat(frame, { x, z });
      const raster = rasters.find((item) => inside(item, lng, lat));
      const value = raster ? nearest(raster, lng, lat) : 0;
      raw[cell] = WORLDCOVER[value] ?? COVER.grass;
    }
  }
  // Majority of the 3×3 neighbourhood, so lone pixels don't speckle the ground.
  const counts = new Uint8Array(16);
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const cell = row * grid.width + column;
      const own = raw[cell] ?? 0;
      if (own === COVER.sea) {
        grid.data[cell] = own;
        continue;
      }
      counts.fill(0);
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const r = Math.min(grid.height - 1, Math.max(0, row + dr));
          const c = Math.min(grid.width - 1, Math.max(0, column + dc));
          const value = raw[r * grid.width + c] ?? 0;
          counts[value] = (counts[value] ?? 0) + 1;
        }
      }
      let best = own;
      for (let value = 1; value < counts.length; value += 1) {
        if ((counts[value] ?? 0) > (counts[best] ?? 0)) {
          best = value;
        }
      }
      grid.data[cell] = best;
    }
  }
  return grid;
}

export const SEA_FLOOR = -8;
const LOWEST_LAND = 0.8;

/**
 * Heights from the elevation model, the sea pressed down to a floor and the
 * coast following OSM rather than the model. Built-up areas get smoothed,
 * because the model is a surface model and would raise the town's own blocks.
 */
export async function heights(
  frame: Frame,
  extent: Extent,
  files: string[],
  mask: LocalGrid<Uint8Array>,
  cover: LocalGrid<Uint8Array>,
  step: number
): Promise<LocalGrid<Float32Array>> {
  const rasters = await Promise.all(files.map((file) => readRaster(file)));
  const grid = gridOver(extent, step, (size) => new Float32Array(size));
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const x = grid.x + column * step;
      const z = grid.z + row * step;
      const cell = row * grid.width + column;
      if (!sampleGrid(mask, x, z)) {
        grid.data[cell] = SEA_FLOOR;
        continue;
      }
      const { lat, lng } = toLngLat(frame, { x, z });
      const raster = rasters.find((item) => inside(item, lng, lat));
      const height = raster ? bilinear(raster, lng, lat) : 0;
      grid.data[cell] = Math.max(
        LOWEST_LAND,
        Number.isFinite(height) ? height : 0
      );
    }
  }
  const smoothed = Float32Array.from(grid.data);
  const radius = 2;
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const x = grid.x + column * step;
      const z = grid.z + row * step;
      if (sampleGrid(cover, x, z) !== COVER.built) {
        continue;
      }
      let sum = 0;
      let count = 0;
      for (let dr = -radius; dr <= radius; dr += 1) {
        for (let dc = -radius; dc <= radius; dc += 1) {
          const r = row + dr;
          const c = column + dc;
          const value = grid.data[r * grid.width + c];
          if (
            r >= 0 &&
            c >= 0 &&
            r < grid.height &&
            c < grid.width &&
            value !== undefined &&
            value > SEA_FLOOR
          ) {
            sum += value;
            count += 1;
          }
        }
      }
      if (count > 0) {
        smoothed[row * grid.width + column] = Math.max(
          LOWEST_LAND,
          sum / count
        );
      }
    }
  }
  return { ...grid, data: smoothed };
}

/** Int16 differences along each row, gzipped: see `HeightGrid`. */
export function encodeHeights(
  grid: LocalGrid<Float32Array>,
  scale: number,
  offset: number
): Buffer {
  const deltas = new Int16Array(grid.data.length);
  for (let row = 0; row < grid.height; row += 1) {
    let previous = 0;
    for (let column = 0; column < grid.width; column += 1) {
      const cell = row * grid.width + column;
      const value = Math.round(((grid.data[cell] ?? 0) - offset) / scale);
      deltas[cell] = value - previous;
      previous = value;
    }
  }
  return gzipSync(Buffer.from(deltas.buffer), { level: 9 });
}

export function encodeGray(grid: LocalGrid<Uint8Array>): Uint8Array {
  return encode({
    channels: 1,
    data: grid.data,
    depth: 8,
    height: grid.height,
    width: grid.width,
  });
}

/** Distance out to sea, one byte per cell in units of `scale` meters. */
/** Bilinear between cell centers, so the shore lands between cells. */
function sampleSmooth(grid: LocalGrid<Float32Array>, x: number, z: number) {
  const fx = Math.min(
    grid.width - 1.001,
    Math.max(0, (x - grid.x) / grid.step)
  );
  const fz = Math.min(
    grid.height - 1.001,
    Math.max(0, (z - grid.z) / grid.step)
  );
  const column = Math.floor(fx);
  const row = Math.floor(fz);
  const tx = fx - column;
  const tz = fz - row;
  const at = (dc: number, dr: number) =>
    grid.data[(row + dr) * grid.width + column + dc] ?? 0;
  return (
    (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - tz) +
    (at(0, 1) * (1 - tx) + at(1, 1) * tx) * tz
  );
}

/**
 * Distance out to sea, one byte per cell, square-root encoded: see `SeaGrid`.
 * Distances are to land cell centers, so half a cell comes off to reach the
 * shore itself.
 */
export function seaGrid(
  extent: Extent,
  mask: LocalGrid<Uint8Array>,
  distances: Float32Array,
  step: number,
  max: number
): LocalGrid<Uint8Array> {
  const grid = gridOver(extent, step, (size) => new Uint8Array(size));
  const field: LocalGrid<Float32Array> = { ...mask, data: distances };
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const x = grid.x + column * step;
      const z = grid.z + row * step;
      const inMask =
        x >= mask.x &&
        z >= mask.z &&
        x <= mask.x + mask.width * mask.step &&
        z <= mask.z + mask.height * mask.step;
      const distance = inMask
        ? Math.max(0, sampleSmooth(field, x, z) - mask.step / 2)
        : max;
      grid.data[row * grid.width + column] = Math.round(
        Math.sqrt(Math.min(1, distance / max)) * 255
      );
    }
  }
  return grid;
}

export function extentOf(
  frame: Frame,
  bounds: [number, number, number, number],
  margin: number
): Extent {
  const [west, south, east, north] = bounds;
  const northWest = toLocal(frame, { lat: north, lng: west });
  const southEast = toLocal(frame, { lat: south, lng: east });
  return {
    maxX: southEast.x + margin,
    maxZ: southEast.z + margin,
    minX: northWest.x - margin,
    minZ: northWest.z - margin,
  };
}

/** Bilinear height at a local point. */
export function sampleHeight(
  grid: LocalGrid<Float32Array>,
  x: number,
  z: number
): number {
  const fx = Math.min(
    grid.width - 1.001,
    Math.max(0, (x - grid.x) / grid.step)
  );
  const fz = Math.min(
    grid.height - 1.001,
    Math.max(0, (z - grid.z) / grid.step)
  );
  const column = Math.floor(fx);
  const row = Math.floor(fz);
  const tx = fx - column;
  const tz = fz - row;
  const at = (dc: number, dr: number) =>
    grid.data[(row + dr) * grid.width + column + dc] ?? 0;
  return (
    (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - tz) +
    (at(0, 1) * (1 - tx) + at(1, 1) * tx) * tz
  );
}
