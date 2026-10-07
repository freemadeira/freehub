import earcut from "earcut";

import type { Point } from "../geo.ts";
import type { MeshData, Rgb } from "../mesh.ts";
import { MeshBuilder } from "../mesh.ts";
import { linear, PALETTE } from "../palette.ts";
import { generator, hash, pick } from "../random.ts";
import type { Surface } from "./terrain.ts";
import type { Area } from "./vector.ts";

export type Detail = "full" | "medium" | "simple";

const STOREY = 3.1;
const PARAPET = 0.6;
const UP = [0, 1, 0] as const;
const DOWN = [0, -1, 0] as const;

const HOUSES = new Set([
  "house",
  "detached",
  "semidetached_house",
  "bungalow",
  "terrace",
  "farm",
  "cabin",
  "residential",
  "yes",
]);
const SHEDS = new Set([
  "garage",
  "garages",
  "shed",
  "hut",
  "kiosk",
  "toilets",
  "roof",
  "carport",
  "greenhouse",
  "service",
  "storage_tank",
  "container",
]);
const PITCHED = new Set([
  "gabled",
  "hipped",
  "pyramidal",
  "half-hipped",
  "side_hipped",
]);

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function signedArea(ring: Point[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] ?? { x: 0, z: 0 };
    const b = ring[(index + 1) % ring.length] ?? { x: 0, z: 0 };
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

/** An open ring without repeated or nearly straight-through corners. */
function clean(ring: Point[]): Point[] {
  const open = ring.slice(0, -1);
  const points: Point[] = [];
  for (const point of open) {
    const last = points.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.z - last.z) > 0.2) {
      points.push(point);
    }
  }
  // Drop corners where the wall barely turns.
  return points.filter((point, index) => {
    const before = points[(index + points.length - 1) % points.length] ?? point;
    const after = points[(index + 1) % points.length] ?? point;
    const ax = point.x - before.x;
    const az = point.z - before.z;
    const bx = after.x - point.x;
    const bz = after.z - point.z;
    const cross = ax * bz - az * bx;
    const lengths = Math.hypot(ax, az) * Math.hypot(bx, bz);
    return lengths === 0 || Math.abs(cross) / lengths > 0.035;
  });
}

function pointInRing(point: Point, ring: Point[]): boolean {
  let inside = false;
  let previous = ring.at(-1) ?? point;
  for (const current of ring) {
    if (
      current.z > point.z !== previous.z > point.z &&
      point.x <
        ((previous.x - current.x) * (point.z - current.z)) /
          (previous.z - current.z) +
          current.x
    ) {
      inside = !inside;
    }
    previous = current;
  }
  return inside;
}

function edgeNormal(a: Point, b: Point): [number, number] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  return [dz / length, -dx / length];
}

/** Each edge moved by `distance` along its outward normal; negative goes inward. */
function offset(ring: Point[], distance: number): Point[] | undefined {
  const count = ring.length;
  const result: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const before = ring[(index + count - 1) % count] ?? { x: 0, z: 0 };
    const point = ring[index] ?? { x: 0, z: 0 };
    const after = ring[(index + 1) % count] ?? { x: 0, z: 0 };
    const n1 = edgeNormal(before, point);
    const n2 = edgeNormal(point, after);
    const nx = n1[0] + n2[0];
    const nz = n1[1] + n2[1];
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    // Sharp corners would spike far out; give up on those shapes.
    if (dot < -0.6) {
      return undefined;
    }
    const scale = distance / (1 + dot);
    result.push({ x: point.x + nx * scale, z: point.z + nz * scale });
  }
  const before = signedArea(ring);
  const after = signedArea(result);
  if (
    Math.sign(before) !== Math.sign(after) ||
    Math.abs(after) < Math.abs(before) * 0.3
  ) {
    return undefined;
  }
  return result;
}

interface Box {
  center: Point;
  /** Unit vector along the long side. */
  axis: [number, number];
  length: number;
  width: number;
  area: number;
}

/** The smallest box around a ring, trying each edge's direction. */
function orientedBox(ring: Point[]): Box {
  let best: Box | undefined;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] ?? { x: 0, z: 0 };
    const b = ring[(index + 1) % ring.length] ?? { x: 0, z: 0 };
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.5) {
      continue;
    }
    const ux = (b.x - a.x) / length;
    const uz = (b.z - a.z) / length;
    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (const point of ring) {
      const u = point.x * ux + point.z * uz;
      const v = -point.x * uz + point.z * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const center = { x: cu * ux - cv * uz, z: cu * uz + cv * ux };
      const along = maxU - minU;
      const across = maxV - minV;
      best =
        along >= across
          ? { area, axis: [ux, uz], center, length: along, width: across }
          : { area, axis: [-uz, ux], center, length: across, width: along };
    }
  }
  return (
    best ?? {
      area: 0,
      axis: [1, 0],
      center: ring[0] ?? { x: 0, z: 0 },
      length: 0,
      width: 0,
    }
  );
}

