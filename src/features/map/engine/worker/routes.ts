import type { Point, Square } from "../geo.ts";
import type { HeightField } from "../heights.ts";
import type { Line, Properties } from "./vector.ts";

/**
 * How traffic behaves at the end of a route: turning back at a dead end,
 * fading into the road it meets, sinking into a tunnel, or nothing at all
 * where the data tile cut it, out of sight.
 */
export const END = { cut: 3, fade: 1, sink: 2, turn: 0 } as const;
export type End = (typeof END)[keyof typeof END];

/** Ways chained end to end where they carry on, with distances along them. */
export interface Route {
  points: Point[];
  /** Meters from the start at each point. */
  along: number[];
  /** Deck height at each point on a bridge, `NaN` off bridges. */
  decks: number[];
  /** The first way's tags stand for the route. */
  properties: Properties;
  ends: [start: End, end: End];
  /** Loops back on itself, so it has no ends. */
  closed: boolean;
}

interface Way {
  line: Line;
  decks: number[];
}

interface Tip {
  way: number;
  /** 0 for the way's first point, 1 for its last. */
  side: 0 | 1;
}

function keyOf(point: Point): string {
  // Data tiles quantize to a quarter meter at the detail zoom; this matches
  // shared nodes exactly and nothing else.
  return `${Math.round(point.x * 8)},${Math.round(point.z * 8)}`;
}

function decksOf(line: Line): number[] {
  const e0 = Number(line.properties.e0);
  const e1 = Number(line.properties.e1);
  if (
    line.properties.bridge !== 1 ||
    !Number.isFinite(e0) ||
    !Number.isFinite(e1)
  ) {
    return line.points.map(() => Number.NaN);
  }
  let total = 0;
  const lengths = line.points.map((point, index) => {
    const before = line.points[index - 1];
    total += before ? Math.hypot(point.x - before.x, point.z - before.z) : 0;
    return total;
  });
  return lengths.map((length) => e0 + ((e1 - e0) * length) / (total || 1));
}

/**
 * A bridge's deck height anywhere along it, measured along the whole way
 * as the data tile has it, so tiles that cut it agree; nothing off bridges.
 */
export function deckAlong(line: Line): ((point: Point) => number) | undefined {
  const decks = decksOf(line);
  if (!decks.some(Number.isFinite)) {
    return undefined;
  }
  const { points } = line;
  return (point) => {
    let best = Number.POSITIVE_INFINITY;
    let deck = decks[0] ?? 0;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1] ?? point;
      const b = points[index] ?? a;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = dx * dx + dz * dz;
      const t =
        length === 0
          ? 0
          : Math.min(
              1,
              Math.max(
                0,
                ((point.x - a.x) * dx + (point.z - a.z) * dz) / length
              )
            );
      const distance = Math.hypot(
        a.x + dx * t - point.x,
        a.z + dz * t - point.z
      );
      if (distance < best) {
        best = distance;
        const da = decks[index - 1] ?? 0;
        deck = da + ((decks[index] ?? da) - da) * t;
      }
    }
    return deck;
  };
}

/** The direction a way leaves its tip in, as a unit vector. */
function leaving(way: Way, side: 0 | 1): Point {
  const { points } = way.line;
  const tip = side === 0 ? points[0] : points.at(-1);
  const next = side === 0 ? points[1] : points.at(-2);
  const dx = (next?.x ?? 0) - (tip?.x ?? 0);
  const dz = (next?.z ?? 0) - (tip?.z ?? 0);
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

/** Whether traffic may go from one way's tip straight on into another's. */
function joinable(ways: Way[], a: Tip, b: Tip): boolean {
  const oneway = ways[a.way]?.line.properties.oneway === 1;
  // One-way traffic arrives at a way's last point and leaves from a first.
  if (oneway && a.side === b.side) {
    return false;
  }
  const da = leaving(ways[a.way] as Way, a.side);
  const db = leaving(ways[b.way] as Way, b.side);
  // Close to straight on: no sharper than about 60°.
  return da.x * db.x + da.z * db.z < -0.5;
}

/** At each node, pairs the ways that carry on straightest through it. */
function pairTips(ways: Way[], tips: Tip[]): Map<string, Tip> {
  const pairs = new Map<string, Tip>();
  const left = [...tips];
  while (left.length > 1) {
    let best: [number, number] | undefined;
    let straightest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < left.length; i += 1) {
      for (let j = i + 1; j < left.length; j += 1) {
        const a = left[i] as Tip;
        const b = left[j] as Tip;
        if (a.way === b.way || !joinable(ways, a, b)) {
          continue;
        }
        const da = leaving(ways[a.way] as Way, a.side);
        const db = leaving(ways[b.way] as Way, b.side);
        const dot = da.x * db.x + da.z * db.z;
        if (dot < straightest) {
          straightest = dot;
          best = [i, j];
        }
      }
    }
    if (!best) {
      break;
    }
    const a = left[best[0]] as Tip;
    const b = left[best[1]] as Tip;
    pairs.set(`${a.way}:${a.side}`, b);
    pairs.set(`${b.way}:${b.side}`, a);
    left.splice(best[1], 1);
    left.splice(best[0], 1);
  }
  return pairs;
}

