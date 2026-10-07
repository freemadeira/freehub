import earcut from "earcut";

import type { RoadKind } from "../format.ts";
import type { Point, Square } from "../geo.ts";
import type { MeshData, Rgb } from "../mesh.ts";
import { MeshBuilder } from "../mesh.ts";
import { linear, PALETTE } from "../palette.ts";
import { ROAD_WIDTH } from "./ground.ts";
import { deckAlong } from "./routes.ts";
import type { Surface } from "./terrain.ts";
import type { Area, Line } from "./vector.ts";

const UP = [0, 1, 0] as const;
/** Roads sit this far above the ground, plus a depth offset in the material. */
const LIFT = 0.15;
const STEP = 5;
const SIDEWALK = 1.8;
const LAMP_SPACING = 30;

const WITH_SIDEWALK = new Set<RoadKind>([
  "primary",
  "secondary",
  "tertiary",
  "residential",
]);
const CENTER_LINE = new Set<RoadKind>([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
]);
const SOLID_LINE = new Set<RoadKind>(["motorway", "trunk", "primary"]);

export interface RoadResult {
  /** Flat surfaces painted over the ground: verges, asphalt, markings. */
  surface?: MeshData;
  /** Solid parts: bridge decks, walls and pillars, piers. */
  structures?: MeshData;
  /** Street lamps: x, y, z and heading, four numbers each. */
  lamps: Float32Array;
}

export function clipToSquare(points: Point[], square: Square): Point[][] {
  const minX = square.x;
  const minZ = square.z;
  const maxX = square.x + square.size;
  const maxZ = square.z + square.size;
  const inside = (p: Point) =>
    p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ;
  const pieces: Point[][] = [];
  let current: Point[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index] ?? { x: 0, z: 0 };
    const b = points[index + 1] ?? { x: 0, z: 0 };
    // Liang–Barsky on the segment.
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    let visible = true;
    for (const [p, q] of [
      [-dx, a.x - minX],
      [dx, maxX - a.x],
      [-dz, a.z - minZ],
      [dz, maxZ - a.z],
    ] as const) {
      if (p === 0) {
        if (q < 0) {
          visible = false;
        }
        continue;
      }
      const t = q / p;
      if (p < 0) {
        t0 = Math.max(t0, t);
      } else {
        t1 = Math.min(t1, t);
      }
    }
    if (!visible || t0 > t1) {
      if (current.length > 1) {
        pieces.push(current);
      }
      current = [];
      continue;
    }
    const start = { x: a.x + dx * t0, z: a.z + dz * t0 };
    const end = { x: a.x + dx * t1, z: a.z + dz * t1 };
    if (current.length === 0) {
      current.push(start);
    }
    current.push(end);
    if (!inside(b)) {
      pieces.push(current);
      current = [];
    }
  }
  if (current.length > 1) {
    pieces.push(current);
  }
  return pieces;
}

/** Splits long segments so the ribbon can follow the ground. */
export function densify(points: Point[], step: number): Point[] {
  const result: Point[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index] ?? { x: 0, z: 0 };
    const b = points[index + 1] ?? { x: 0, z: 0 };
    const count = Math.max(
      1,
      Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step)
    );
    for (let part = 0; part < count; part += 1) {
      const t = part / count;
      result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  const last = points.at(-1);
  if (last) {
    result.push(last);
  }
  return result;
}

function onEdge(point: Point, square: Square): boolean {
  const near = 0.05;
  return (
    Math.abs(point.x - square.x) < near ||
    Math.abs(point.z - square.z) < near ||
    Math.abs(point.x - square.x - square.size) < near ||
    Math.abs(point.z - square.z - square.size) < near
  );
}

function normal(a: Point, b: Point): [number, number] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  return [dz / length, -dx / length];
}

/** Unit normals to the left of travel at each point, mitered at corners. */
function sides(points: Point[]): { x: number; z: number; miter: number }[] {
  return points.map((point, index) => {
    const before = points[index - 1];
    const after = points[index + 1];
    const incoming = before ? normal(before, point) : undefined;
    const outgoing = after ? normal(point, after) : undefined;
    const a = incoming ?? outgoing ?? [0, 0];
    const b = outgoing ?? incoming ?? [0, 0];
    const x = a[0] + b[0];
    const z = a[1] + b[1];
    const length = Math.hypot(x, z) || 1;
    const dot = (x / length) * a[0] + (z / length) * a[1];
    return {
      miter: Math.min(2, 1 / Math.max(dot, 0.5)),
      x: x / length,
      z: z / length,
    };
  });
}

