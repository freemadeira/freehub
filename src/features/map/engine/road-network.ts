import type { RoadKind } from "./format.ts";
import { ROAD_KINDS } from "./format.ts";
import type { RoadGraphData } from "./protocol.ts";
import { EDGE_STRIDE, NODE_EDGE, NODE_PORTAL } from "./protocol.ts";

/** Where roads meet, end, or cross from one tile to the next. */
export interface RoadNode {
  x: number;
  z: number;
  /** The edges meeting here, each with the way that leaves the node. */
  ends: EdgeEnd[];
  /** On a tile's edge, waiting for the next tile to join up. */
  open: boolean;
  /** A tunnel mouth, where cars disappear into the hill and come out. */
  portal: boolean;
  /** At a junction: who's crossing it now, and who's coming up to it. */
  crossing: object[];
  coming: object[];
}

/** One way along an edge: `forward` runs from its start to its end. */
export interface EdgeEnd {
  edge: RoadEdge;
  forward: boolean;
}

export interface RoadEdge {
  id: number;
  from: RoadNode;
  to: RoadNode;
  /** x, y, z and the bend's speed, four floats a sample, start to end. */
  samples: Float32Array;
  /** Meters between samples. */
  step: number;
  length: number;
  kind: RoadKind;
  /** Lanes each way; none back on a one-way street. */
  lanes: [forward: number, back: number];
  width: number;
  /** Share of built-up land along it: towns are busier. */
  built: number;
  /** False once its tile has gone. */
  alive: boolean;
}

interface Piece {
  edges: RoadEdge[];
  nodes: RoadNode[];
}

/** Grid cells for finding a tile's open ends near another's. */
const CELL = 2;

function cellOf(x: number, z: number): string {
  return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
}
/** Open ends this close are the same point of the same road. */
const JOIN = 1;

/**
 * The car roads of the tiles in play as one graph: each tile brings its own,
 * joined to its neighbours' where roads cross the edge between them.
 */
export class RoadNetwork {
  readonly edges = new Set<RoadEdge>();
  private readonly pieces = new Map<string, Piece>();
  private readonly open = new Map<string, RoadNode[]>();
  private nextId = 0;

  has(key: string): boolean {
    return this.pieces.has(key);
  }

  keys(): IterableIterator<string> {
    return this.pieces.keys();
  }

  /** An open end of another tile at this point, if there is one. */
  private openAt(x: number, z: number): RoadNode | undefined {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const node of this.open.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (Math.hypot(node.x - x, node.z - z) < JOIN) {
            return node;
          }
        }
      }
    }
    return undefined;
  }

  /** Brings in a tile's roads, joined to the tiles already in. */
  add(key: string, data: RoadGraphData): RoadEdge[] {
    if (this.pieces.has(key)) {
      return [];
    }
    const nodes: RoadNode[] = [];
    for (let index = 0; index < data.nodes.length / 3; index += 1) {
      const x = data.nodes[index * 3] ?? 0;
      const z = data.nodes[index * 3 + 1] ?? 0;
      const flags = data.nodes[index * 3 + 2] ?? 0;
      const open = flags === NODE_EDGE;
      const shared = open ? this.openAt(x, z) : undefined;
      if (shared) {
        nodes.push(shared);
        continue;
      }
      const node: RoadNode = {
        coming: [],
        crossing: [],
        ends: [],
        open,
        portal: flags === NODE_PORTAL,
        x,
        z,
      };
      if (open) {
        const cell = cellOf(x, z);
        this.open.set(cell, [...(this.open.get(cell) ?? []), node]);
      }
      nodes.push(node);
    }
    const edges: RoadEdge[] = [];
    for (let index = 0; index < data.edges.length / EDGE_STRIDE; index += 1) {
      const at = (offset: number) =>
        data.edges[index * EDGE_STRIDE + offset] ?? 0;
      const from = nodes[at(0)] as RoadNode;
      const to = nodes[at(1)] as RoadNode;
      const first = at(2);
      const count = at(3);
      const length = at(4);
      const edge: RoadEdge = {
        alive: true,
        built: at(9),
        from,
        id: this.nextId,
        kind: ROAD_KINDS[at(5)] ?? "residential",
        lanes: [at(6), at(7)],
        length,
        samples: data.samples.subarray(first * 4, (first + count) * 4),
        step: length / Math.max(1, count - 1),
        to,
        width: at(8),
      };
      this.nextId += 1;
      from.ends.push({ edge, forward: true });
      to.ends.push({ edge, forward: false });
      this.edges.add(edge);
      edges.push(edge);
    }
    this.pieces.set(key, { edges, nodes: [...new Set(nodes)] });
    return edges;
  }

  /** Takes a tile's roads out; its open ends stay for the tiles around. */
  remove(key: string): void {
    const piece = this.pieces.get(key);
    if (!piece) {
      return;
    }
    this.pieces.delete(key);
    const gone = new Set(piece.edges);
    for (const edge of piece.edges) {
      edge.alive = false;
      this.edges.delete(edge);
    }
    for (const node of piece.nodes) {
      node.ends = node.ends.filter((end) => !gone.has(end.edge));
      if (node.open && node.ends.length === 0) {
        const cell = cellOf(node.x, node.z);
        const list = (this.open.get(cell) ?? []).filter(
          (other) => other !== node
        );
        if (list.length > 0) {
          this.open.set(cell, list);
        } else {
          this.open.delete(cell);
        }
      }
    }
  }
}