interface Chain {
  /** Ways in order, each with the side it's entered from. */
  steps: Tip[];
  closed: boolean;
}

function walk(
  start: Tip,
  pairs: Map<string, Tip>,
  used: Set<number>
): Chain | undefined {
  const steps: Tip[] = [];
  let tip: Tip | undefined = start;
  while (tip && !used.has(tip.way)) {
    used.add(tip.way);
    steps.push(tip);
    const exit: 0 | 1 = tip.side === 0 ? 1 : 0;
    tip = pairs.get(`${tip.way}:${exit}`);
  }
  if (steps.length === 0) {
    return undefined;
  }
  return { closed: tip !== undefined && tip.way === start.way, steps };
}

/** Chains ways into routes, starting where nothing leads in. */
function chainsOf(ways: Way[], pairs: Map<string, Tip>): Chain[] {
  const used = new Set<number>();
  const chains: Chain[] = [];
  const heads: Tip[] = [];
  for (const [index, way] of ways.entries()) {
    const oneway = way.line.properties.oneway === 1;
    for (const side of [0, 1] as const) {
      // One-way chains only start at a first point.
      if (!pairs.has(`${index}:${side}`) && !(oneway && side === 1)) {
        heads.push({ side, way: index });
      }
    }
  }
  for (const head of heads) {
    const chain = walk(head, pairs, used);
    if (chain) {
      chains.push(chain);
    }
  }
  // What's left goes round in loops.
  for (const index of ways.keys()) {
    const chain = walk({ side: 0, way: index }, pairs, used);
    if (chain) {
      chains.push(chain);
    }
  }
  return chains;
}

function routeOf(ways: Way[], chain: Chain): Route {
  const points: Point[] = [];
  const decks: number[] = [];
  for (const step of chain.steps) {
    const way = ways[step.way] as Way;
    const forward = step.side === 0;
    const wayPoints = forward ? way.line.points : way.line.points.toReversed();
    const wayDecks = forward ? way.decks : way.decks.toReversed();
    // Chained ways share their meeting point.
    const skip = points.length > 0 ? 1 : 0;
    points.push(...wayPoints.slice(skip));
    decks.push(...wayDecks.slice(skip));
  }
  let total = 0;
  const along = points.map((point, index) => {
    const before = points[index - 1];
    total += before ? Math.hypot(point.x - before.x, point.z - before.z) : 0;
    return total;
  });
  const first = ways[chain.steps[0]?.way ?? 0] as Way;
  return {
    along,
    closed: chain.closed,
    decks,
    ends: [END.cut, END.cut],
    points,
    properties: first.line.properties,
  };
}

export interface RouteOptions {
  /** The data tile the ways come from: past its own square, they're cut. */
  square: Square;
  field: HeightField;
  /** Ways that may chain into each other, like the same kind of road. */
  group: (line: Line) => string;
}

function outside(point: Point, square: Square): boolean {
  const near = 0.5;
  return (
    point.x < square.x + near ||
    point.z < square.z + near ||
    point.x > square.x + square.size - near ||
    point.z > square.z + square.size - near
  );
}

/**
 * A tunnel portal: the ground just past the end rises well above where the
 * road was heading. Roads end at portals because tunnels aren't baked.
 */
