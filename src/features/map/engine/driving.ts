import type { RoadKind } from "./format.ts";
import type { Placement, RoadEdge, RoadNode } from "./road-network.ts";
import { bendSpeed, placeOn } from "./road-network.ts";

/** How each kind of road is driven. */
export interface Flow {
  /** Meters a second, on the straight. */
  speed: number;
  /** Meters between cars on a full lane, and how full lanes are. */
  spacing: number;
  fill: number;
  /** How readily cars turn onto it, and so how big a road it is. */
  weight: number;
}

export const FLOW: Partial<Record<RoadKind, Flow>> = {
  motorway: { fill: 0.8, spacing: 30, speed: 24, weight: 4 },
  primary: { fill: 0.75, spacing: 28, speed: 14, weight: 3 },
  residential: { fill: 0.55, spacing: 56, speed: 8, weight: 1 },
  secondary: { fill: 0.7, spacing: 32, speed: 12.5, weight: 2.5 },
  service: { fill: 0.45, spacing: 110, speed: 5, weight: 0.3 },
  tertiary: { fill: 0.65, spacing: 40, speed: 11, weight: 2 },
  trunk: { fill: 0.8, spacing: 30, speed: 19, weight: 3.5 },
};

/** Roads buses run on. */
export const BUS_ROADS = new Set<RoadKind>([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
]);

export type Shape = "car" | "van" | "bus";

/** The kinds of vehicle, with their length and the colors they come in. */
export const KINDS: { shape: Shape; length: number; tints: number[] }[] = [
  {
    length: 4.3,
    shape: "car",
    tints: [
      0xf4_f4_f2, 0xc9_ce_d6, 0xe8_6a_5f, 0x6f_9f_d8, 0xf2_cf_63, 0x8f_d3_b6,
      0x55_63_80, 0xef_e3_c8,
    ],
  },
  {
    length: 5,
    shape: "van",
    tints: [
      0xf7_f7_f5, 0xf7_f7_f5, 0xdf_e3_ea, 0x6f_9f_d8, 0xe8_6a_5f, 0xf2_cf_63,
      0x8f_d3_b6, 0xc9_ce_d6,
    ],
  },
  {
    length: 11.6,
    shape: "bus",
    tints: [
      0xf2_b8_3d, 0xf2_b8_3d, 0xf0_8a_4b, 0x4f_86_c6, 0x3f_a3_8c, 0xf2_b8_3d,
      0xf0_8a_4b, 0x4f_86_c6,
    ],
  },
];

/** Car following, after the Intelligent Driver Model. */
const ACCELERATE = 1.6;
export const BRAKE = 2.8;
const STANDSTILL = 2.5;
const HEADWAY = 1.2;
/** Meters a second through a turn, and turning round at a dead end. */
const TURN_SPEED = 6;
const U_TURN_SPEED = 3;
/** Meters cars sink into a tunnel mouth, over how many meters. */
const SINK = 3;
const SINK_OVER = 12;
/** Meters ahead where cars check how sharp the road bends. */
const LOOK_AHEAD = [0, 8, 16, 26];

export interface Lane {
  edge: RoadEdge;
  forward: boolean;
  index: number;
  /** Meters right of the middle. */
  right: number;
  /** Headings of travel where it starts and where it ends. */
  leave: number;
  arrive: number;
  /** Cars on it, the one furthest along first. */
  cars: Car[];
}

/** A way across a junction, by where it comes in and goes out round it. */
export interface Move {
  node: RoadNode;
  from: Lane;
  to: Lane;
  /** Angles round the node where the car comes in and leaves. */
  in: number;
  out: number;
  /** How big a road it's coming from. */
  rank: number;
}

export interface Car {
  kind: number;
  tint: number;
  lane: Lane;
  s: number;
  speed: number;
  /** Its own pace: some drive a little faster than others. */
  pace: number;
  next?: Lane;
  /** Meters either side of the node the next turn rounds off. */
  reach: number;
  /** Meters a second the next turn may be taken at. */
  limit: number;
  /** This step's speeding up or braking. */
  accel: number;
  /** The lane it's turning out of, for the first meters of the next. */
  from?: { lane: Lane; reach: number };
  /** Its way across the junction ahead, and whether it's clear to go. */
  move?: Move;
  cleared: boolean;
  /** Seconds stopped. */
  waited: number;
  braking: boolean;
  /** Turn signal bits, as the vehicle material reads them. */
  signal: number;
  /** Puts its turn signals out of step with everyone else's. */
  phase: number;
  /** Coming up out of a tunnel mouth. */
  rising: boolean;
  /** Where it's drawn, as of the last update. */
  placed: Placement;
  scale: number;
}

const TAU = Math.PI * 2;

