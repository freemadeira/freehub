import type { WorldManifest } from "./format.ts";
import type { TileId } from "./geo.ts";
import type { MeshData } from "./mesh.ts";

export interface Quality {
  /** Side of the closest tiles' ground texture, in pixels. */
  nearTexture: number;
  /** Multiplies the spacing between scattered trees. */
  treeSpacing: number;
  lamps: boolean;
  /** Multiply how many cars, people and moored boats there are; 0 for none. */
  cars: number;
  people: number;
  boats: number;
}

/** Texels in a row of a tile's path texture. */
export const PATH_WIDTH = 512;

/**
 * Floats per traffic slot, read as four attributes:
 * - route loop: period, spacing, phase and speed;
 * - slot: first `u` it covers, its index, direction (±1) and meters right;
 * - stretch: first path sample, its first and last `s`, route length;
 * - ends: the gap at the route's end, a code for its ends and flags, and
 *   the lane's seed.
 */
export const TRAFFIC_STRIDE = 15;

/**
 * Cars and people on a tile, moved on the GPU. Paths are sampled every two
 * meters, four floats each: x, y and z in the tile, and heading.
 */
export interface TrafficData {
  paths: Float32Array;
  rows: number;
  cars: Float32Array;
  people: Float32Array;
}

/** Moored boats of one kind: 4×4 matrices and hull tints. */
export interface BoatBatch {
  kind: "motorboat" | "sailboat";
  matrices: Float32Array;
  colors: Float32Array;
}

export interface TreeBatchData {
  kind: string;
  matrices: Float32Array;
  colors: Float32Array;
}

/**
 * Signed distance to the coast over a tile, one byte per texel, rows north to
 * south: 128 on the coast, more on land. Meters = (byte / 255 - 128 / 255) *
 * `scale`; it saturates a few texels away, where only the side matters.
 */
export interface CoastMap {
  data: Uint8Array;
  size: number;
  scale: number;
}

export interface BuiltTile {
  terrain: {
    positions: Float32Array;
    normals: Int8Array;
    uvs: Float32Array;
    indices: Uint32Array;
    minHeight: number;
    maxHeight: number;
  };
  ground: ImageBitmap;
  /** Where the terrain shows the sea instead of its ground. */
  coast?: CoastMap;
  buildings?: MeshData;
  roads?: MeshData;
  structures?: MeshData;
  piers?: MeshData;
  trees: TreeBatchData[];
  /** x, y, z and heading per lamp. */
  lamps?: Float32Array;
  traffic?: TrafficData;
  boats?: BoatBatch[];
  /** Street names painted on the road, closest tiles only. */
  labels?: {
    positions: Float32Array;
    uvs: Float32Array;
    indices: Uint32Array;
    atlas: ImageBitmap;
  };
}

export type ToWorker =
  | {
      type: "init";
      /** Absolute URL of `world.json`; the pack's files resolve from it. */
      url: string;
      manifest: WorldManifest;
      clear: { x: number; z: number; radius: number }[];
      quality: Quality;
    }
  | { type: "build"; job: number; tile: TileId };

export type FromWorker =
  | { type: "ready" }
  | { type: "built"; job: number; tile: BuiltTile }
  | { type: "failed"; job: number; error: string };
