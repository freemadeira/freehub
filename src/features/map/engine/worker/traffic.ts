import type { Grid, RoadKind } from "../format.ts";
import { COVER } from "../format.ts";
import type { Point, Square } from "../geo.ts";
import type { HeightField } from "../heights.ts";
import type { TrafficData } from "../protocol.ts";
import { PATH_WIDTH } from "../protocol.ts";
import { hash } from "../random.ts";
import { ROAD_WIDTH } from "./ground.ts";
import type { End, Route } from "./routes.ts";
import { buildRoutes, clipRoute, END, routeAt } from "./routes.ts";
import type { Surface } from "./terrain.ts";
import type { Area, Line, TileFeatures } from "./vector.ts";

/** Meters between path samples. */
const SAMPLE = 2;
/** Roads sit this far above the ground; bridge decks this far above theirs. */
const ROAD_LIFT = 0.15;
const DECK_LIFT = 0.3;

interface Flow {
  /** Meters between cars, or people, when the road is full. */
  spacing: number;
  /** Meters a second. */
  speed: number;
  /** How full: spacing grows as it empties. */
  fill: number;
}

/** Meters between one car and the next, on average. */
function gapOf(flow: Flow): number {
  return flow.spacing / Math.max(0.05, flow.fill);
}

const CARS: Partial<Record<RoadKind, Flow>> = {
  motorway: { fill: 0.8, spacing: 34, speed: 21 },
  primary: { fill: 0.75, spacing: 40, speed: 13 },
  residential: { fill: 0.55, spacing: 80, speed: 7 },
  secondary: { fill: 0.7, spacing: 46, speed: 12 },
  service: { fill: 0.45, spacing: 150, speed: 5 },
  tertiary: { fill: 0.65, spacing: 58, speed: 10 },
  trunk: { fill: 0.8, spacing: 36, speed: 17 },
};

const WALKS: Partial<Record<RoadKind, Flow>> = {
  footway: { fill: 0.5, spacing: 14, speed: 1.3 },
  pedestrian: { fill: 0.85, spacing: 8, speed: 1.25 },
  steps: { fill: 0.4, spacing: 14, speed: 0.9 },
};

/** Streets with sidewalks people walk along. */
const SIDEWALKS = new Set<RoadKind>([
  "primary",
  "secondary",
  "tertiary",
  "residential",
]);
const SIDEWALK: Flow = { fill: 0.45, spacing: 12, speed: 1.3 };

/** Land use that draws a crowd. */
const BUSY = new Set(["commercial", "pedestrian", "marina"]);

export interface TrafficOptions {
  /** The data tile's own square, where its routes are whole. */
  data: TileFeatures;
  square: Square;
  surface: Surface;
  field: HeightField;
  cover: Uint8Array;
  coverGrid: Grid;
  /** Multiplies how many cars and people there are; 0 leaves them out. */
  cars: number;
  people: number;
}

/** A lane traffic loops around: forward along a route, maybe back again. */
interface Lane {
  route: Route;
  /** Meters right of the direction of travel. */
  right: number;
  /** Both ways, turning or vanishing at the ends; otherwise one way. */
  twoWay: boolean;
  /** Travels from the route's end to its start. */
  reverse: boolean;
  flow: Flow;
  seed: number;
}

/** Share of built-up land along a route, from the land cover. */
function builtAlong(route: Route, options: TrafficOptions): number {
  const { cover, coverGrid } = options;
  const total = route.along.at(-1) ?? 0;
  const count = Math.max(1, Math.ceil(total / 25));
  let built = 0;
  for (let step = 0; step < count; step += 1) {
    const { x, z } = routeAt(route, ((step + 0.5) / count) * total);
    const column = Math.round((x - coverGrid.x) / coverGrid.step);
    const row = Math.round((z - coverGrid.z) / coverGrid.step);
    const inside =
      column >= 0 &&
      row >= 0 &&
      column < coverGrid.width &&
      row < coverGrid.height;
    if (inside && cover[row * coverGrid.width + column] === COVER.built) {
      built += 1;
    }
  }
  return built / count;
}

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

function busyAt(point: Point, busy: Area[]): boolean {
  return busy.some((area) => inRing(point, area.rings[0] ?? []));
}

function widthOf(line: { properties: Route["properties"] }): number {
  const kind = String(line.properties.kind) as RoadKind;
  return typeof line.properties.width === "number"
    ? line.properties.width
    : ROAD_WIDTH[kind];
}

