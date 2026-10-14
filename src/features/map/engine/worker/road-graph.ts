import type { Grid, RoadKind } from "../format.ts";
import { COVER, ROAD_KINDS } from "../format.ts";
import type { Point, Square } from "../geo.ts";
import type { HeightField } from "../heights.ts";
import type { RoadGraphData } from "../protocol.ts";
import { NODE_EDGE, NODE_PORTAL } from "../protocol.ts";
import { ROAD_WIDTH } from "./ground.ts";
import { clipToSquare } from "./roads.ts";
import { deckAlong } from "./routes.ts";
import type { Surface } from "./terrain.ts";
import type { Line, Properties } from "./vector.ts";

/** Road kinds cars drive on. */
export const CAR_ROADS = new Set<RoadKind>([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "service",
]);

/** Meters between samples, at most. */
const SAMPLE = 2;
/** Cars ride this far above the road, or above a bridge's deck. */
const ROAD_LIFT = 0.15;
const DECK_LIFT = 0.3;
/** Meters a second squared cars allow sideways in a bend. */
const LATERAL = 2.6;

function keyOf(point: Point): string {
  // Data tiles quantize to a quarter meter; this matches shared nodes exactly.
  return `${Math.round(point.x * 8)},${Math.round(point.z * 8)}`;
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

/** The first point of a line some way from its start, to tell its heading. */
function inward(points: Point[]): Point {
  const [first] = points as [Point];
  return (
    points.find(
      (point) => Math.hypot(point.x - first.x, point.z - first.z) > 8
    ) ?? (points.at(-1) as Point)
  );
}

/**
 * A tunnel mouth: past the road's end the ground rises well above where the
 * road was heading. Tunnels aren't in the pack, so roads stop at them.
 */
function isPortal(tip: Point, inner: Point, field: HeightField): boolean {
  const dx = tip.x - inner.x;
  const dz = tip.z - inner.z;
  const length = Math.hypot(dx, dz);
  if (length < 1) {
    return false;
  }
  const grade =
    (field.sample(tip.x, tip.z) - field.sample(inner.x, inner.z)) / length;
  const ahead = 25;
  const x = tip.x + (dx / length) * ahead;
  const z = tip.z + (dz / length) * ahead;
  return field.sample(x, z) - (field.sample(tip.x, tip.z) + grade * ahead) > 6;
}

/** Share of built-up land under a stretch of road, from the land cover. */
function builtUnder(points: Point[], cover: Uint8Array, grid: Grid): number {
  let built = 0;
  for (const point of points) {
    const column = Math.round((point.x - grid.x) / grid.step);
    const row = Math.round((point.z - grid.z) / grid.step);
    if (
      column >= 0 &&
      row >= 0 &&
      column < grid.width &&
      row < grid.height &&
      cover[row * grid.width + column] === COVER.built
    ) {
      built += 1;
    }
  }
  return points.length > 0 ? built / points.length : 0;
}

function lengthOf(points: Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Point;
    const b = points[index] as Point;
    length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return length;
}

/** `count` points evenly along a polyline `length` long, ends included. */
function evenly(points: Point[], length: number, count: number): Point[] {
  const step = length / (count - 1);
  const result: Point[] = [];
  let segment = 1;
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const s = Math.min(length, index * step);
    let a = points[segment - 1] as Point;
    let b = points[segment] as Point;
    let span = Math.hypot(b.x - a.x, b.z - a.z);
    while (segment < points.length - 1 && start + span < s) {
      start += span;
      segment += 1;
      a = points[segment - 1] as Point;
      b = points[segment] as Point;
      span = Math.hypot(b.x - a.x, b.z - a.z);
    }
    const t = span > 0 ? Math.min(1, Math.max(0, (s - start) / span)) : 0;
    result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  return result;
}

/** How fast the bend at a sample may be taken, from the samples around it. */
function bendLimit(along: Point[], index: number): number {
  const point = along[index] as Point;
  const before = along[Math.max(0, index - 2)] as Point;
  const after = along[Math.min(along.length - 1, index + 2)] as Point;
  const a1 = Math.atan2(point.x - before.x, point.z - before.z);
  const a2 = Math.atan2(after.x - point.x, after.z - point.z);
  const turn = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
  const reach =
    Math.hypot(point.x - before.x, point.z - before.z) +
    Math.hypot(after.x - point.x, after.z - point.z);
  const curve = turn > 1e-3 && reach > 0 ? turn / (reach / 2) : 0;
  return Math.min(40, Math.max(3, curve > 0 ? Math.sqrt(LATERAL / curve) : 40));
}

/** Lanes each way and width, from the tags or the kind of road. */
function lanesOf(properties: Properties): {
  kind: RoadKind;
  forward: number;
  back: number;
  width: number;
} {
  const kind = String(properties.kind) as RoadKind;
  const oneway = properties.oneway === 1;
  const big = kind === "motorway" || kind === "trunk";
  const lanes =
    typeof properties.lanes === "number"
      ? Math.max(1, properties.lanes)
      : (oneway ? 1 : 2) * (big ? 2 : 1);
  const forward = oneway ? lanes : Math.max(1, Math.floor(lanes / 2));
  return {
    back: oneway ? 0 : forward,
    forward,
    kind,
    width:
      typeof properties.width === "number"
        ? properties.width
        : ROAD_WIDTH[kind],
  };
}

export interface RoadGraphOptions {
  /** The data tile's roads, whole as it has them. */
  roads: Line[];
  /** The tile drawn: the graph covers it, and ends where roads leave it. */
  square: Square;
  surface: Surface;
  field: HeightField;
  cover: Uint8Array;
  coverGrid: Grid;
}

interface Piece {
  line: Line;
  points: Point[];
  deck?: (point: Point) => number;
}

/** Builds up a graph's nodes, edges and samples, as flat arrays. */
class GraphWriter {
  readonly nodes: number[] = [];
  readonly edges: number[] = [];
  readonly samples: number[] = [];
  private readonly ids = new Map<string, number>();
  private readonly degree: number[] = [];
  /** A point a little way in from each node, to tell which way roads end. */
  private readonly tips = new Map<number, Point>();
  private readonly options: RoadGraphOptions;

  constructor(options: RoadGraphOptions) {
    this.options = options;
  }

  private node(point: Point, inner: Point): number {
    const key = keyOf(point);
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.nodes.length / 3;
      this.ids.set(key, id);
      this.nodes.push(point.x, point.z, 0);
      this.degree.push(0);
    }
    this.degree[id] = (this.degree[id] ?? 0) + 1;
    this.tips.set(id, inner);
    return id;
  }

  /** An edge along `points`, which run from one node to the next. */
  edge(piece: Piece, points: Point[]): void {
    const length = lengthOf(points);
    if (length < 0.05) {
      return;
    }
    const from = this.node(points[0] as Point, inward(points));
    const to = this.node(points.at(-1) as Point, inward(points.toReversed()));
    const count = Math.max(2, Math.ceil(length / SAMPLE) + 1);
    const first = this.samples.length / 4;
    const along = evenly(points, length, count);
    const { surface } = this.options;
    for (const [index, point] of along.entries()) {
      const ground = surface.height(point.x, point.z);
      const deck = piece.deck?.(point);
      const y =
        deck === undefined
          ? ground + ROAD_LIFT
          : Math.max(ground, deck) + DECK_LIFT;
      this.samples.push(point.x, y, point.z, bendLimit(along, index));
    }
    const { back, forward, kind, width } = lanesOf(piece.line.properties);
    this.edges.push(
      from,
      to,
      first,
      count,
      length,
      ROAD_KINDS.indexOf(kind),
      forward,
      back,
      width,
      builtUnder(along, this.options.cover, this.options.coverGrid)
    );
  }

  /** Marks where roads leave the tile, and where they end at a tunnel. */
  flag(): void {
    const { square, field } = this.options;
    for (let id = 0; id < this.nodes.length / 3; id += 1) {
      const point = {
        x: this.nodes[id * 3] ?? 0,
        z: this.nodes[id * 3 + 1] ?? 0,
      };
      const inner = this.tips.get(id);
      if (onEdge(point, square)) {
        this.nodes[id * 3 + 2] = NODE_EDGE;
      } else if (
        this.degree[id] === 1 &&
        inner &&
        isPortal(point, inner, field)
      ) {
        this.nodes[id * 3 + 2] = NODE_PORTAL;
      }
    }
  }
}

