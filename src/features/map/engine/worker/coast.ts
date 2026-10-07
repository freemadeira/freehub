import type { Square } from "../geo.ts";
import type { CoastMap } from "../protocol.ts";
import type { TileFeatures } from "./vector.ts";

/** Meters to OSM's coast: positive on land, negative at sea. */
export type CoastDistance = (x: number, z: number) => number;

const FAR = 1e9;

/**
 * Terrain cells the coast reaches past a tile's edge: as far as any vertex
 * looks, so neighbouring tiles agree along the edge they share.
 */
export const COAST_MARGIN = 5;

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
  z[0] = -FAR;
  z[1] = FAR;
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
      z[0] = -FAR;
      z[1] = FAR;
      k = 0;
      continue;
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
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

/** Pixel distances from every cell to the nearest cell where `target` holds. */
function distances(
  target: Uint8Array,
  size: number,
  wanted: number
): Float64Array {
  const grid = new Float64Array(size * size);
  for (let cell = 0; cell < grid.length; cell += 1) {
    grid[cell] = target[cell] === wanted ? 0 : FAR;
  }
  const f = new Float64Array(size);
  const out = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let line = 0; line < size; line += 1) {
      for (let at = 0; at < size; at += 1) {
        f[at] = grid[pass === 0 ? at * size + line : line * size + at] ?? FAR;
      }
      distance1d(f, size, out, v, z);
      for (let at = 0; at < size; at += 1) {
        grid[pass === 0 ? at * size + line : line * size + at] = out[at] ?? FAR;
      }
    }
  }
  return grid;
}

/** Pixels from the drawn coast within which distances are measured exactly. */
const EXACT = 2.5;
/** Pixels on a side of the buckets the coast's edges are sorted into. */
const BUCKET = 4;

/**
 * The edges of the land that are coast: those reaching into each data tile's
 * own square. The rest lie in its buffer, where the neighbouring tile has them
 * too, and the buffer's rim is where the polygons were cut, not coast.
 */
function coastEdges(data: TileFeatures[]): Float64Array {
  const edges: number[] = [];
  for (const { land, square } of data) {
    const right = square.x + square.size;
    const bottom = square.z + square.size;
    for (const ring of land.flatMap((polygon) => polygon.rings)) {
      for (let index = 1; index < ring.length; index += 1) {
        const a = ring[index - 1] ?? { x: 0, z: 0 };
        const b = ring[index] ?? a;
        const outside =
          Math.max(a.x, b.x) < square.x ||
          Math.min(a.x, b.x) > right ||
          Math.max(a.z, b.z) < square.z ||
          Math.min(a.z, b.z) > bottom;
        if (!outside) {
          edges.push(a.x, a.z, b.x, b.z);
        }
      }
    }
  }
  return Float64Array.from(edges);
}

function edgeDistance(
  edges: Float64Array,
  at: number,
  x: number,
  z: number
): number {
  const ax = edges[at] ?? 0;
  const az = edges[at + 1] ?? 0;
  const dx = (edges[at + 2] ?? 0) - ax;
  const dz = (edges[at + 3] ?? 0) - az;
  const length = dx * dx + dz * dz;
  const t =
    length === 0
      ? 0
      : Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / length));
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

interface Raster {
  signed: Float32Array;
  size: number;
  left: number;
  top: number;
  pixel: number;
}

/** Each edge listed in the buckets its bounds cover. */
function bucketsOf(edges: Float64Array, raster: Raster): Map<number, number[]> {
  const { left, top, pixel, size } = raster;
  const span = BUCKET * pixel;
  const count = Math.ceil(size / BUCKET);
  const index = (value: number, origin: number) =>
    Math.min(count - 1, Math.max(0, Math.floor((value - origin) / span)));
  const buckets = new Map<number, number[]>();
  for (let at = 0; at < edges.length; at += 4) {
    const ax = edges[at] ?? 0;
    const az = edges[at + 1] ?? 0;
    const bx = edges[at + 2] ?? 0;
    const bz = edges[at + 3] ?? 0;
    const rowEnd = index(Math.max(az, bz), top);
    const columnEnd = index(Math.max(ax, bx), left);
    for (let row = index(Math.min(az, bz), top); row <= rowEnd; row += 1) {
      for (
        let column = index(Math.min(ax, bx), left);
        column <= columnEnd;
        column += 1
      ) {
        const key = row * count + column;
        const list = buckets.get(key) ?? [];
        list.push(at);
        buckets.set(key, list);
      }
    }
  }
  return buckets;
}

/**
 * Pixels near the coast measure their distance to OSM's edges themselves,
 * keeping the side the drawing gave them: the drawing alone steps by pixels,
 * which would make the coast wobble as tiles change detail.
 */