interface Ribbon {
  points: Point[];
  heights: number[];
}

/** A raised deck with low walls and, where it's high, pillars. */
function bridge(
  mesh: MeshBuilder,
  path: Ribbon,
  width: number,
  deck: Rgb,
  wall: Rgb,
  pillar: Rgb,
  surface: Surface,
  ox: number,
  oz: number,
  /** Piers reach down into the water instead of standing on pillars. */
  bottom?: number
) {
  const pillars = bottom === undefined;
  const normals = sides(path.points);
  const thickness = 0.8;
  const edges = path.points.map((point, index) => {
    const side = normals[index] ?? { miter: 1, x: 0, z: 0 };
    const half = (width / 2) * side.miter;
    const y = path.heights[index] ?? 0;
    return {
      left: { x: point.x + side.x * half, z: point.z + side.z * half },
      right: { x: point.x - side.x * half, z: point.z - side.z * half },
      y,
    };
  });
  for (let index = 0; index < edges.length - 1; index += 1) {
    const a = edges[index];
    const b = edges[index + 1];
    if (!(a && b)) {
      continue;
    }
    const v = (
      p: Point,
      y: number,
      n: readonly [number, number, number],
      color: Rgb
    ) => mesh.vertex([p.x - ox, y, p.z - oz], n, color);
    mesh.quad(
      v(a.left, a.y + 0.3, UP, deck),
      v(a.right, a.y + 0.3, UP, deck),
      v(b.right, b.y + 0.3, UP, deck),
      v(b.left, b.y + 0.3, UP, deck),
      UP
    );
    // Outer faces, from under the deck to the top of the parapet; walking
    // each side forward on the left and backward on the right faces it out.
    for (const [p, yp, q, yq] of [
      [a.left, a.y, b.left, b.y],
      [b.right, b.y, a.right, a.y],
    ] as const) {
      const [nx, nz] = normal(p, q);
      const n = [nx, 0, nz] as const;
      mesh.quad(
        v(p, bottom ?? yp - thickness, n, wall),
        v(q, bottom ?? yq - thickness, n, wall),
        v(q, yq + 1.2, n, wall),
        v(p, yp + 1.2, n, wall),
        n
      );
    }
    mesh.quad(
      v(a.left, bottom ?? a.y - thickness, [0, -1, 0], wall),
      v(b.left, bottom ?? b.y - thickness, [0, -1, 0], wall),
      v(b.right, bottom ?? b.y - thickness, [0, -1, 0], wall),
      v(a.right, bottom ?? a.y - thickness, [0, -1, 0], wall),
      [0, -1, 0]
    );
  }
  if (!pillars) {
    return;
  }
  let along = 0;
  for (const [index, point] of path.points.entries()) {
    const before = path.points[index - 1];
    if (before) {
      along += Math.hypot(point.x - before.x, point.z - before.z);
    }
    const y = path.heights[index] ?? 0;
    const ground = surface.height(point.x, point.z);
    if (along < 28 || y - ground < 4) {
      continue;
    }
    along = 0;
    const half = 0.9;
    const corners = [
      { x: point.x - half, z: point.z - half },
      { x: point.x + half, z: point.z - half },
      { x: point.x + half, z: point.z + half },
      { x: point.x - half, z: point.z + half },
    ];
    for (let corner = 0; corner < 4; corner += 1) {
      const p = corners[corner] ?? point;
      const q = corners[(corner + 1) % 4] ?? point;
      const [nx, nz] = normal(p, q);
      const n = [nx, 0, nz] as const;
      mesh.quad(
        mesh.vertex([p.x - ox, ground - 1, p.z - oz], n, pillar),
        mesh.vertex([q.x - ox, ground - 1, q.z - oz], n, pillar),
        mesh.vertex([q.x - ox, y - thickness, q.z - oz], n, pillar),
        mesh.vertex([p.x - ox, y - thickness, p.z - oz], n, pillar),
        n
      );
    }
  }
}

