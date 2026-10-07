import type { Square } from "../geo.ts";
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

/**
 * The coast as a smooth signed distance over a tile and `COAST_MARGIN` cells
 * around it, from OSM's land polygons drawn a few pixels per terrain cell.
 * `data` has to hold every data tile under that margin too: land polygons
 * stop a little past their own tile, which would read as coast.
 */
export function coastOf(
  square: Square,
  data: TileFeatures[],
  cell: number
): CoastDistance | undefined {
  // Every zoom carries all the land, so a tile without any is open sea.
  if (data.every((tile) => tile.land.length === 0)) {
    return () => -FAR;
  }
  const pixel = cell / 3;
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