function boxCorners(box: Box, grow = 0): Point[] {
  const [ux, uz] = box.axis;
  const hl = box.length / 2 + grow;
  const hw = box.width / 2 + grow;
  const { x, z } = box.center;
  const corner = (su: number, sv: number) => ({
    x: x + ux * hl * su - uz * hw * sv,
    z: z + uz * hl * su + ux * hw * sv,
  });
  const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  return signedArea(corners) < 0 ? corners.toReversed() : corners;
}

interface Plan {
  levels: number;
  /** Wall height from the highest ground to the eaves. */
  walls: number;
  roof: "flat" | "hipped" | "gabled";
  windows: boolean;
}

const INDUSTRY = new Set(["industrial", "warehouse", "manufacture"]);
const WORSHIP = new Set(["church", "chapel", "cathedral"]);

/** Storeys from the footprint and kind, when OSM doesn't say. */
function guessLevels(
  kind: string,
  footprint: number,
  random: () => number
): number {
  if (INDUSTRY.has(kind)) {
    return 2;
  }
  if (WORSHIP.has(kind)) {
    return kind === "chapel" ? 2 : 4;
  }
  if (kind === "apartments" || kind === "hotel") {
    return 3 + Math.floor(random() * (footprint > 500 ? 6 : 3));
  }
  if (footprint < 45) {
    return 1;
  }
  if (footprint < 140) {
    return 1 + Math.round(random() * 1.2);
  }
  if (footprint < 450) {
    return 2 + Math.floor(random() * 2);
  }
  return 3 + Math.floor(random() * (footprint < 1500 ? 3 : 4));
}

/** OSM's roof shape, or a hipped roof on many small houses, as Madeira has. */
function roofOf(
  tag: string,
  kind: string,
  footprint: number,
  levels: number,
  random: () => number
): Plan["roof"] {
  if (PITCHED.has(tag)) {
    return tag === "gabled" ? "gabled" : "hipped";
  }
  const house =
    tag === "" && HOUSES.has(kind) && footprint < 260 && levels <= 3;
  return house && random() < 0.62 ? "hipped" : "flat";
}

function plan(building: Area, footprint: number, random: () => number): Plan {
  const kind = String(building.properties.kind ?? "yes");
  const height = numberOf(building.properties.height);
  if (SHEDS.has(kind)) {
    return {
      levels: 1,
      roof: "flat",
      walls: height ?? 2.8 + random() * 0.8,
      windows: false,
    };
  }
  const tagged = numberOf(building.properties.levels);
  const levels = Math.max(
    1,
    Math.min(40, Math.round(tagged ?? guessLevels(kind, footprint, random)))
  );
  const roof = roofOf(
    String(building.properties.roof ?? ""),
    kind,
    footprint,
    levels,
    random
  );
  let walls = height ?? levels * STOREY + 0.4;
  if (roof !== "flat" && height !== undefined) {
    walls = Math.max(2.6, height - 2);
  }
  return { levels, roof, walls, windows: walls > 3.4 };
}

interface Context {
  mesh: MeshBuilder;
  surface: Surface;
  /** The tile's north-west corner; vertices are stored relative to it. */
  originX: number;
  originZ: number;
}

function addWalls(
  context: Context,
  ring: Point[],
  base: number,
  top: number,
  color: Rgb,
  seed: number,
  windows: boolean,
  shade: boolean
) {
  const { mesh, originX, originZ } = context;
  const height = top - base;
  // A darker band at the foot reads as ambient occlusion.
  const band = shade && height > 5 ? base + 3.6 : undefined;
  const dark: Rgb = [color[0] * 0.76, color[1] * 0.76, color[2] * 0.78];
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] ?? { x: 0, z: 0 };
    const b = ring[(index + 1) % ring.length] ?? { x: 0, z: 0 };
    const [nx, nz] = edgeNormal(a, b);
    const normal = [nx, 0, nz] as const;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const facade = (u: number, y: number) =>
      [u, y - base, windows ? length : 0, height] as const;
    const ax = a.x - originX;
    const az = a.z - originZ;
    const bx = b.x - originX;
    const bz = b.z - originZ;
    const rows: [number, Rgb][] = band
      ? [
          [base, shade ? dark : color],
          [band, color],
          [top, color],
        ]
      : [
          [base, shade ? dark : color],
          [top, color],
        ];
    let previous: [number, number] | undefined;
    for (const [y, tint] of rows) {
      const left = mesh.vertex([ax, y, az], normal, tint, facade(0, y), seed);
      const right = mesh.vertex(
        [bx, y, bz],
        normal,
        tint,
        facade(length, y),
        seed
      );
      if (previous) {
        mesh.quad(previous[0], previous[1], right, left, normal);
      }
      previous = [left, right];
    }
  }
}