/** Piers and breakwaters drawn as areas: a slab standing out of the sea. */
function slab(mesh: MeshBuilder, ring: Point[], ox: number, oz: number) {
  const color = linear(PALETTE.pier);
  const top = 1.6;
  const open = ring.slice(0, -1);
  if (open.length < 3) {
    return;
  }
  const coordinates: number[] = [];
  const indices: number[] = [];
  for (const point of open) {
    coordinates.push(point.x, point.z);
    indices.push(mesh.vertex([point.x - ox, top, point.z - oz], UP, color));
  }
  for (let index = 0; index < open.length; index += 1) {
    const p = open[index] ?? { x: 0, z: 0 };
    const q = open[(index + 1) % open.length] ?? { x: 0, z: 0 };
    const [nx, nz] = normal(p, q);
    const n = [nx, 0, nz] as const;
    const shade: Rgb = [color[0] * 0.85, color[1] * 0.85, color[2] * 0.85];
    mesh.quad(
      mesh.vertex([p.x - ox, -3, p.z - oz], n, shade),
      mesh.vertex([q.x - ox, -3, q.z - oz], n, shade),
      mesh.vertex([q.x - ox, top, q.z - oz], n, color),
      mesh.vertex([p.x - ox, top, p.z - oz], n, color),
      n
    );
  }
  const triangles = earcut(coordinates);
  for (let index = 0; index < triangles.length; index += 3) {
    mesh.triangle(
      indices[triangles[index] ?? 0] ?? 0,
      indices[triangles[index + 1] ?? 0] ?? 0,
      indices[triangles[index + 2] ?? 0] ?? 0,
      UP
    );
  }
}

export interface RoadOptions {
  square: Square;
  surface: Surface;
  /** Lamps only where there's a town to light. */
  lamps: boolean;
}

