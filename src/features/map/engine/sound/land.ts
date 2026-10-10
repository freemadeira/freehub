import { loadCover } from "../cover.ts";
import type { Grid } from "../format.ts";
import { COVER } from "../format.ts";

/** Cover cells pooled into one listening cell, a side. */
const POOL = 8;

/** Kinds of ground, by how they sound. */
export const GROUND = {
  fields: 2,
  forest: 1,
  rock: 4,
  sea: 0,
  town: 3,
  water: 5,
} as const;
export const GROUNDS = 6;

const GROUND_OF: Record<number, number> = {
  [COVER.bare]: GROUND.rock,
  [COVER.built]: GROUND.town,
  [COVER.crop]: GROUND.fields,
  [COVER.forest]: GROUND.forest,
  [COVER.grass]: GROUND.fields,
  [COVER.sea]: GROUND.sea,
  [COVER.shrub]: GROUND.fields,
  [COVER.water]: GROUND.water,
  [COVER.wetland]: GROUND.water,
};

function clampTo(value: number, most: number): number {
  return Math.min(most, Math.max(0, value));
}

/**
 * The land as the ear hears it: how much of each kind of ground each pooled
 * cell holds, and how far each is from the coast.
 */
export class Land {
  private readonly shares: Float32Array;
  private readonly shore: Float32Array;
  private readonly width: number;
  private readonly height: number;
  private readonly x: number;
  private readonly z: number;
  private readonly size: number;

  constructor(classes: Uint8Array, grid: Grid) {
    this.width = Math.ceil(grid.width / POOL);
    this.height = Math.ceil(grid.height / POOL);
    this.size = grid.step * POOL;
    // Where the first pooled cell's middle is.
    this.x = grid.x + ((POOL - 1) / 2) * grid.step;
    this.z = grid.z + ((POOL - 1) / 2) * grid.step;
    const cells = this.width * this.height;
    const shares = new Float32Array(cells * GROUNDS);
    for (let row = 0; row < grid.height; row += 1) {
      const pooled = Math.floor(row / POOL) * this.width;
      for (let column = 0; column < grid.width; column += 1) {
        const ground = GROUND_OF[classes[row * grid.width + column] ?? 0] ?? 0;
        const at = (pooled + Math.floor(column / POOL)) * GROUNDS + ground;
        shares[at] = (shares[at] ?? 0) + 1;
      }
    }
    for (let cell = 0; cell < cells; cell += 1) {
      let total = 0;
      for (let ground = 0; ground < GROUNDS; ground += 1) {
        total += shares[cell * GROUNDS + ground] ?? 0;
      }
      for (let ground = 0; ground < GROUNDS; ground += 1) {
        const at = cell * GROUNDS + ground;
        shares[at] = (shares[at] ?? 0) / Math.max(1, total);
      }
    }
    this.shares = shares;
    this.shore = this.distances();
  }

  static async load(url: string, grid: Grid): Promise<Land> {
    return new Land(await loadCover(url, grid), grid);
  }

  /** Meters from each cell to the nearest one holding both sea and land. */
  private distances(): Float32Array {
    const { width, height } = this;
    const far = 1e9;
    const distance = new Float32Array(width * height).fill(far);
    for (let cell = 0; cell < distance.length; cell += 1) {
      const sea = this.shares[cell * GROUNDS + GROUND.sea] ?? 0;
      const water = this.shares[cell * GROUNDS + GROUND.water] ?? 0;
      if (sea > 0 && sea + water < 1) {
        distance[cell] = 0;
      }
    }
    const relax = (cell: number, from: number, step: number) => {
      const through = (distance[from] ?? far) + step;
      if (through < (distance[cell] ?? far)) {
        distance[cell] = through;
      }
    };
    // Two chamfer passes, down then back up: near enough for an ear.
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const cell = row * width + column;
        if (column > 0) {
          relax(cell, cell - 1, 1);
        }
        if (row > 0) {
          relax(cell, cell - width, 1);
          if (column > 0) {
            relax(cell, cell - width - 1, Math.SQRT2);
          }
          if (column < width - 1) {
            relax(cell, cell - width + 1, Math.SQRT2);
          }
        }
      }
    }
    for (let row = height - 1; row >= 0; row -= 1) {
      for (let column = width - 1; column >= 0; column -= 1) {
        const cell = row * width + column;
        if (column < width - 1) {
          relax(cell, cell + 1, 1);
        }
        if (row < height - 1) {
          relax(cell, cell + width, 1);
          if (column < width - 1) {
            relax(cell, cell + width + 1, Math.SQRT2);
          }
          if (column > 0) {
            relax(cell, cell + width - 1, Math.SQRT2);
          }
        }
      }
    }
    for (let cell = 0; cell < distance.length; cell += 1) {
      distance[cell] = (distance[cell] ?? far) * this.size;
    }
    return distance;
  }

  private cellAt(x: number, z: number): number {
    const column = Math.round((x - this.x) / this.size);
    const row = Math.round((z - this.z) / this.size);
    if (column < 0 || row < 0 || column >= this.width || row >= this.height) {
      return -1;
    }
    return row * this.width + column;
  }

  /**
   * How much of each kind of ground lies within `radius` of a point, into
   * `out` by `GROUND`; the middle counts most. Past the grid there's sea.
   */
  around(x: number, z: number, radius: number, out: Float32Array): void {
    out.fill(0);
    const steps = 9;
    let sum = 0;
    for (let i = 0; i < steps; i += 1) {
      for (let j = 0; j < steps; j += 1) {
        const dx = ((i / (steps - 1)) * 2 - 1) * radius;
        const dz = ((j / (steps - 1)) * 2 - 1) * radius;
        const weight = 1 - (dx * dx + dz * dz) / (radius * radius);
        if (weight <= 0) {
          continue;
        }
        sum += weight;
        const cell = this.cellAt(x + dx, z + dz);
        if (cell < 0) {
          out[GROUND.sea] = (out[GROUND.sea] ?? 0) + weight;
          continue;
        }
        for (let ground = 0; ground < GROUNDS; ground += 1) {
          out[ground] =
            (out[ground] ?? 0) +
            weight * (this.shares[cell * GROUNDS + ground] ?? 0);
        }
      }
    }
    for (let ground = 0; ground < GROUNDS; ground += 1) {
      out[ground] = (out[ground] ?? 0) / sum;
    }
  }

  /** Meters from a point to the coast, smooth between cells. */
  coast(x: number, z: number): number {
    const fx = clampTo((x - this.x) / this.size, this.width - 1);
    const fz = clampTo((z - this.z) / this.size, this.height - 1);
    const column = Math.min(this.width - 2, Math.floor(fx));
    const row = Math.min(this.height - 2, Math.floor(fz));
    const tx = fx - column;
    const tz = fz - row;
    const at = (c: number, r: number) =>
      this.shore[r * this.width + c] ?? Number.POSITIVE_INFINITY;
    const top = at(column, row) * (1 - tx) + at(column + 1, row) * tx;
    const bottom =
      at(column, row + 1) * (1 - tx) + at(column + 1, row + 1) * tx;
    return top * (1 - tz) + bottom * tz;
  }
}