/** A flat polygon, holes included, at one height. */
function addCap(
  context: Context,
  rings: Point[][],
  y: number,
  color: Rgb,
  normal: readonly [number, number, number] = UP
) {
  const { mesh, originX, originZ } = context;
  const flat: number[] = [];
  const holes: number[] = [];
  const vertices: number[] = [];
  for (const [index, ring] of rings.entries()) {
    if (index > 0) {
      holes.push(flat.length / 2);
    }
    for (const point of ring) {
      flat.push(point.x, point.z);
      vertices.push(
        mesh.vertex([point.x - originX, y, point.z - originZ], normal, color)
      );
    }
  }
  const triangles = earcut(flat, holes, 2);
  for (let index = 0; index < triangles.length; index += 3) {
    mesh.triangle(
      vertices[triangles[index] ?? 0] ?? 0,
      vertices[triangles[index + 1] ?? 0] ?? 0,
      vertices[triangles[index + 2] ?? 0] ?? 0,
      normal
    );
  }
}

/** A band between two rings at two heights, like a parapet's top. */
function addRingBand(
  context: Context,
  outer: Point[],
  inner: Point[],
  outerY: number,
  innerY: number,
  color: Rgb,
  normal: readonly [number, number, number]
) {
  const { mesh, originX, originZ } = context;
  for (let index = 0; index < outer.length; index += 1) {
    const next = (index + 1) % outer.length;
    const a = outer[index] ?? { x: 0, z: 0 };
    const b = outer[next] ?? { x: 0, z: 0 };
    const c = inner[next] ?? { x: 0, z: 0 };
    const d = inner[index] ?? { x: 0, z: 0 };
    mesh.quad(
      mesh.vertex([a.x - originX, outerY, a.z - originZ], normal, color),
      mesh.vertex([b.x - originX, outerY, b.z - originZ], normal, color),
      mesh.vertex([c.x - originX, innerY, c.z - originZ], normal, color),
      mesh.vertex([d.x - originX, innerY, d.z - originZ], normal, color),
      normal
    );
  }
}

function addProps(
  context: Context,
  roof: Point[],
  y: number,
  random: () => number,
  count: number
) {
  const { mesh, originX, originZ } = context;
  const box = orientedBox(roof);
  const [ux, uz] = box.axis;
  for (
    let placed = 0, tries = 0;
    placed < count && tries < count * 6;
    tries += 1
  ) {
    const u = (random() - 0.5) * box.length * 0.8;
    const v = (random() - 0.5) * box.width * 0.8;
    const center = {
      x: box.center.x + ux * u - uz * v,
      z: box.center.z + uz * u + ux * v,
    };
    const half = 0.4 + random() * 0.7;
    const depth = 0.4 + random() * 0.6;
    const corners = [
      [-half, -depth],
      [half, -depth],
      [half, depth],
      [-half, depth],
    ].map(([cu = 0, cv = 0]) => ({
      x: center.x + ux * cu - uz * cv,
      z: center.z + uz * cu + ux * cv,
    }));
    if (!corners.every((corner) => pointInRing(corner, roof))) {
      continue;
    }
    placed += 1;
    const solar = random() < 0.3;
    const height = solar ? 0.5 : 0.5 + random() * 1.1;
    const color = linear(
      solar
        ? 0x5e_7f_b5
        : pick([PALETTE.roofProp, PALETTE.trim, 0xdf_e8_f4], random())
    );
    const ordered = signedArea(corners) < 0 ? corners.toReversed() : corners;
    for (let index = 0; index < 4; index += 1) {
      const a = ordered[index] ?? { x: 0, z: 0 };
      const b = ordered[(index + 1) % 4] ?? { x: 0, z: 0 };
      const [nx, nz] = edgeNormal(a, b);
      const normal = [nx, 0, nz] as const;
      mesh.quad(
        mesh.vertex([a.x - originX, y, a.z - originZ], normal, color),
        mesh.vertex([b.x - originX, y, b.z - originZ], normal, color),
        mesh.vertex([b.x - originX, y + height, b.z - originZ], normal, color),
        mesh.vertex([a.x - originX, y + height, a.z - originZ], normal, color),
        normal
      );
    }
    addCap(context, [ordered], y + height, color);
  }
}