function refine(raster: Raster, edges: Float64Array): void {
  const { signed, size, left, top, pixel } = raster;
  const buckets = bucketsOf(edges, raster);
  const count = Math.ceil(size / BUCKET);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const cell = row * size + column;
      const value = signed[cell] ?? 0;
      if (Math.abs(value) > EXACT * pixel) {
        continue;
      }
      const x = left + (column + 0.5) * pixel;
      const z = top + (row + 0.5) * pixel;
      const bucketRow = Math.floor(row / BUCKET);
      const bucketColumn = Math.floor(column / BUCKET);
      let best = Number.POSITIVE_INFINITY;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const list =
            buckets.get((bucketRow + dr) * count + bucketColumn + dc) ?? [];
          for (const at of list) {
            best = Math.min(best, edgeDistance(edges, at, x, z));
          }
        }
      }
      if (best <= BUCKET * pixel) {
        signed[cell] = value > 0 ? best : -best;
      }
    }
  }
}

/**
 * The coast as a smooth signed distance over a tile and `COAST_MARGIN` cells
 * around it, from OSM's land polygons drawn in `pixel`-meter pixels, a whole
 * number of them per cell. `data` has to hold every data tile under that
 * margin too: land polygons stop a little past their own tile, which would
 * read as coast.
 */
export function coastOf(
  square: Square,
  data: TileFeatures[],
  cell: number,
  pixel: number
): CoastDistance | undefined {
  // Every zoom carries all the land, so a tile without any is open sea.
  if (data.every((tile) => tile.land.length === 0)) {
    return () => -FAR;
  }
  const margin = cell * COAST_MARGIN;
  const size = Math.ceil((square.size + margin * 2) / pixel);
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return undefined;
  }
  const left = square.x - margin;
  const top = square.z - margin;
  context.setTransform(1 / pixel, 0, 0, 1 / pixel, -left / pixel, -top / pixel);
  context.beginPath();
  for (const tile of data) {
    for (const polygon of tile.land) {
      for (const ring of polygon.rings) {
        for (const [index, point] of ring.entries()) {
          if (index === 0) {
            context.moveTo(point.x, point.z);
          } else {
            context.lineTo(point.x, point.z);
          }
        }
        context.closePath();
      }
    }
  }
  context.fill();
  const alpha = context.getImageData(0, 0, size, size).data;
  const land = new Uint8Array(size * size);
  for (let cellIndex = 0; cellIndex < land.length; cellIndex += 1) {
    land[cellIndex] = (alpha[cellIndex * 4 + 3] ?? 0) > 127 ? 1 : 0;
  }
  const toSea = distances(land, size, 0);
  const toLand = distances(land, size, 1);
  // Half a pixel off each side puts zero on the edge between them.
  const signed = new Float32Array(size * size);
  for (let cellIndex = 0; cellIndex < signed.length; cellIndex += 1) {
    signed[cellIndex] =
      land[cellIndex] === 1
        ? (Math.sqrt(toSea[cellIndex] ?? 0) - 0.5) * pixel
        : -(Math.sqrt(toLand[cellIndex] ?? 0) - 0.5) * pixel;
  }
  refine({ left, pixel, signed, size, top }, coastEdges(data));
  return (x, z) => {
    const fx = Math.min(size - 1.001, Math.max(0, (x - left) / pixel - 0.5));
    const fz = Math.min(size - 1.001, Math.max(0, (z - top) / pixel - 0.5));
    const column = Math.floor(fx);
    const row = Math.floor(fz);
    const tx = fx - column;
    const tz = fz - row;
    const at = (dc: number, dr: number) =>
      signed[(row + dr) * size + column + dc] ?? 0;
    return (
      (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - tz) +
      (at(0, 1) * (1 - tx) + at(1, 1) * tx) * tz
    );
  };
}

/** Texels either side of the coast the map tells apart; past them it saturates. */
const COAST_RANGE = 4;

/**
 * The coast as a texture over the tile, `pixel` meters a texel, so the terrain
 * can draw it sharper than its own cells. A map that's all land or all sea
 * shrinks to one texel.
 */
export function coastMap(
  coast: CoastDistance,
  square: Square,
  pixel: number
): CoastMap {
  const size = Math.round(square.size / pixel);
  const step = square.size / size;
  const perMeter = 127 / (COAST_RANGE * step);
  const data = new Uint8Array(size * size);
  let uniform = true;
  for (let row = 0; row < size; row += 1) {
    const z = square.z + (row + 0.5) * step;
    for (let column = 0; column < size; column += 1) {
      const distance = coast(square.x + (column + 0.5) * step, z);
      const value = Math.round(
        Math.min(255, Math.max(0, 128 + distance * perMeter))
      );
      data[row * size + column] = value;
      uniform &&= value === data[0];
    }
  }
  const scale = 255 / perMeter;
  return uniform
    ? { data: data.slice(0, 1), scale, size: 1 }
    : { data, scale, size };
}