/** Car lanes, rightmost first in each direction. */
function carLanes(route: Route, built: number, scale: number): Lane[] {
  const kind = String(route.properties.kind) as RoadKind;
  const base = CARS[kind];
  if (!base) {
    return [];
  }
  const oneway = route.properties.oneway === 1;
  const big = kind === "motorway" || kind === "trunk";
  const lanes =
    typeof route.properties.lanes === "number"
      ? Math.max(1, route.properties.lanes)
      : (oneway ? 1 : 2) * (big ? 2 : 1);
  const perSide = oneway ? lanes : Math.max(1, Math.floor(lanes / 2));
  const width = widthOf(route);
  const laneWidth = width / (oneway ? perSide : perSide * 2);
  const seed = hash(
    route.points[0]?.x ?? 0,
    route.points[0]?.z ?? 0,
    route.along.at(-1) ?? 0
  );
  const fill = base.fill * (0.4 + 0.6 * built);
  return Array.from({ length: perSide }, (_, index) => ({
    flow: {
      fill,
      spacing: base.spacing * scale,
      // Lanes further from the right run a little faster.
      speed: base.speed * (1 + 0.12 * index) * (0.9 + 0.2 * hash(seed, index)),
    },
    reverse: false,
    right: oneway
      ? width / 2 - (index + 0.5) * laneWidth
      : (perSide - index - 0.5) * laneWidth,
    route,
    seed: hash(seed, index, 7),
    twoWay: !oneway,
  }));
}

/** A closed route has no ends to turn at: each way round is its own lane. */
function splitClosed(lanes: Lane[]): Lane[] {
  return lanes.flatMap((lane) =>
    lane.route.closed && lane.twoWay
      ? [
          { ...lane, twoWay: false },
          { ...lane, reverse: true, seed: hash(lane.seed, 17), twoWay: false },
        ]
      : [lane]
  );
}

/** Lanes of people: along footways, squares and the sidewalks of streets. */
function walkLanes(
  route: Route,
  built: number,
  busy: boolean,
  scale: number
): Lane[] {
  const kind = String(route.properties.kind) as RoadKind;
  const sidewalk = SIDEWALKS.has(kind);
  const base = WALKS[kind] ?? (sidewalk ? SIDEWALK : undefined);
  if (!base) {
    return [];
  }
  const fill = Math.min(0.95, base.fill * built * (busy ? 1.8 : 1));
  if (fill < 0.03) {
    return [];
  }
  const width = widthOf(route);
  const seed = hash(route.points[0]?.x ?? 0, route.points[0]?.z ?? 0, 11);
  // Each sidewalk carries people both ways; paths split by side.
  const offsets = sidewalk
    ? [width / 2 + 0.7, -(width / 2 + 1.2)]
    : [width / 4 + 0.25, width / 8];
  return offsets.map((right, index) => ({
    flow: {
      fill,
      spacing: base.spacing * scale,
      speed: base.speed * (0.85 + 0.3 * hash(seed, index)),
    },
    reverse: false,
    right,
    route,
    seed: hash(seed, index, 13),
    twoWay: true,
  }));
}

/** Paths across a square: through its middle at a few angles, wall to wall. */
function squareRoutes(area: Area): Route[] {
  const ring = area.rings[0] ?? [];
  if (ring.length < 4) {
    return [];
  }
  const open = ring.slice(0, -1);
  const center = {
    x: open.reduce((sum, point) => sum + point.x, 0) / open.length,
    z: open.reduce((sum, point) => sum + point.z, 0) / open.length,
  };
  if (!inRing(center, ring)) {
    return [];
  }
  const turn = hash(center.x, center.z) * Math.PI;
  return [0, 1, 2].flatMap((index) => {
    const angle = turn + (index * Math.PI) / 3;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    let before = Number.NEGATIVE_INFINITY;
    let after = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const a = ring[i] ?? center;
      const b = ring[i + 1] ?? center;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const det = dx * -ez + dz * ex;
      if (Math.abs(det) < 1e-9) {
        continue;
      }
      const wx = a.x - center.x;
      const wz = a.z - center.z;
      const t = (wx * -ez + wz * ex) / det;
      const along = (dx * wz - dz * wx) / det;
      if (along >= 0 && along <= 1) {
        before = t < 0 ? Math.max(before, t) : before;
        after = t >= 0 ? Math.min(after, t) : after;
      }
    }
    const start = before + 2;
    const end = after - 2;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 8) {
      return [];
    }
    const points = [
      { x: center.x + dx * start, z: center.z + dz * start },
      { x: center.x + dx * end, z: center.z + dz * end },
    ];
    return [
      {
        along: [0, end - start],
        closed: false,
        decks: [Number.NaN, Number.NaN],
        ends: [END.turn, END.turn] as [End, End],
        points,
        properties: { kind: "pedestrian", width: 6 },
      },
    ];
  });
}