type Vec3 = readonly [number, number, number];

/** A triangle's normal, turned to face up, as roof faces do. */
function upwardNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const scale = (ny < 0 ? -1 : 1) / (Math.hypot(nx, ny, nz) || 1);
  return [nx * scale, ny * scale, nz * scale];
}

/** A flat face, fanned from its first corner, facing `normal`. */
function addFace(mesh: MeshBuilder, points: Vec3[], normal: Vec3, tint: Rgb) {
  const indices = points.map((point) => mesh.vertex(point, normal, tint));
  for (let index = 1; index + 1 < indices.length; index += 1) {
    mesh.triangle(
      indices[0] ?? 0,
      indices[index] ?? 0,
      indices[index + 1] ?? 0,
      normal
    );
  }
}

function addRoofFace(mesh: MeshBuilder, points: Vec3[], tint: Rgb) {
  const [a, b, c] = points;
  if (a && b && c) {
    addFace(mesh, points, upwardNormal(a, b, c), tint);
  }
}

/** Hipped or gabled roof over a box, with a little overhang. */
function addPitchedRoof(
  context: Context,
  box: Box,
  eaves: number,
  shape: "hipped" | "gabled",
  color: Rgb,
  wall: Rgb
) {
  const { mesh, originX, originZ } = context;
  const overhang = 0.35;
  const [ux, uz] = box.axis;
  const hl = box.length / 2 + overhang;
  const hw = box.width / 2 + overhang;
  const ridge = shape === "gabled" ? hl : Math.max(0, hl - hw);
  const y = eaves - 0.15;
  const top = y + Math.min(4.5, box.width * 0.3);
  const at = (u: number, v: number, height: number): Vec3 => [
    box.center.x + ux * u - uz * v - originX,
    height,
    box.center.z + uz * u + ux * v - originZ,
  ];
  const r1 = at(-ridge, 0, top);
  const r2 = at(ridge, 0, top);
  const c1 = at(-hl, -hw, y);
  const c2 = at(hl, -hw, y);
  const c3 = at(hl, hw, y);
  const c4 = at(-hl, hw, y);
  addRoofFace(mesh, [c1, c2, r2, r1], color);
  addRoofFace(mesh, [c3, c4, r1, r2], color);
  if (shape === "hipped") {
    addRoofFace(mesh, [c2, c3, r2], color);
    addRoofFace(mesh, [c4, c1, r1], color);
    return;
  }
  // Gable ends are wall, closing the triangle under the roof.
  const end = hl - overhang;
  const side = hw - overhang;
  addFace(
    mesh,
    [at(-end, side, y), at(-end, -side, y), at(-end, 0, top - 0.1)],
    [-ux, 0, -uz],
    wall
  );
  addFace(
    mesh,
    [at(end, -side, y), at(end, side, y), at(end, 0, top - 0.1)],
    [ux, 0, uz],
    wall
  );
}

/** A white band under the eaves of taller buildings. */
function addCornice(
  context: Context,
  outer: Point[],
  eaves: number,
  trim: Rgb
) {
  const cornice = offset(outer, 0.28);
  if (!cornice) {
    return;
  }
  const y0 = eaves - 0.55;
  const y1 = eaves - 0.15;
  addRingBand(context, outer, cornice, y0, y0, trim, DOWN);
  addWalls(context, cornice, y0, y1, trim, 0, false, false);
  addRingBand(context, cornice, outer, y1, y1, trim, UP);
}

export interface BuildingOptions {
  detail: Detail;
  surface: Surface;
  originX: number;
  originZ: number;
  /** Circles kept clear for landmark models. */
  clear: { x: number; z: number; radius: number }[];
}

/** One building, measured and planned, ready to be built. */
interface Shell {
  outer: Point[];
  holes: Point[][];
  footprint: number;
  box: Box;
  roof: Plan["roof"];
  layout: Plan;
  seed: number;
  random: () => number;
  /** Bottom of the walls: a little under the lowest ground they stand on. */
  base: number;
  eaves: number;
  wall: Rgb;
}

const INDUSTRY_WALLS = [0xe8_e9_ee, 0xdf_e7_ef, 0xf1_f1_ec];

