import type { Square } from "../geo.ts";
import type { HeightField } from "../heights.ts";
import { LOWEST_LAND, SEA_FLOOR } from "../heights.ts";
import type { CoastDistance } from "./coast.ts";

export interface TerrainData {
  /** Relative to the tile's north-west corner. */
  positions: Float32Array;
  normals: Int8Array;
  uvs: Float32Array;
  indices: Uint32Array;
  minHeight: number;
  maxHeight: number;
}

/** The terrain as drawn: flat triangles between the grid's vertices. */
export interface Surface {
  height: (x: number, z: number) => number;
}

/** Heights between the vertices, split into triangles the way the mesh is. */
function surfaceOf(
  heights: Float32Array,
  square: Square,
  segments: number
): Surface {
  const side = segments + 1;
  const cell = square.size / segments;
  const at = (i: number, j: number) => heights[j * side + i] ?? 0;
  return {
    height(x, z) {
      const u = Math.min(segments, Math.max(0, (x - square.x) / cell));
      const w = Math.min(segments, Math.max(0, (z - square.z) / cell));
      const i = Math.min(segments - 1, Math.floor(u));
      const j = Math.min(segments - 1, Math.floor(w));
      const fu = u - i;
      const fw = w - j;
      const h00 = at(i, j);
      const h10 = at(i + 1, j);
      const h01 = at(i, j + 1);
      const h11 = at(i + 1, j + 1);
      return fu >= fw
        ? h00 + fu * (h10 - h00) + fw * (h11 - h10)
        : h00 + fw * (h01 - h00) + fu * (h11 - h01);
    },
  };
}

/**
 * Heights near OSM's coast. Within `reach` of it, on either side, the ground
 * rises with the distance at a single slope, so the water's edge on every cell
 * that crosses the coast lands where the coast is, rather than stepping along
 * the grid. The slope comes from the ground a little inland, which keeps
 * cliffs falling straight into the sea; the sea floor under them is never seen.
 */
function shoreOf(
  field: HeightField,
  coast: CoastDistance,
  cell: number
): (x: number, z: number) => number {
  // A cell's diagonal is the longest edge that can cross the coast.
  const reach = cell * 1.5;
  const inland = reach * 2;
  const step = cell / 2;
  // The water reaches a little past the coast, so its surf covers the seam.
  const overlap = cell / 4;
  const ground = (x: number, z: number) =>
    Math.max(LOWEST_LAND, field.sample(x, z));
  return (x, z) => {
    const distance = coast(x, z) - overlap;
    if (distance >= inland) {
      return ground(x, z);
    }
    if (distance < -reach) {
      return SEA_FLOOR;
    }
    const east = coast(x + step, z) - coast(x - step, z);
    const south = coast(x, z + step) - coast(x, z - step);
    const length = Math.hypot(east, south) || 1;
    const ahead = (inland - distance) / length;
    const slope = Math.max(
      LOWEST_LAND / reach,
      ground(x + east * ahead, z + south * ahead) / inland
    );
    if (distance <= reach) {
      return distance * slope;
    }
    const blend = (distance - reach) / (inland - reach);
    return reach * slope + (ground(x, z) - reach * slope) * blend;
  };
}

/** The grid's border, clockwise seen from above. */
function borderOf(segments: number): number[] {
  const side = segments + 1;
  const border: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    border.push(i);
  }
  for (let j = 0; j < segments; j += 1) {
    border.push(j * side + segments);
  }
  for (let i = segments; i > 0; i -= 1) {
    border.push(segments * side + i);
  }
  for (let j = segments; j > 0; j -= 1) {
    border.push(j * side);
  }
  return border;
}

/** Copies each border vertex, `depth` lower, after the grid's own vertices. */
function hangSkirt(
  data: Pick<TerrainData, "positions" | "normals" | "uvs">,
  border: number[],
  first: number,
  depth: number
) {
  const { positions, normals, uvs } = data;
  for (const [index, top] of border.entries()) {
    const vertex = first + index;
    positions.copyWithin(vertex * 3, top * 3, top * 3 + 3);
    normals.copyWithin(vertex * 3, top * 3, top * 3 + 3);
    uvs.copyWithin(vertex * 2, top * 2, top * 2 + 2);
    positions[vertex * 3 + 1] = (positions[vertex * 3 + 1] ?? 0) - depth;
  }
}

function indicesOf(segments: number, border: number[]): Uint32Array {
  const side = segments + 1;
  const indices = new Uint32Array(segments * segments * 6 + border.length * 6);
  let cursor = 0;
  const push = (...values: number[]) => {
    indices.set(values, cursor);
    cursor += values.length;
  };
  for (let j = 0; j < segments; j += 1) {
    for (let i = 0; i < segments; i += 1) {
      const v00 = j * side + i;
      const v10 = v00 + 1;
      const v01 = v00 + side;
      const v11 = v01 + 1;
      push(v00, v01, v11, v00, v11, v10);
    }
  }
  // The border runs clockwise seen from above, so this winding faces outward.
  for (const [index, top] of border.entries()) {
    const next = border[(index + 1) % border.length] ?? 0;
    const low = side * side + index;
    const nextLow = side * side + ((index + 1) % border.length);
    push(top, next, nextLow, top, nextLow, low);
  }
  return indices;
}

/**
 * A grid of `segments`² cells with a skirt hanging from its edges, which hides
 * the cracks between neighbouring tiles of different detail.
 */
export function buildTerrain(
  field: HeightField,
  square: Square,
  segments: number,
  /** OSM's coast, finer than the height grid's. */
  coast?: CoastDistance
): { data: TerrainData; surface: Surface } {
  const side = segments + 1;
  const cell = square.size / segments;
  const height = coast
    ? shoreOf(field, coast, cell)
    : (x: number, z: number) => field.sample(x, z);
  const sample = (i: number, j: number) =>
    height(square.x + i * cell, square.z + j * cell);
  const heights = new Float32Array(side * side);
  for (let j = 0; j < side; j += 1) {
    for (let i = 0; i < side; i += 1) {
      heights[j * side + i] = sample(i, j);
    }
  }
  // Neighbours past the edge come from the field, so seams shade alike.
  const at = (i: number, j: number) =>
    i < 0 || j < 0 || i > segments || j > segments
      ? sample(i, j)
      : (heights[j * side + i] ?? 0);

  const border = borderOf(segments);
  const vertexCount = side * side + border.length;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Int8Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let j = 0; j < side; j += 1) {
    for (let i = 0; i < side; i += 1) {
      const vertex = j * side + i;
      const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell);
      const dz = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
      const scale = 127 / Math.hypot(dx, 1, dz);
      positions.set([i * cell, at(i, j), j * cell], vertex * 3);
      normals.set(
        [Math.round(-dx * scale), Math.round(scale), Math.round(-dz * scale)],
        vertex * 3
      );
      uvs.set([i / segments, j / segments], vertex * 2);
    }
  }
  hangSkirt(
    { normals, positions, uvs },
    border,
    side * side,
    Math.max(12, cell * 2)
  );

  return {
    data: {
      indices: indicesOf(segments, border),
      maxHeight: Math.max(...heights),
      minHeight: Math.min(...heights),
      normals,
      positions,
      uvs,
    },
    surface: surfaceOf(heights, square, segments),
  };
}