/**
 * How a lane's traffic loops, as distances `u` round the loop: forward along
 * the route, through a hidden gap where it can't be seen (in a tunnel, off the
 * data), back along the other side, through the start's gap. A turn at a dead
 * end needs no gap. One-way lanes and closed routes have just forward and gap.
 */
interface Loop {
  period: number;
  spacing: number;
  /** Gap at the route's end. */
  endGap: number;
  length: number;
  code: number;
}

function loopOf(lane: Lane): Loop {
  const { route, flow } = lane;
  const length = route.along.at(-1) ?? 0;
  const gap = Math.max(2 * flow.spacing, 30);
  const [startEnd, endEnd] = route.closed ? [END.cut, END.cut] : route.ends;
  let period = length;
  let endGap = 0;
  if (route.closed) {
    endGap = 0;
  } else if (lane.twoWay) {
    endGap = endEnd === END.turn ? 0 : gap;
    period = 2 * length + endGap + (startEnd === END.turn ? 0 : gap);
  } else {
    endGap = gap;
    period = length + gap;
  }
  const count = Math.max(1, Math.round(period / gapOf(flow)));
  // The code: start and end kinds, then flags for both ways and reversed.
  const code =
    startEnd +
    4 * endEnd +
    16 * (lane.twoWay && !route.closed ? 1 : 0) +
    32 * (lane.reverse ? 1 : 0);
  return { code, endGap, length, period, spacing: period / count };
}

class PathWriter {
  readonly samples: number[] = [];
  private readonly square: Square;
  private readonly surface: Surface;
  /** Stretches already sampled, by route geometry. */
  private readonly spans = new Map<
    Point[],
    { s0: number; s1: number; first: number }[]
  >();

  constructor(square: Square, surface: Surface) {
    this.square = square;
    this.surface = surface;
  }

  get count(): number {
    return this.samples.length / 4;
  }

  /** A route's stretches inside the tile, sampled once whoever asks. */
  spansOf(route: Route): { s0: number; s1: number; first: number }[] {
    let spans = this.spans.get(route.points);
    if (!spans) {
      spans = clipRoute(route, this.square).map(([s0, s1]) => ({
        first: this.write(route, s0, s1),
        s0,
        s1,
      }));
      this.spans.set(route.points, spans);
    }
    return spans;
  }

