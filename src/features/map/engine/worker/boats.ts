import type { Point, Square } from "../geo.ts";
import { linear } from "../palette.ts";
import type { BoatBatch } from "../protocol.ts";
import { hash } from "../random.ts";
import type { CoastDistance } from "./coast.ts";
import { clipToSquare, densify } from "./roads.ts";
import type { Surface } from "./terrain.ts";
import type { Area, Line, TileFeatures } from "./vector.ts";

/** Meters between berths along a pier, and from its middle to a boat's. */
const BERTH = 6.5;
const REACH = 7.5;
const HULLS = [0x2f_5d_9e, 0xe8_6a_5f, 0x3f_a3_8c, 0xf2_b8_3d, 0xf4_f4_f2];

function inRing(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] ?? point;
    const b = ring[j] ?? point;
    if (
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export interface BoatOptions {
  data: TileFeatures[];
  square: Square;
  surface: Surface;
  coast: CoastDistance;
  /** Multiplies how many berths are taken. */
  density: number;
}

/**
 * Boats moored stern-to along piers, bow out over the water: most berths
 * taken in marinas, a few elsewhere.
 */
export function buildBoats(options: BoatOptions): BoatBatch[] {
  const { square, surface, coast } = options;
  const marinas: Area[] = options.data
    .flatMap((tile) => tile.landuse)
    .filter((area) => area.properties.kind === "marina");
  const piers = options.data
    .flatMap((tile) => tile.piers)
    .filter(
      (pier): pier is Line =>
        "points" in pier && pier.properties.kind === "pier"
    );
  const lists = {
    motorboat: { colors: [] as number[], matrices: [] as number[] },
    sailboat: { colors: [] as number[], matrices: [] as number[] },
  };
  const placed: Point[] = [];
  for (const pier of piers) {
    for (const points of clipToSquare(pier.points, square)) {
      const dense = densify(points, BERTH);
      for (let index = 1; index < dense.length; index += 1) {
        const a = dense[index - 1] ?? { x: 0, z: 0 };
        const b = dense[index] ?? a;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz) || 1;
        for (const side of [1, -1]) {
          const nx = (dz / length) * side;
          const nz = (-dx / length) * side;
          const x = (a.x + b.x) / 2 + nx * REACH;
          const z = (a.z + b.z) / 2 + nz * REACH;
          const chance = marinas.some((area) =>
            inRing({ x, z }, area.rings[0] ?? [])
          )
            ? 0.85
            : 0.2;
          const seed = hash(x, z);
          const floats =
            coast(x, z) < -1.5 &&
            coast(x + nx * 4, z + nz * 4) < -1.5 &&
            coast(x - nx * 3.5, z - nz * 3.5) < -0.5;
          const crowded = placed.some(
            (other) => Math.hypot(other.x - x, other.z - z) < 4.5
          );
          if (!floats || crowded || seed > chance * options.density) {
            continue;
          }
          placed.push({ x, z });
          const kind = hash(seed, 2) < 0.4 ? "sailboat" : "motorboat";
          const angle = Math.atan2(nx, nz) + (hash(seed, 3) - 0.5) * 0.12;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          // Column-major, relative to the tile's corner.
          lists[kind].matrices.push(
            cos,
            0,
            -sin,
            0,
            0,
            1,
            0,
            0,
            sin,
            0,
            cos,
            0,
            x - square.x,
            Math.max(0, surface.height(x, z)),
            z - square.z,
            1
          );
          lists[kind].colors.push(
            ...linear(
              HULLS[Math.floor(hash(seed, 4) * HULLS.length)] ?? 0xf4_f4_f2
            )
          );
        }
      }
    }
  }
  return (["motorboat", "sailboat"] as const).flatMap((kind) =>
    lists[kind].colors.length > 0
      ? [
          {
            colors: Float32Array.from(lists[kind].colors),
            kind,
            matrices: Float32Array.from(lists[kind].matrices),
          },
        ]
      : []
  );
}