export function buildRoads(roads: Line[], options: RoadOptions): RoadResult {
  const { square, surface } = options;
  const ox = square.x;
  const oz = square.z;
  const flat = new MeshBuilder();
  const solid = new MeshBuilder();
  const lamps: number[] = [];

  const ribbon = (
    path: Ribbon,
    width: number,
    color: Rgb,
    lift: number,
    caps: [boolean, boolean]
  ) => {
    const normals = sides(path.points);
    let previous: [number, number] | undefined;
    for (const [index, point] of path.points.entries()) {
      const side = normals[index] ?? { miter: 1, x: 0, z: 0 };
      const half = (width / 2) * side.miter;
      const y = (path.heights[index] ?? 0) + lift;
      const left = flat.vertex(
        [point.x + side.x * half - ox, y, point.z + side.z * half - oz],
        UP,
        color
      );
      const right = flat.vertex(
        [point.x - side.x * half - ox, y, point.z - side.z * half - oz],
        UP,
        color
      );
      if (previous) {
        flat.quad(previous[0], previous[1], right, left, UP);
      }
      previous = [left, right];
    }
    // Round ends, so ways meeting at a junction merge cleanly.
    for (const [at, cap] of [
      [0, caps[0]],
      [path.points.length - 1, caps[1]],
    ] as const) {
      const point = path.points[at];
      if (!cap || !point) {
        continue;
      }
      const y = (path.heights[at] ?? 0) + lift;
      const center = flat.vertex([point.x - ox, y, point.z - oz], UP, color);
      const segments = 8;
      let last: number | undefined;
      for (let step = 0; step <= segments; step += 1) {
        const angle = (step / segments) * Math.PI * 2;
        const ring = flat.vertex(
          [
            point.x + Math.cos(angle) * (width / 2) - ox,
            y,
            point.z + Math.sin(angle) * (width / 2) - oz,
          ],
          UP,
          color
        );
        if (last !== undefined) {
          flat.triangle(center, last, ring, UP);
        }
        last = ring;
      }
    }
  };

  const dashes = (
    path: Ribbon,
    width: number,
    color: Rgb,
    dash: number,
    gap: number
  ) => {
    let along = 0;
    let piece: Point[] = [];
    let heights: number[] = [];
    const flush = () => {
      if (piece.length > 1) {
        ribbon({ heights, points: piece }, width, color, LIFT + 0.05, [
          false,
          false,
        ]);
      }
      piece = [];
      heights = [];
    };
    for (const [index, point] of path.points.entries()) {
      if (index > 0) {
        const before = path.points[index - 1] ?? point;
        along += Math.hypot(point.x - before.x, point.z - before.z);
      }
      const on = along % (dash + gap) < dash;
      if (on) {
        piece.push(point);
        heights.push(path.heights[index] ?? 0);
      } else {
        flush();
      }
    }
    flush();
  };

  const surfaceColor: Rgb = linear(PALETTE.sidewalk);
  const lineColor: Rgb = linear(PALETTE.roadLine);
  const edgeColor: Rgb = linear(PALETTE.roadEdge);
  const pillarColor: Rgb = linear(PALETTE.pillar);
  const wallColor: Rgb = linear(PALETTE.trim);

  // Two passes: everything's verge first, then asphalt and paint on top.
  const prepared = roads.flatMap((road) => {
    const kind = String(road.properties.kind) as RoadKind;
    const width =
      typeof road.properties.width === "number"
        ? road.properties.width
        : ROAD_WIDTH[kind];
    if (width === undefined) {
      return [];
    }
    const deck = deckAlong(road);
    return clipToSquare(road.points, square).map((points) => {
      const dense = densify(points, STEP);
      const heights = dense.map((point) => {
        const ground = surface.height(point.x, point.z);
        return deck ? Math.max(ground, deck(point)) : ground;
      });
      const [first] = dense;
      const last = dense.at(-1);
      return {
        bridge: deck !== undefined,
        caps: [
          first ? !onEdge(first, square) : false,
          last ? !onEdge(last, square) : false,
        ] as [boolean, boolean],
        kind,
        path: { heights, points: dense },
        width,
      };
    });
  });

  for (const road of prepared) {
    if (WITH_SIDEWALK.has(road.kind) && !road.bridge) {
      ribbon(
        road.path,
        road.width + SIDEWALK * 2,
        surfaceColor,
        LIFT - 0.02,
        road.caps
      );
    }
  }
  for (const road of prepared) {
    const color = linear(PALETTE.road[road.kind]);
    if (road.bridge) {
      bridge(
        solid,
        road.path,
        road.width,
        color,
        wallColor,
        pillarColor,
        surface,
        ox,
        oz
      );
      continue;
    }
    ribbon(road.path, road.width, color, LIFT, road.caps);
    if (CENTER_LINE.has(road.kind)) {
      if (SOLID_LINE.has(road.kind)) {
        ribbon(road.path, 0.22, lineColor, LIFT + 0.05, [false, false]);
      } else {
        dashes(road.path, 0.2, lineColor, 3, 4);
      }
    }
    if (road.kind === "motorway" || road.kind === "trunk") {
      const offset = road.width / 2 - 0.5;
      const normals = sides(road.path.points);
      for (const sign of [1, -1]) {
        ribbon(
          {
            heights: road.path.heights,
            points: road.path.points.map((point, index) => ({
              x: point.x + (normals[index]?.x ?? 0) * offset * sign,
              z: point.z + (normals[index]?.z ?? 0) * offset * sign,
            })),
          },
          0.15,
          edgeColor,
          LIFT + 0.05,
          [false, false]
        );
      }
    }
    if (options.lamps && WITH_SIDEWALK.has(road.kind)) {
      let along = LAMP_SPACING / 2;
      const normals = sides(road.path.points);
      for (const [index, point] of road.path.points.entries()) {
        const before = road.path.points[index - 1];
        if (before) {
          along += Math.hypot(point.x - before.x, point.z - before.z);
        }
        if (along >= LAMP_SPACING) {
          along -= LAMP_SPACING;
          const side = normals[index] ?? { x: 0, z: 0 };
          const reach = road.width / 2 + SIDEWALK * 0.6;
          const sign = index % 2 === 0 ? 1 : -1;
          const x = point.x + side.x * reach * sign;
          const z = point.z + side.z * reach * sign;
          lamps.push(
            x - ox,
            surface.height(x, z),
            z - oz,
            Math.atan2(-side.x * sign, -side.z * sign)
          );
        }
      }
    }
  }

  return {
    lamps: Float32Array.from(lamps),
    structures: solid.build(),
    surface: flat.build(),
  };
}

/** Piers and breakwaters, standing out of the water. */
export function buildPiers(
  piers: (Area | Line)[],
  square: Square,
  surface: Surface
): MeshData | undefined {
  const mesh = new MeshBuilder();
  const wall = linear(PALETTE.trim);
  const pillar = linear(PALETTE.pillar);
  for (const pier of piers) {
    if ("rings" in pier) {
      const ring = pier.rings[0] ?? [];
      const inside = ring.some(
        (point) =>
          point.x >= square.x &&
          point.z >= square.z &&
          point.x < square.x + square.size &&
          point.z < square.z + square.size
      );
      if (inside) {
        slab(mesh, ring, square.x, square.z);
      }
    } else {
      for (const points of clipToSquare(pier.points, square)) {
        const path = { heights: points.map(() => 1.4), points };
        bridge(
          mesh,
          path,
          5,
          linear(PALETTE.pier),
          wall,
          pillar,
          surface,
          square.x,
          square.z,
          -3
        );
      }
    }
  }
  return mesh.build();
}