  /** Samples a stretch of a route; returns the first sample's index. */
  write(route: Route, s0: number, s1: number): number {
    const first = this.count;
    const count = Math.ceil((s1 - s0) / SAMPLE) + 1;
    for (let index = 0; index < count; index += 1) {
      const s = s0 + index * SAMPLE;
      const at = routeAt(route, s);
      const behind = routeAt(route, s - SAMPLE);
      const ahead = routeAt(route, s + SAMPLE);
      const ground = this.surface.height(at.x, at.z);
      const y = Number.isFinite(at.deck)
        ? Math.max(ground, at.deck) + DECK_LIFT
        : ground + ROAD_LIFT;
      this.samples.push(
        at.x - this.square.x,
        y,
        at.z - this.square.z,
        Math.atan2(ahead.x - behind.x, ahead.z - behind.z)
      );
    }
    return first;
  }
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

/** Slots for the lanes' traffic in each stretch inside the tile. */
function writeLanes(
  lanes: Lane[],
  options: TrafficOptions,
  paths: PathWriter
): number[] {
  const values: number[] = [];
  for (const lane of lanes) {
    const { route } = lane;
    const loop = loopOf(lane);
    const jitter = loop.spacing * 0.25;
    const phase = hash(lane.seed, 3) * loop.period;
    const seed = Math.floor(hash(lane.seed, 5) * 65_536);
    for (const span of paths.spansOf(route)) {
      // Where the stretch meets another data tile, traffic can't carry on.
      const seams =
        (span.s0 > 0.01 && onEdge(routeAt(route, span.s0), options.data.square)
          ? 64
          : 0) +
        (span.s1 < loop.length - 0.01 &&
        onEdge(routeAt(route, span.s1), options.data.square)
          ? 128
          : 0);
      const windows: [number, number, number][] = lane.reverse
        ? [[loop.length - span.s1, loop.length - span.s0, -1]]
        : [[span.s0, span.s1, 1]];
      if (lane.twoWay && !route.closed) {
        const back = 2 * loop.length + loop.endGap;
        windows.push([back - span.s1, back - span.s0, -1]);
      }
      for (const [a, b, direction] of windows) {
        const start = a - jitter;
        const slots = Math.ceil((b - a + 2 * jitter) / loop.spacing) + 1;
        for (let slot = 0; slot < slots; slot += 1) {
          values.push(
            loop.period,
            loop.spacing,
            phase,
            lane.flow.speed,
            start,
            slot,
            direction,
            lane.right,
            span.first,
            span.s0,
            span.s1,
            loop.length,
            loop.endGap,
            loop.code + seams,
            seed
          );
        }
      }
    }
  }
  return values;
}

/** Slots a data tile's lanes would need, to keep the whole tile in budget. */
function slotsOf(lanes: Lane[]): number {
  let slots = 0;
  for (const lane of lanes) {
    const length = lane.route.along.at(-1) ?? 0;
    slots += ((lane.twoWay ? 2 : 1) * length) / gapOf(lane.flow);
  }
  return slots;
}

/** Most slots a data tile's lanes may need; denser places space out. */
const BUDGET = { cars: 7000, people: 6000 };

function spread(lanes: Lane[], budget: number): Lane[] {
  const slots = slotsOf(lanes);
  if (slots <= budget) {
    return lanes;
  }
  const factor = slots / budget;
  return lanes.map((lane) => ({
    ...lane,
    flow: { ...lane.flow, spacing: lane.flow.spacing * factor },
  }));
}

/**
 * Cars along the roads and people along paths, squares and sidewalks, as
 * routes sampled into a path texture and slots that move along them on the
 * GPU. Routes are chained over the whole data tile, the same for every tile
 * drawn from it, so traffic carries on across their edges.
 */
export function buildTraffic(options: TrafficOptions): TrafficData | undefined {
  const { data } = options;
  if (options.cars <= 0 && options.people <= 0) {
    return undefined;
  }
  const routeOptions = {
    field: options.field,
    square: data.square,
  };
  const roads = data.roads.filter(
    (line) => CARS[String(line.properties.kind) as RoadKind]
  );
  const carRoutes = buildRoutes(roads, {
    ...routeOptions,
    group: (line: Line) =>
      `${line.properties.kind}|${line.properties.oneway ?? 0}|${line.properties.lanes ?? ""}`,
  });
  const walks = data.roads.filter(
    (line) => WALKS[String(line.properties.kind) as RoadKind]
  );
  const walkRoutes = buildRoutes(walks, {
    ...routeOptions,
    group: (line: Line) => String(line.properties.kind),
  }).map((route) => ({
    ...route,
    // People turn round rather than fade at junctions.
    ends: route.ends.map((end) => (end === END.cut ? end : END.turn)) as [
      End,
      End,
    ],
  }));
  const busy = data.landuse.filter((area) =>
    BUSY.has(String(area.properties.kind))
  );
  const squares = data.landuse
    .filter((area) => area.properties.kind === "pedestrian")
    .flatMap(squareRoutes);

  const built = new Map<Route, number>();
  const builtOf = (route: Route) => {
    const known = built.get(route);
    if (known !== undefined) {
      return known;
    }
    const value = builtAlong(route, options);
    built.set(route, value);
    return value;
  };
  const cars =
    options.cars > 0
      ? spread(
          splitClosed(
            carRoutes.flatMap((route) =>
              carLanes(route, builtOf(route), 1 / options.cars)
            )
          ),
          BUDGET.cars
        )
      : [];
  const sidewalks = carRoutes
    .filter((route) => SIDEWALKS.has(String(route.properties.kind) as RoadKind))
    .map((route) => ({
      ...route,
      ends: route.ends.map((end) => (end === END.cut ? end : END.turn)) as [
        End,
        End,
      ],
    }));
  const people =
    options.people > 0
      ? spread(
          splitClosed(
            [...walkRoutes, ...sidewalks, ...squares].flatMap((route) => {
              const middle = routeAt(route, (route.along.at(-1) ?? 0) / 2);
              return walkLanes(
                route,
                builtOf(route),
                busyAt(middle, busy),
                1 / options.people
              );
            })
          ),
          BUDGET.people
        )
      : [];

  const paths = new PathWriter(options.square, options.surface);
  const carSlots = writeLanes(cars, options, paths);
  const peopleSlots = writeLanes(people, options, paths);
  if (paths.count === 0) {
    return undefined;
  }
  const rows = Math.ceil(paths.count / PATH_WIDTH);
  const samples = new Float32Array(rows * PATH_WIDTH * 4);
  samples.set(paths.samples);
  return {
    cars: Float32Array.from(carSlots),
    paths: samples,
    people: Float32Array.from(peopleSlots),
    rows,
  };
}
