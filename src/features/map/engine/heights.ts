import type { HeightGrid } from "./format.ts";

/** Below this the ground is sea floor, under the water. */
export const SEA_FLOOR = -8;
/** Land never dips lower than this, so the sea stays off it. */
export const LOWEST_LAND = 0.8;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  return (
    p1 +
    0.5 *
      t *
      (p2 -
        p0 +
        t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
  );
}

/** Reads gzipped bytes whether or not the server already unpacked them. */
export async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!gzipped) {
    return bytes;
  }
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The world's ground, smooth between the grid's samples. */
export class HeightField {
  readonly grid: HeightGrid;
  readonly data: Float32Array;

  constructor(grid: HeightGrid, data: Float32Array) {
    this.grid = grid;
    this.data = data;
  }

  static async load(grid: HeightGrid, url: string): Promise<HeightField> {
    const bytes = await fetchBytes(url);
    const deltas = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 2
    );
    const data = new Float32Array(grid.width * grid.height);
    for (let row = 0; row < grid.height; row += 1) {
      let value = 0;
      for (let column = 0; column < grid.width; column += 1) {
        const cell = row * grid.width + column;
        value += deltas[cell] ?? 0;
        data[cell] = value * grid.scale + grid.offset;
      }
    }
    return new HeightField(grid, data);
  }

  private at(column: number, row: number): number {
    const { width, height } = this.grid;
    if (column < 0 || row < 0 || column >= width || row >= height) {
      return SEA_FLOOR;
    }
    return this.data[row * width + column] ?? SEA_FLOOR;
  }

  /** Bicubic, so ground built finer than the grid stays smooth. */
  sample(x: number, z: number): number {
    const fx = (x - this.grid.x) / this.grid.step;
    const fz = (z - this.grid.z) / this.grid.step;
    const column = Math.floor(fx);
    const row = Math.floor(fz);
    const tx = fx - column;
    const tz = fz - row;
    const rows = [-1, 0, 1, 2].map((dr) =>
      catmullRom(
        this.at(column - 1, row + dr),
        this.at(column, row + dr),
        this.at(column + 1, row + dr),
        this.at(column + 2, row + dr),
        tx
      )
    );
    return catmullRom(
      rows[0] ?? 0,
      rows[1] ?? 0,
      rows[2] ?? 0,
      rows[3] ?? 0,
      tz
    );
  }

  /** Lowest and highest ground in a square, from the grid alone. */
  range(x: number, z: number, size: number): [number, number] {
    const { step } = this.grid;
    const c0 = Math.floor((x - this.grid.x) / step) - 1;
    const r0 = Math.floor((z - this.grid.z) / step) - 1;
    const c1 = Math.ceil((x + size - this.grid.x) / step) + 1;
    const r1 = Math.ceil((z + size - this.grid.z) / step) + 1;
    // Big squares only need a sparse look; the margin covers what's skipped.
    const stride = Math.max(1, Math.floor((c1 - c0) / 48));
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let row = r0; row <= r1; row += stride) {
      for (let column = c0; column <= c1; column += stride) {
        const value = this.at(column, row);
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
    return [low, high];
  }
}
