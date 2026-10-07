import type { RoadKind } from "../format.ts";
import type { Point, Square } from "../geo.ts";
import { ROAD_WIDTH } from "./ground.ts";
import { clipToSquare, densify } from "./roads.ts";
import type { Surface } from "./terrain.ts";
import type { Line } from "./vector.ts";

/** Names painted on the road, like a street sign laid flat. */
export interface StreetLabels {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** The names, one per row, white on clear. */
  atlas: ImageBitmap;
}

const NAMED = new Set<RoadKind>([
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "pedestrian",
]);
const ATLAS_WIDTH = 1024;
const ATLAS_HEIGHT = 512;
const ROW = 40;
const FONT =
  "800 33px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
/** Painted just above the asphalt and its lines. */
const LIFT = 0.3;
const STEP = 1.5;

function lengthsOf(points: Point[]): number[] {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] ?? { x: 0, z: 0 };
    const b = points[index] ?? { x: 0, z: 0 };
    lengths.push((lengths.at(-1) ?? 0) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return lengths;
}

/** The point and direction at a distance along a path. */
function along(points: Point[], lengths: number[], at: number) {
  let index = 1;
  while (index < points.length - 1 && (lengths[index] ?? 0) < at) {
    index += 1;
  }
  const a = points[index - 1] ?? { x: 0, z: 0 };
  const b = points[index] ?? a;
  const span = (lengths[index] ?? 0) - (lengths[index - 1] ?? 0) || 1;
  const t = Math.min(1, Math.max(0, (at - (lengths[index - 1] ?? 0)) / span));
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  return {
    dx: dx / length,
    dz: dz / length,
    x: a.x + dx * t,
    z: a.z + dz * t,
  };
}

/**
 * One name per street per tile, centered on the longest piece that fits it,
 * turned so it reads left to right with north up.
 */
export function buildStreetLabels(
  roads: Line[],
  square: Square,
  surface: Surface
): StreetLabels | undefined {
  const canvas = new OffscreenCanvas(ATLAS_WIDTH, ATLAS_HEIGHT);
  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }
  context.font = FONT;
  context.fillStyle = "rgba(255, 255, 255, 0.96)";
  // A soft edge keeps white letters readable on pale asphalt.
  context.strokeStyle = "rgba(72, 82, 108, 0.32)";
  context.lineWidth = 5;
  context.lineJoin = "round";
  context.textBaseline = "middle";
  context.letterSpacing = "2px";

  // The longest piece of each named street in this tile.
  const streets = new Map<
    string,
    { points: Point[]; width: number; length: number }
  >();
  for (const road of roads) {
    const kind = String(road.properties.kind) as RoadKind;
    const { name } = road.properties;
    if (
      typeof name !== "string" ||
      !NAMED.has(kind) ||
      road.properties.bridge === 1
    ) {
      continue;
    }
    for (const piece of clipToSquare(road.points, square)) {
      const points = densify(piece, STEP);
      const length = lengthsOf(points).at(-1) ?? 0;
      const best = streets.get(name);
      if (!best || length > best.length) {
        streets.set(name, { length, points, width: ROAD_WIDTH[kind] });
      }
    }
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let row = 0;
  for (const [name, street] of streets) {
    if ((row + 1) * ROW > ATLAS_HEIGHT) {
      break;
    }
    const text = name.toLocaleUpperCase("pt-PT");
    const textWidth = Math.ceil(context.measureText(text).width) + 8;
    if (textWidth > ATLAS_WIDTH) {
      continue;
    }
    const height = Math.min(4.6, street.width * 0.74);
    const length = (textWidth / ROW) * height;
    if (street.length < length + 6) {
      continue;
    }
    // Read west to east; a street running the other way is walked backward.
    let { points } = street;
    const first = points[0] ?? { x: 0, z: 0 };
    const last = points.at(-1) ?? first;
    if (last.x < first.x) {
      points = points.toReversed();
    }
    const lengths = lengthsOf(points);
    const start = (street.length - length) / 2;
    context.strokeText(text, 4, row * ROW + ROW / 2);
    context.fillText(text, 4, row * ROW + ROW / 2);
    const v0 = (row * ROW) / ATLAS_HEIGHT;
    const v1 = ((row + 1) * ROW) / ATLAS_HEIGHT;
    const steps = Math.max(2, Math.ceil(length / STEP));
    const base = positions.length / 3;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const point = along(points, lengths, start + t * length);
      // Left of travel is the top of the letters.
      const lx = point.dz;
      const lz = -point.dx;
      const y = surface.height(point.x, point.z) + LIFT;
      const u = (t * textWidth) / ATLAS_WIDTH;
      positions.push(
        point.x + (lx * height) / 2 - square.x,
        y,
        point.z + (lz * height) / 2 - square.z,
        point.x - (lx * height) / 2 - square.x,
        y,
        point.z - (lz * height) / 2 - square.z
      );
      uvs.push(u, v0, u, v1);
      if (step > 0) {
        const top = base + step * 2;
        indices.push(top - 2, top - 1, top, top - 1, top + 1, top);
      }
    }
    row += 1;
  }
  if (indices.length === 0) {
    return undefined;
  }
  return {
    atlas: canvas.transferToImageBitmap(),
    indices: Uint32Array.from(indices),
    positions: Float32Array.from(positions),
    uvs: Float32Array.from(uvs),
  };
}