function wrap(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

/**
 * Whether two ways across a junction get in each other's way: from or to the
 * same lane, or crossing, as chords round the node would.
 */
export function clash(a: Move, b: Move): boolean {
  if (a.from === b.from || a.to === b.to) {
    return true;
  }
  const span = wrap(a.out - a.in);
  const inside = (angle: number) => {
    const offset = wrap(angle - a.in);
    return offset > 1e-3 && offset < span - 1e-3;
  };
  return inside(b.in) !== inside(b.out);
}

export function laneKey(edge: RoadEdge, forward: boolean, index: number) {
  return `${edge.id}:${forward ? 1 : 0}:${index}`;
}

/** The node a lane leads to. */
export function endOf(lane: Lane): RoadNode {
  return lane.forward ? lane.edge.to : lane.edge.from;
}

/** The node a lane starts from. */
export function startOf(lane: Lane): RoadNode {
  return lane.forward ? lane.edge.from : lane.edge.to;
}

export function lanesOf(edge: RoadEdge, forward: boolean): number {
  return forward ? edge.lanes[0] : edge.lanes[1];
}

export function lengthOf(car: Car): number {
  return KINDS[car.kind]?.length ?? 4.3;
}

/** Cars wanted on a lane at the busiest time of day. */
export function wanted(lane: Lane, density: number): number {
  const flow = FLOW[lane.edge.kind];
  if (!flow) {
    return 0;
  }
  const fill = flow.fill * (0.4 + 0.6 * lane.edge.built) * density;
  return (lane.edge.length * fill) / flow.spacing;
}

/** Whether going on into a lane takes turns: a junction, or lanes merging. */
export function contested(from: Lane, to: Lane): boolean {
  return (
    endOf(from).ends.length >= 3 ||
    lanesOf(to.edge, to.forward) < lanesOf(from.edge, from.forward)
  );
}

/**
 * Settles a car's turn into its next lane: how widely it's rounded off, how
 * slow to take it, and which turn signal to give.
 */
export function prepareTurn(car: Car, next: Lane): void {
  const { lane } = car;
  const round = next.edge === lane.edge;
  car.reach = Math.max(
    0.5,
    Math.min(
      round ? Math.abs(lane.right) + 1.5 : 7,
      lane.edge.length / 2,
      next.edge.length / 2
    )
  );
  const turn = Math.atan2(
    Math.sin(next.leave - lane.arrive),
    Math.cos(next.leave - lane.arrive)
  );
  const turning = Math.abs(turn) > 0.5;
  car.limit = 30;
  if (round) {
    car.limit = U_TURN_SPEED;
  } else if (turning) {
    car.limit = TURN_SPEED;
  }
  // Headings grow from south towards east: a left turn.
  car.signal = 0;
  if (turning || round) {
    car.signal = turn > 0 ? 2 : 4;
  }
}

/** The speed a car wants, from its road, the bends ahead and its next turn. */
export function desiredSpeed(car: Car): number {
  const { lane } = car;
  let speed = (FLOW[lane.edge.kind]?.speed ?? 8) * car.pace;
  for (const ahead of LOOK_AHEAD) {
    const s = car.s + ahead;
    if (s > lane.edge.length) {
      break;
    }
    const bend = bendSpeed(lane.edge, lane.forward, s);
    speed = Math.min(speed, Math.sqrt(bend * bend + 2 * BRAKE * ahead));
  }
  if (car.next) {
    const left = lane.edge.length - car.s - car.reach;
    speed = Math.min(
      speed,
      Math.sqrt(car.limit * car.limit + 2 * BRAKE * Math.max(0, left))
    );
  }
  return Math.max(1, speed);
}

/** IDM: how hard to speed up or brake for the gap and the car ahead. */
export function accelerate(
  speed: number,
  wish: number,
  gap: number,
  closing: number
): number {
  const keep =
    STANDSTILL +
    Math.max(
      0,
      speed * HEADWAY + (speed * closing) / (2 * Math.sqrt(ACCELERATE * BRAKE))
    );
  return (
    ACCELERATE * (1 - (speed / wish) ** 4 - (keep / Math.max(0.1, gap)) ** 2)
  );
}

/**
 * The gap to whatever's ahead of the car `index` places down its lane, and
 * how fast that is: the car in front, the last into its next lane, or the
 * stop line of a junction it isn't clear to cross yet.
 */
export function gapAhead(
  car: Car,
  index: number
): { gap: number; speed: number } {
  const { lane, next } = car;
  const leader = lane.cars[index - 1];
  if (leader) {
    return { gap: leader.s - car.s - lengthOf(leader), speed: leader.speed };
  }
  const left = lane.edge.length - car.s;
  let result = { gap: Number.POSITIVE_INFINITY, speed: 30 };
  // Without a next lane the road ends: into a tunnel, off the roads in play,
  // or off a one-way street that stops short.
  if (!next) {
    return result;
  }
  const last = next.cars.at(-1);
  if (last && last !== car) {
    result = { gap: left + last.s - lengthOf(last), speed: last.speed };
  }
  if (car.move && !car.cleared) {
    const stop = { gap: Math.max(0.1, left - car.reach - 1.5), speed: 0 };
    if (stop.gap < result.gap) {
      result = stop;
    }
  }
  return result;
}

/** Seconds until a car reaches the stop line at its junction. */
export function eta(car: Car): number {
  const left = car.lane.edge.length - car.s - car.reach - 1.5;
  return Math.max(0, left) / Math.max(car.speed, 2);
}

/** Into the next lane at the end of this one; false if it leaves the roads. */
export function advance(car: Car): boolean {
  const { lane, next } = car;
  if (!next) {
    return false;
  }
  const was = lane.cars.indexOf(car);
  if (was !== -1) {
    lane.cars.splice(was, 1);
  }
  car.s -= lane.edge.length;
  car.from = { lane, reach: car.reach };
  car.lane = next;
  car.next = undefined;
  car.signal = 0;
  // In behind whoever's further along: cars only overtake at junctions.
  let at = next.cars.length;
  while (at > 0 && (next.cars[at - 1] as Car).s < car.s) {
    at -= 1;
  }
  next.cars.splice(at, 0, car);
  return true;
}

/** Takes a car off a junction's list of those crossing it. */
export function leave(node: RoadNode, car: Car): void {
  const at = node.crossing.indexOf(car);
  if (at !== -1) {
    node.crossing.splice(at, 1);
  }
}

/** The turn a car is rounding at a node, from a little before to after. */
interface Bend {
  from: Lane;
  to: Lane;
  reach: number;
  /** 0 to 1 along it. */
  t: number;
}

function bendOf(car: Car): Bend | undefined {
  const { lane, next, from } = car;
  const { length } = lane.edge;
  if (next && car.s > length - car.reach) {
    const t = (car.s - (length - car.reach)) / (2 * car.reach);
    return { from: lane, reach: car.reach, t, to: next };
  }
  if (from && car.s < from.reach) {
    const t = (car.s + from.reach) / (2 * from.reach);
    return { from: from.lane, reach: from.reach, t, to: lane };
  }
  return undefined;
}

/** A curve through the node: a quadratic from just before to just after. */
function placeBend(bend: Bend, placed: Placement, scratch: Placement) {
  const { from, to, reach, t } = bend;
  const {
    x: ax,
    y: ay,
    z: az,
    pitch,
  } = placeOn(
    from.edge,
    from.forward,
    from.edge.length - reach,
    from.right,
    scratch
  );
  const end = placeOn(
    from.edge,
    from.forward,
    from.edge.length,
    from.right,
    scratch
  );
  const { heading: outward } = end;
  let mx = end.x;
  let my = end.y;
  let mz = end.z;
  const start = placeOn(to.edge, to.forward, 0, to.right, scratch);
  mx = (mx + start.x) / 2;
  my = (my + start.y) / 2;
  mz = (mz + start.z) / 2;
  if (to.edge === from.edge) {
    // Turning round: swing out past the end.
    mx += Math.sin(outward) * reach;
    mz += Math.cos(outward) * reach;
  }
  const b = placeOn(to.edge, to.forward, reach, to.right, scratch);
  const u = Math.min(1, Math.max(0, t));
  const v = 1 - u;
  placed.x = v * v * ax + 2 * v * u * mx + u * u * b.x;
  placed.y = v * v * ay + 2 * v * u * my + u * u * b.y;
  placed.z = v * v * az + 2 * v * u * mz + u * u * b.z;
  const dx = 2 * v * (mx - ax) + 2 * u * (b.x - mx);
  const dz = 2 * v * (mz - az) + 2 * u * (b.z - mz);
  placed.heading = Math.atan2(dx, dz);
  placed.pitch = pitch * v + b.pitch * u;
}

/**
 * Where a car is and which way it faces, rounding off turns at nodes and
 * sinking into tunnel mouths or rising out of them; `scratch` is scratch.
 */
export function placeCar(car: Car, scratch: Placement): void {
  const { lane, placed } = car;
  const bend = bendOf(car);
  if (bend) {
    placeBend(bend, placed, scratch);
  } else {
    placeOn(lane.edge, lane.forward, car.s, lane.right, placed);
  }
  car.scale = 1;
  const ahead = lane.edge.length - car.s;
  if (!car.next && endOf(lane).portal && ahead < SINK_OVER) {
    placed.y -= SINK * (1 - ahead / SINK_OVER);
    car.scale = Math.min(1, ahead / 1.5);
  } else if (!car.next && ahead < 3) {
    car.scale = Math.max(0, ahead / 3);
  }
  if (car.rising && car.s < SINK_OVER) {
    placed.y -= SINK * (1 - car.s / SINK_OVER);
    car.scale = Math.min(car.scale, car.s / 1.5);
  } else {
    car.rising = false;
  }
}