/** Where along an edge, at a lane's offset, a car is: written to `out`. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  /** Direction of travel: 0 to the south (+z), growing towards the east. */
  heading: number;
  /** Nose up, in radians. */
  pitch: number;
}

/**
 * The point `s` meters along an edge the way a car travels it, `right`
 * meters to the right of the middle.
 */
export function placeOn(
  edge: RoadEdge,
  forward: boolean,
  s: number,
  right: number,
  out: Placement
): Placement {
  const { samples, step, length } = edge;
  const u = Math.min(length, Math.max(0, forward ? s : length - s));
  const count = samples.length / 4;
  const f = Math.min(count - 1.0001, u / step);
  const index = Math.floor(f);
  const t = f - index;
  const a = index * 4;
  const b = a + 4;
  const ax = samples[a] ?? 0;
  const ay = samples[a + 1] ?? 0;
  const az = samples[a + 2] ?? 0;
  const bx = samples[b] ?? ax;
  const by = samples[b + 1] ?? ay;
  const bz = samples[b + 2] ?? az;
  let dx = bx - ax;
  let dz = bz - az;
  let dy = by - ay;
  if (!forward) {
    dx = -dx;
    dz = -dz;
    dy = -dy;
  }
  // oxlint-disable-next-line unicorn/prefer-modern-math-apis -- hypot is ten times slower, and this runs for every car every frame
  const flat = Math.sqrt(dx * dx + dz * dz) || 1;
  // Right of travel, with +z south: (-dz, dx).
  out.x = ax + (bx - ax) * t + (-dz / flat) * right;
  out.z = az + (bz - az) * t + (dx / flat) * right;
  out.y = ay + (by - ay) * t;
  out.heading = Math.atan2(dx, dz);
  out.pitch = Math.atan2(dy, flat);
  return out;
}

/** The speed a bend allows `s` meters along, the way a car travels. */
export function bendSpeed(edge: RoadEdge, forward: boolean, s: number): number {
  const u = Math.min(edge.length, Math.max(0, forward ? s : edge.length - s));
  const count = edge.samples.length / 4;
  const index = Math.min(count - 1, Math.round(u / edge.step));
  return edge.samples[index * 4 + 3] ?? 40;
}

/** Meters right of the road's middle a lane runs, the way it's driven. */
export function laneOffset(
  edge: RoadEdge,
  forward: boolean,
  lane: number
): number {
  const [ahead, back] = edge.lanes;
  const lanes = forward ? ahead : back;
  if (back === 0) {
    const width = edge.width / Math.max(1, ahead);
    return edge.width / 2 - (lane + 0.5) * width;
  }
  const width = edge.width / Math.max(1, ahead + back);
  return (lanes - lane - 0.5) * width;
}