function portal(route: Route, side: 0 | 1, field: HeightField): boolean {
  const { points } = route;
  const tip = (side === 0 ? points[0] : points.at(-1)) ?? { x: 0, z: 0 };
  const back = Math.min(points.length - 1, 4);
  const inner = (side === 0 ? points[back] : points.at(-1 - back)) ?? tip;
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

function endOf(
  route: Route,
  side: 0 | 1,
  degree: Map<string, number>,
  options: RouteOptions
): End {
  const tip = (side === 0 ? route.points[0] : route.points.at(-1)) ?? {
    x: 0,
    z: 0,
  };
  if (outside(tip, options.square)) {
    return END.cut;
  }
  if (portal(route, side, options.field)) {
    return END.sink;
  }
  // Another way runs through or ends here: a junction to fade into.
  if ((degree.get(keyOf(tip)) ?? 0) > 1) {
    return END.fade;
  }
  return route.properties.oneway === 1 ? END.fade : END.turn;
}

/**
 * Chains a data tile's ways into routes: at each node, the two ways that carry
 * on straightest join, if they're the same kind and agree on one-way traffic.
 */
export function buildRoutes(lines: Line[], options: RouteOptions): Route[] {
  const ways = lines
    .filter((line) => line.points.length > 1)
    .map((line) => ({ decks: decksOf(line), line }));
  const byNode = new Map<string, Tip[]>();
  for (const [index, way] of ways.entries()) {
    const group = options.group(way.line);
    for (const side of [0, 1] as const) {
      const point = side === 0 ? way.line.points[0] : way.line.points.at(-1);
      const key = `${group}|${keyOf(point ?? { x: 0, z: 0 })}`;
      const list = byNode.get(key) ?? [];
      list.push({ side, way: index });
      byNode.set(key, list);
    }
  }
  const pairs = new Map<string, Tip>();
  for (const tips of byNode.values()) {
    for (const [key, tip] of pairTips(ways, tips)) {
      pairs.set(key, tip);
    }
  }
  // How many ways of any group touch each node, to tell junctions apart.
  const degree = new Map<string, number>();
  for (const line of lines) {
    for (const point of line.points) {
      const key = keyOf(point);
      degree.set(key, (degree.get(key) ?? 0) + 1);
    }
  }
  return chainsOf(ways, pairs).map((chain) => {
    const route = routeOf(ways, chain);
    if (!route.closed) {
      route.ends = [
        endOf(route, 0, degree, options),
        endOf(route, 1, degree, options),
      ];
    }
    return route;
  });
}

/** Stretches of a route inside a square, as distances along it. */
export function clipRoute(route: Route, square: Square): [number, number][] {
  const minX = square.x;
  const minZ = square.z;
  const maxX = square.x + square.size;
  const maxZ = square.z + square.size;
  const spans: [number, number][] = [];
  let open: number | undefined;
  let last = 0;
  for (let index = 0; index < route.points.length - 1; index += 1) {
    const a = route.points[index] ?? { x: 0, z: 0 };
    const b = route.points[index + 1] ?? a;
    const start = route.along[index] ?? 0;
    const length = (route.along[index + 1] ?? start) - start;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    let t0 = 0;
    let t1 = 1;
    let visible = true;
    for (const [p, q] of [
      [-dx, a.x - minX],
      [dx, maxX - a.x],
      [-dz, a.z - minZ],
      [dz, maxZ - a.z],
    ] as const) {
      if (p === 0) {
        visible &&= q >= 0;
      } else if (p < 0) {
        t0 = Math.max(t0, q / p);
      } else {
        t1 = Math.min(t1, q / p);
      }
    }
    if (!visible || t0 > t1) {
      if (open !== undefined) {
        spans.push([open, last]);
        open = undefined;
      }
      continue;
    }
    if (open === undefined || t0 > 0) {
      if (open !== undefined) {
        spans.push([open, last]);
      }
      open = start + length * t0;
    }
    last = start + length * t1;
    if (t1 < 1) {
      spans.push([open, last]);
      open = undefined;
    }
  }
  if (open !== undefined) {
    spans.push([open, last]);
  }
  return spans.filter(([s0, s1]) => s1 - s0 > 0.5);
}

/** Where a route is, which way it heads and how high its deck is, `s` along. */
export function routeAt(
  route: Route,
  s: number
): { x: number; z: number; dx: number; dz: number; deck: number } {
  const { along, points, decks } = route;
  const total = along.at(-1) ?? 0;
  const at = route.closed
    ? ((s % total) + total) % total
    : Math.min(total, Math.max(0, s));
  let low = 0;
  let high = along.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if ((along[middle] ?? 0) <= at) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const a = points[low] ?? { x: 0, z: 0 };
  const b = points[high] ?? a;
  const start = along[low] ?? 0;
  const length = (along[high] ?? start) - start;
  const t = length > 0 ? (at - start) / length : 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const norm = Math.hypot(dx, dz) || 1;
  const da = decks[low] ?? Number.NaN;
  const db = decks[high] ?? Number.NaN;
  return {
    deck: da + (db - da) * t,
    dx: dx / norm,
    dz: dz / norm,
    x: a.x + dx * t,
    z: a.z + dz * t,
  };
}
