/** Geometry ready to cross from the worker: compact, transferable arrays. */
export interface MeshData {
  /** Relative to the tile's north-west corner at sea level. */
  positions: Float32Array;
  normals: Int8Array;
  /** Linear RGB, 0–255. */
  colors: Uint8Array;
  indices: Uint32Array;
  /** Walls only: along the wall, up the wall, wall length and wall top, in decimeters. */
  facade?: Uint16Array;
  /** Per-object randomness, 0–255. */
  seeds?: Uint8Array;
  /** Texture coordinates over the tile, terrain only. */
  uvs?: Float32Array;
}

export type Rgb = readonly [number, number, number];
type Vector = readonly [number, number, number];

function toByte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

/** Collects vertices and faces; faces are wound to face their given normal. */
export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];
  private readonly facade: number[] = [];
  private readonly seeds: number[] = [];
  private readonly walls: boolean;

  constructor(walls = false) {
    this.walls = walls;
  }

  get size(): number {
    return this.positions.length / 3;
  }

  vertex(
    position: Vector,
    normal: Vector,
    color: Rgb,
    facade: Vector | readonly [number, number, number, number] = [0, 0, 0],
    seed = 0
  ): number {
    this.positions.push(position[0], position[1], position[2]);
    this.normals.push(
      Math.round(normal[0] * 127),
      Math.round(normal[1] * 127),
      Math.round(normal[2] * 127)
    );
    this.colors.push(toByte(color[0]), toByte(color[1]), toByte(color[2]));
    if (this.walls) {
      this.facade.push(
        Math.round(Math.max(0, facade[0]) * 10),
        Math.round(Math.max(0, facade[1]) * 10),
        Math.round(Math.max(0, facade[2]) * 10),
        Math.round(Math.max(0, facade[3] ?? 0) * 10)
      );
      this.seeds.push(toByte(seed));
    }
    return this.size - 1;
  }

  /** A triangle facing `normal`, whatever order its corners come in. */
  triangle(a: number, b: number, c: number, normal: Vector): void {
    const p = this.positions;
    const ax = p[a * 3] ?? 0;
    const ay = p[a * 3 + 1] ?? 0;
    const az = p[a * 3 + 2] ?? 0;
    const ux = (p[b * 3] ?? 0) - ax;
    const uy = (p[b * 3 + 1] ?? 0) - ay;
    const uz = (p[b * 3 + 2] ?? 0) - az;
    const vx = (p[c * 3] ?? 0) - ax;
    const vy = (p[c * 3 + 1] ?? 0) - ay;
    const vz = (p[c * 3 + 2] ?? 0) - az;
    const facing =
      (uy * vz - uz * vy) * normal[0] +
      (uz * vx - ux * vz) * normal[1] +
      (ux * vy - uy * vx) * normal[2];
    if (facing >= 0) {
      this.indices.push(a, b, c);
    } else {
      this.indices.push(a, c, b);
    }
  }

  /** Corners in order around the quad. */
  quad(a: number, b: number, c: number, d: number, normal: Vector): void {
    this.triangle(a, b, c, normal);
    this.triangle(a, c, d, normal);
  }

  /** Raw indices whose winding is already right. */
  raw(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  build(): MeshData | undefined {
    if (this.indices.length === 0) {
      return undefined;
    }
    return {
      colors: Uint8Array.from(this.colors),
      facade: this.walls ? Uint16Array.from(this.facade) : undefined,
      indices: Uint32Array.from(this.indices),
      normals: Int8Array.from(this.normals),
      positions: Float32Array.from(this.positions),
      seeds: this.walls ? Uint8Array.from(this.seeds) : undefined,
    };
  }
}

/** Every buffer of a mesh, for `postMessage`'s transfer list. */
export function buffersOf(mesh: MeshData | undefined): ArrayBuffer[] {
  if (!mesh) {
    return [];
  }
  return [
    mesh.positions,
    mesh.normals,
    mesh.colors,
    mesh.indices,
    mesh.facade,
    mesh.seeds,
    mesh.uvs,
  ].flatMap((array) => (array ? [array.buffer as ArrayBuffer] : []));
}