/** The tile's stretches of car road, each with its bridge deck if any. */
function piecesOf(options: RoadGraphOptions): Piece[] {
  const pieces: Piece[] = [];
  for (const line of options.roads) {
    if (CAR_ROADS.has(String(line.properties.kind) as RoadKind)) {
      const deck = deckAlong(line);
      for (const points of clipToSquare(line.points, options.square)) {
        if (points.length > 1) {
          pieces.push({ deck, line, points });
        }
      }
    }
  }
  return pieces;
}

/**
 * The car roads of a tile as a graph: nodes at junctions, dead ends and
 * where roads cross the tile's edge, so the main thread can join tiles up;
 * edges sampled every couple of meters, at the height the road is drawn.
 */
export function buildRoadGraph(
  options: RoadGraphOptions
): RoadGraphData | undefined {
  const pieces = piecesOf(options);
  // A node wherever pieces end or share a point.
  const uses = new Map<string, number>();
  for (const piece of pieces) {
    for (const point of piece.points) {
      const key = keyOf(point);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const writer = new GraphWriter(options);
  for (const piece of pieces) {
    const { points } = piece;
    let start = 0;
    for (let index = 1; index < points.length; index += 1) {
      const last = index === points.length - 1;
      if (last || (uses.get(keyOf(points[index] as Point)) ?? 0) > 1) {
        writer.edge(piece, points.slice(start, index + 1));
        start = index;
      }
    }
  }
  if (writer.edges.length === 0) {
    return undefined;
  }
  writer.flag();
  return {
    edges: Float32Array.from(writer.edges),
    nodes: Float32Array.from(writer.nodes),
    samples: Float32Array.from(writer.samples),
  };
}
