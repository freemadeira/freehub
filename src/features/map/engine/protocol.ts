import type { WorldManifest } from "./format.ts";
import type { TileId } from "./geo.ts";
import type { MeshData } from "./mesh.ts";

export interface Quality {
  /** Side of the closest tiles' ground texture, in pixels. */
  nearTexture: number;
  /** Multiplies the spacing between scattered trees. */
  treeSpacing: number;
  lamps: boolean;
}

export interface TreeBatchData {
  kind: string;
  matrices: Float32Array;
  colors: Float32Array;
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
  buildings?: MeshData;
  roads?: MeshData;
  structures?: MeshData;
  piers?: MeshData;
  trees: TreeBatchData[];
  /** x, y, z and heading per lamp. */
  lamps?: Float32Array;
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