function centerOf(ring: Point[]): Point {
  let x = 0;
  let z = 0;
  for (const point of ring) {
    x += point.x / ring.length;
    z += point.z / ring.length;
  }
  return { x, z };
}

function groundRange(ring: Point[], surface: Surface): [number, number] {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const point of ring) {
    const ground = surface.height(point.x, point.z);
    low = Math.min(low, ground);
    high = Math.max(high, ground);
  }
  return [low, high];
}

/** Footprint, height and roof of a building, or nothing when it's skipped. */
function shellOf(building: Area, options: BuildingOptions): Shell | undefined {
  let outer = clean(building.rings[0] ?? []);
  if (outer.length < 3) {
    return undefined;
  }
  if (signedArea(outer) < 0) {
    outer = outer.toReversed();
  }
  const footprint = signedArea(outer);
  const center = centerOf(outer);
  const cleared = options.clear.some(
    (zone) => Math.hypot(zone.x - center.x, zone.z - center.z) < zone.radius
  );
  if (footprint < 8 || cleared) {
    return undefined;
  }
  const holes = building.rings
    .slice(1)
    .map(clean)
    .filter((ring) => ring.length >= 3)
    .map((ring) => (signedArea(ring) > 0 ? ring.toReversed() : ring));
  const seed = hash(building.id, Math.round(center.x), Math.round(center.z));
  const random = generator(seed);
  const layout = plan(building, footprint, random);
  // Pitched roofs only sit well on near-rectangles, which become exact ones.
  const box = orientedBox(outer);
  const pitched =
    layout.roof !== "flat" && holes.length === 0 && footprint / box.area >= 0.8;
  if (pitched) {
    outer = boxCorners(box);
  }
  const [low, high] = groundRange(outer, options.surface);
  const industrial = INDUSTRY.has(String(building.properties.kind));
  return {
    base: low - 0.6,
    box,
    eaves: high + layout.walls,
    footprint,
    holes,
    layout,
    outer,
    random,
    roof: pitched ? layout.roof : "flat",
    seed,
    wall: linear(pick(industrial ? INDUSTRY_WALLS : PALETTE.walls, random())),
  };
}

function addFlatBuilding(
  context: Context,
  shell: Shell,
  detail: Detail,
  windows: boolean
) {
  const { outer, holes, base, eaves, wall, seed } = shell;
  const trim = linear(PALETTE.trim);
  const inset =
    detail === "simple" || holes.length > 0 ? undefined : offset(outer, -0.35);
  if (!inset) {
    const shaded = detail !== "simple";
    for (const ring of [outer, ...holes]) {
      addWalls(context, ring, base, eaves, wall, seed, windows, shaded);
    }
    addCap(context, [outer, ...holes], eaves, linear(PALETTE.roofFlat));
    return;
  }
  // Walls rise past the roof into a parapet, capped in white.
  const top = eaves + PARAPET;
  addWalls(context, outer, base, top, wall, seed, windows, true);
  addRingBand(context, outer, inset, top, top, trim, UP);
  addWalls(context, inset.toReversed(), eaves, top, trim, 0, false, false);
  addCap(context, [inset], eaves, linear(PALETTE.roofFlat));
  if (detail !== "full") {
    return;
  }
  if (shell.layout.levels >= 3) {
    addCornice(context, outer, eaves, trim);
  }
  addProps(
    context,
    inset,
    eaves,
    shell.random,
    Math.min(5, 1 + Math.floor(shell.footprint / 120))
  );
}

/** Every building of a tile as one mesh. */
export function buildBuildings(
  buildings: Area[],
  options: BuildingOptions
): MeshData | undefined {
  const mesh = new MeshBuilder(true);
  const context: Context = {
    mesh,
    originX: options.originX,
    originZ: options.originZ,
    surface: options.surface,
  };
  const shaded = options.detail !== "simple";
  for (const building of buildings) {
    const shell = shellOf(building, options);
    if (!shell) {
      continue;
    }
    const windows = shell.layout.windows && shaded;
    if (shell.roof === "flat") {
      addFlatBuilding(context, shell, options.detail, windows);
      continue;
    }
    addWalls(
      context,
      shell.outer,
      shell.base,
      shell.eaves,
      shell.wall,
      shell.seed,
      windows,
      shaded
    );
    addPitchedRoof(
      context,
      shell.box,
      shell.eaves,
      shell.roof,
      linear(pick(PALETTE.roofTile, shell.random())),
      shell.wall
    );
  }
  return mesh.build();
}
