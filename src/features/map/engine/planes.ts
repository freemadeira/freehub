import type { BufferGeometry, Vector3Like } from "three";
import {
  Color,
  Euler,
  Group,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";

import { Fleet } from "./fleet.ts";
import type { AirPoint, Airport, LngLat } from "./format.ts";
import type { Frame } from "./geo.ts";
import { toLocal } from "./geo.ts";
import type { SharedUniforms } from "./materials.ts";
import { hash } from "./random.ts";
import type { Voice } from "./voice.ts";
import { createVoices } from "./voice.ts";

/** Meters a second. */
const APPROACH_SPEED = 70;
const TAXI_SPEED = 15;
const ROTATE_SPEED = 78;
const CLIMB_SPEED = 85;
/** Meters from the runway's end where wheels touch, and where they leave it. */
const TOUCHDOWN = 300;
const TAKEOFF_ROLL = 1500;
/** Meters of approach and climb drawn, and of flare over the runway. */
const APPROACH = 10_000;
const CLIMB = 10_000;
const FLARE = 500;
/** Seconds lined up before rolling, and of fading in and out of view. */
const LINE_UP = 6;
const FADE = 15;
const RADIANS = Math.PI / 180;
/** Height above the ground the approach and climb keep, at least. */
const CLEARANCE = 80;

const TAILS = [0x4f_86_c6, 0xe8_6a_5f, 0x3f_a3_8c, 0xf2_b8_3d, 0x7d_6b_c4];

type Ground = (x: number, z: number) => number;

/** A polyline with heights, and distances along it. */
interface Track {
  points: Vector3[];
  along: number[];
  length: number;
}

function trackOf(points: Vector3[]): Track {
  let total = 0;
  const along = points.map((point, index) => {
    const before = points[index - 1];
    total += before ? point.distanceTo(before) : 0;
    return total;
  });
  return { along, length: total, points };
}

function trackAt(track: Track, s: number, out: Vector3): Vector3 {
  const at = Math.min(track.length, Math.max(0, s));
  let index = 1;
  while (index < track.along.length - 1 && (track.along[index] ?? 0) < at) {
    index += 1;
  }
  const start = track.along[index - 1] ?? 0;
  const end = track.along[index] ?? start;
  const a = track.points[index - 1] ?? out;
  const b = track.points[index] ?? a;
  return out.lerpVectors(a, b, end > start ? (at - start) / (end - start) : 0);
}

const ahead = new Vector3();
const here = new Vector3();

/** Heading to a point a little further on, so turns come out smooth. */
function trackHeading(track: Track, s: number, reach = 18): number {
  trackAt(track, s - reach * 0.25, here);
  trackAt(track, s + reach, ahead);
  return Math.atan2(ahead.x - here.x, ahead.z - here.z);
}

/** Taxiways and the runway as one network, joined where they share nodes. */
interface Network {
  nodes: Vector3[];
  keys: Map<string, number>;
  links: Map<number, { to: number; length: number }[]>;
}

function keyOf(point: LngLat): string {
  return `${point.lat},${point.lng}`;
}

function heightOf(
  point: AirPoint,
  local: { x: number; z: number },
  ground: Ground
) {
  const floor = Math.max(0, ground(local.x, local.z));
  return point.deck === undefined
    ? floor + 0.15
    : Math.max(floor, point.deck) + 0.3;
}

function networkOf(paths: AirPoint[][], frame: Frame, ground: Ground): Network {
  const network: Network = { keys: new Map(), links: new Map(), nodes: [] };
  const nodeOf = (point: AirPoint) => {
    const key = keyOf(point);
    const known = network.keys.get(key);
    if (known !== undefined) {
      return known;
    }
    const local = toLocal(frame, point);
    network.nodes.push(
      new Vector3(local.x, heightOf(point, local, ground), local.z)
    );
    network.keys.set(key, network.nodes.length - 1);
    return network.nodes.length - 1;
  };
  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      const a = nodeOf(path[index - 1] as AirPoint);
      const b = nodeOf(path[index] as AirPoint);
      const length = (network.nodes[a] as Vector3).distanceTo(
        network.nodes[b] as Vector3
      );
      network.links.set(a, [
        ...(network.links.get(a) ?? []),
        { length, to: b },
      ]);
      network.links.set(b, [
        ...(network.links.get(b) ?? []),
        { length, to: a },
      ]);
    }
  }
  return network;
}

/** The shortest way between two nodes, as their points. */
function shortest(network: Network, from: number, to: number): Vector3[] {
  const distance = new Map<number, number>([[from, 0]]);
  const previous = new Map<number, number>();
  const open = new Set<number>([from]);
  while (open.size > 0) {
    let current = -1;
    let best = Number.POSITIVE_INFINITY;
    for (const node of open) {
      const value = distance.get(node) ?? Number.POSITIVE_INFINITY;
      if (value < best) {
        best = value;
        current = node;
      }
    }
    open.delete(current);
    if (current === to) {
      break;
    }
    for (const link of network.links.get(current) ?? []) {
      const through = best + link.length;
      if (through < (distance.get(link.to) ?? Number.POSITIVE_INFINITY)) {
        distance.set(link.to, through);
        previous.set(link.to, current);
        open.add(link.to);
      }
    }
  }
  const nodes = [to];
  while (nodes[0] !== from) {
    const before = previous.get(nodes[0] ?? from);
    if (before === undefined) {
      return [network.nodes[from] as Vector3, network.nodes[to] as Vector3];
    }
    nodes.unshift(before);
  }
  return nodes.map((node) => network.nodes[node] as Vector3);
}

function nearest(network: Network, point: Vector3Like): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const [index, node] of network.nodes.entries()) {
    const value = Math.hypot(node.x - point.x, node.z - point.z);
    if (value < distance) {
      distance = value;
      best = index;
    }
  }
  return best;
}

function inside(
  point: { x: number; z: number },
  ring: { x: number; z: number }[]
) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] ?? point;
    const b = ring[j] ?? point;
    if (
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
    ) {
      result = !result;
    }
  }
  return result;
}

/** Where planes park: spots spread along the aprons, away from their edges. */
function standsOf(
  airport: Airport,
  frame: Frame,
  ground: Ground,
  along: Vector3
): Vector3[] {
  const spots: Vector3[] = [];
  for (const apron of airport.aprons) {
    const ring = apron.map((point) => toLocal(frame, point));
    const xs = ring.map((point) => point.x);
    const zs = ring.map((point) => point.z);
    const step = 30;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += step) {
        const clear = [
          [0, 0],
          [28, 0],
          [-28, 0],
          [0, 28],
          [0, -28],
        ].every(([dx, dz]) =>
          inside({ x: x + (dx ?? 0), z: z + (dz ?? 0) }, ring)
        );
        if (clear) {
          spots.push(new Vector3(x, Math.max(0, ground(x, z)) + 0.15, z));
        }
      }
    }
  }
  const sorted = spots.toSorted((a, b) => a.dot(along) - b.dot(along));
  const count = Math.min(3, sorted.length);
  return Array.from(
    { length: count },
    (_, index) =>
      sorted[Math.floor(((index + 0.5) / count) * sorted.length)] as Vector3
  );
}

/** One direction of use: land and take off towards the same end. */
interface Way {
  runway: Track;
  approach: Track;
  /** Meters along the runway where planes leave it after landing. */
  exit: number;
  /** Per stand: from the runway exit to the stand, and out to take off. */
  taxiIn: Track[];
  departures: Departure[];
}

interface Plan {
  ways: Way[];
  stands: Vector3[];
  standHeadings: number[];
  colors: Color[];
  /** The stand planes use, by the direction they land in. */
  standFor: number[];
  /** Seconds between arrivals. */
  period: number;
  approachTime: number;
  /** Seconds into a cycle when the plane on the ground is parked. */
  parked: number;
}

/** The steepest the ground below makes an approach or climb, in radians. */
function angleOver(
  start: Vector3,
  direction: Vector3,
  length: number,
  least: number,
  ground: Ground
): number {
  let angle = least;
  for (let d = 200; d <= length; d += 200) {
    const height =
      ground(start.x + direction.x * d, start.z + direction.z * d) +
      CLEARANCE -
      start.y;
    angle = Math.max(angle, Math.atan2(height, d));
  }
  return Math.min(angle, 12 * RADIANS);
}

function airTrack(
  from: Vector3,
  direction: Vector3,
  angle: number,
  length: number,
  flare: boolean
): Track {
  const points: Vector3[] = [];
  for (let d = 0; d <= length; d += 100) {
    const ease = flare
      ? d * (d < FLARE ? (d / FLARE) * (d / FLARE) * (3 - (2 * d) / FLARE) : 1)
      : d;
    points.push(
      new Vector3(
        from.x + direction.x * d,
        from.y + Math.tan(angle) * ease,
        from.z + direction.z * d
      )
    );
  }
  return trackOf(points);
}

/** Where a departure from one stand joins the runway, and its way up. */
interface Departure {
  taxi: Track;
  /** Meters along the runway where the roll starts. */
  entry: number;
  climb: Track;
}

/** Every runway node a taxiway joins, with how far along it lies. */
function junctions(runway: Track, network: Network) {
  return runway.points.flatMap((point, index) => {
    const node = nearest(network, point);
    const joined = index === 0 || (network.links.get(node)?.length ?? 0) > 2;
    return joined ? [{ along: runway.along[index] ?? 0, node }] : [];
  });
}

/** Taxi to the nearest junction with runway enough ahead to take off. */
function departureOf(
  runway: Track,
  network: Network,
  stand: Vector3,
  ground: Ground
): Departure {
  const direction = new Vector3()
    .subVectors(runway.points[1] as Vector3, runway.points[0] as Vector3)
    .setY(0)
    .normalize();
  const from = nearest(network, stand);
  const choices = junctions(runway, network)
    .filter(({ along }) => along <= runway.length - TAKEOFF_ROLL - 400)
    .map(({ along, node }) => ({
      along,
      taxi: trackOf([
        stand,
        ...shortest(network, from, node),
        trackAt(runway, along + 40, new Vector3()),
      ]),
    }))
    .toSorted((a, b) => a.taxi.length - b.taxi.length);
  const best = choices[0] ?? {
    along: 0,
    taxi: trackOf([stand, trackAt(runway, 40, new Vector3())]),
  };
  const entry = best.along + 40;
  const lift = trackAt(runway, entry + TAKEOFF_ROLL, new Vector3());
  const angle = angleOver(lift, direction, CLIMB, 7 * RADIANS, ground);
  return {
    climb: airTrack(lift, direction, angle, CLIMB, false),
    entry,
    taxi: best.taxi,
  };
}

function wayOf(
  runway: Track,
  network: Network,
  stands: Vector3[],
  ground: Ground
): Way {
  const direction = new Vector3()
    .subVectors(runway.points[1] as Vector3, runway.points[0] as Vector3)
    .setY(0)
    .normalize();
  const touchdown = trackAt(runway, TOUCHDOWN, new Vector3());
  const back = direction.clone().negate();
  const glide = angleOver(touchdown, back, APPROACH, 3 * RADIANS, ground);
  const approach = airTrack(touchdown, back, glide, APPROACH, true);
  approach.points.reverse();
  // Leave at the first junction once slow enough.
  const exit =
    junctions(runway, network).find(({ along }) => along > TOUCHDOWN + 900)
      ?.along ?? runway.length;
  const exitPoint = trackAt(runway, exit, new Vector3());
  const exitNode = nearest(network, exitPoint);
  return {
    approach,
    departures: stands.map((stand) =>
      departureOf(runway, network, stand, ground)
    ),
    exit,
    runway,
    taxiIn: stands.map((stand) =>
      trackOf([
        exitPoint,
        ...shortest(network, exitNode, nearest(network, stand)),
        stand,
      ])
    ),
  };
}

function rollTime(distance: number): number {
  return (2 * distance) / (APPROACH_SPEED + TAXI_SPEED);
}

const TAKEOFF_TIME = (2 * TAKEOFF_ROLL) / ROTATE_SPEED;
/** Seconds from the start of a takeoff roll to the next landing. */
const SEPARATION = TAKEOFF_TIME + 18;

/** Seconds from touchdown to parked at a stand. */
function arrival(way: Way, stand: number): number {
  return (
    rollTime(way.exit - TOUCHDOWN) +
    (way.taxiIn[stand]?.length ?? 0) / TAXI_SPEED
  );
}

function planOf(
  airport: Airport,
  frame: Frame,
  ground: Ground
): Plan | undefined {
  const [longest] = airport.runways.toSorted(
    (a, b) => b.path.length - a.path.length
  );
  if (!longest || longest.path.length < 2) {
    return undefined;
  }
  const network = networkOf([longest.path, ...airport.taxiways], frame, ground);
  const forward = trackOf(
    longest.path.map(
      (point) => network.nodes[network.keys.get(keyOf(point)) ?? 0] as Vector3
    )
  );
  const backward = trackOf(forward.points.toReversed());
  const along = new Vector3()
    .subVectors(forward.points.at(-1) as Vector3, forward.points[0] as Vector3)
    .normalize();
  const stands = standsOf(airport, frame, ground, along);
  if (stands.length === 0) {
    return undefined;
  }
  const middle = trackAt(forward, forward.length / 2, new Vector3());
  // Parked nose out from the runway, towards the terminal.
  const standHeadings = stands.map((stand) =>
    Math.atan2(stand.x - middle.x, stand.z - middle.z)
  );
  const ways = [
    wayOf(forward, network, stands, ground),
    wayOf(backward, network, stands, ground),
  ];
  // Seconds from touchdown to parked, and from the stand to the runway,
  // whichever way the next plane leaves.
  const leave = (stand: number) =>
    Math.max(
      ...ways.map(
        (way) => (way.departures[stand]?.taxi.length ?? 0) / TAXI_SPEED
      )
    );
  const standFor = ways.map(
    (way) =>
      stands
        .map((_, stand) => stand)
        .toSorted(
          (a, b) => arrival(way, a) + leave(a) - (arrival(way, b) + leave(b))
        )[0] ?? 0
  );
  const turnaround = Math.max(
    ...ways.map((way, index) => {
      const stand = standFor[index] ?? 0;
      return arrival(way, stand) + leave(stand);
    })
  );
  const approachTime = APPROACH / APPROACH_SPEED;
  return {
    approachTime,
    colors: TAILS.map((hex) => new Color().setHex(hex, SRGBColorSpace)),
    parked:
      approachTime +
      Math.max(
        ...ways.map((way, index) => arrival(way, standFor[index] ?? 0))
      ) +
      5,
    // One plane on the ground at a time: the next leaves before one lands.
    period: Math.max(150, turnaround + LINE_UP + SEPARATION + 10),
    standFor,
    standHeadings,
    stands,
    ways,
  };
}

interface Pose {
  position: Vector3;
  heading: number;
  pitch: number;
  /** 0 to 1: fading in or out of view. */
  shown: number;
  /** Off the ground: approaching or climbing out. */
  flying: boolean;
  /** 0 to 1: how hard its engines run. */
  thrust: number;
}

/** The direction in use: it changes now and then, as the wind would. */
function wayIndex(cycle: number): number {
  return hash(Math.floor(cycle / 7), 41) < 0.5 ? 0 : 1;
}

/** The stand a cycle's plane parks at: the handiest for its direction. */
function standOf(plan: Plan, cycle: number): number {
  return plan.standFor[wayIndex(cycle)] ?? 0;
}

function arrivalPose(
  plan: Plan,
  cycle: number,
  t: number,
  pose: Pose
): boolean {
  const way = plan.ways[wayIndex(cycle)] as Way;
  const stand = standOf(plan, cycle);
  const roll = rollTime(way.exit - TOUCHDOWN);
  const taxi = way.taxiIn[stand] as Track;
  if (t < plan.approachTime) {
    trackAt(way.approach, t * APPROACH_SPEED, pose.position);
    pose.heading = trackHeading(way.runway, 0);
    pose.pitch = 3 * RADIANS;
    pose.shown = Math.min(1, t / FADE);
    pose.flying = true;
    pose.thrust = 0.6;
    return true;
  }
  const rolling = t - plan.approachTime;
  if (rolling < roll) {
    const slowing = (APPROACH_SPEED - TAXI_SPEED) / roll;
    const s =
      TOUCHDOWN + APPROACH_SPEED * rolling - (slowing * rolling * rolling) / 2;
    trackAt(way.runway, s, pose.position);
    pose.heading = trackHeading(way.runway, s);
    pose.pitch = Math.max(0, 1 - rolling / 4) * 4 * RADIANS;
    // Reverse thrust as the wheels touch, easing off as it slows.
    pose.thrust = 0.35 + 0.55 * (1 - rolling / roll);
    return true;
  }
  const s = (rolling - roll) * TAXI_SPEED;
  trackAt(taxi, s, pose.position);
  pose.heading =
    s >= taxi.length ? (plan.standHeadings[stand] ?? 0) : trackHeading(taxi, s);
  pose.thrust = s >= taxi.length ? 0 : 0.25;
  return true;
}

/**
 * A plane leaves in the next cycle, from the end in use then: its takeoff
 * roll starts a little before that cycle's arrival lands.
 */
function scheduleOf(plan: Plan, cycle: number) {
  const way = plan.ways[wayIndex(cycle + 1)] as Way;
  const departure = way.departures[standOf(plan, cycle)] as Departure;
  const takeoff = plan.period + plan.approachTime - SEPARATION;
  return {
    departure,
    takeoff,
    taxiStart: takeoff - LINE_UP - departure.taxi.length / TAXI_SPEED,
    way,
  };
}

function departurePose(
  plan: Plan,
  cycle: number,
  t: number,
  pose: Pose
): boolean {
  const { departure, takeoff, taxiStart, way } = scheduleOf(plan, cycle);
  const { taxi } = departure;
  if (t < takeoff) {
    const s = Math.min(taxi.length, (t - taxiStart) * TAXI_SPEED);
    trackAt(taxi, s, pose.position);
    pose.heading =
      s >= taxi.length
        ? trackHeading(way.runway, departure.entry)
        : trackHeading(taxi, s);
    pose.thrust = 0.25;
    return true;
  }
  const rolling = t - takeoff;
  if (rolling < TAKEOFF_TIME) {
    const s =
      departure.entry + (ROTATE_SPEED / TAKEOFF_TIME) * rolling * rolling * 0.5;
    trackAt(way.runway, s, pose.position);
    pose.heading = trackHeading(way.runway, s);
    pose.pitch = Math.max(0, (rolling - TAKEOFF_TIME + 3) / 3) * 8 * RADIANS;
    pose.thrust = 1;
    return true;
  }
  const climbing = (rolling - TAKEOFF_TIME) * CLIMB_SPEED;
  if (climbing > departure.climb.length) {
    return false;
  }
  trackAt(departure.climb, climbing, pose.position);
  pose.heading = trackHeading(departure.climb, climbing);
  pose.pitch = 9 * RADIANS;
  pose.flying = true;
  pose.thrust = 1;
  pose.shown = Math.min(
    1,
    (departure.climb.length - climbing) / (CLIMB_SPEED * FADE)
  );
  return true;
}

/** A plane's pose `t` seconds after its cycle began, or nothing once it's gone. */
function poseOf(plan: Plan, cycle: number, t: number, pose: Pose): boolean {
  pose.pitch = 0;
  pose.flying = false;
  pose.shown = 1;
  pose.thrust = 0;
  return t < scheduleOf(plan, cycle).taxiStart
    ? arrivalPose(plan, cycle, t, pose)
    : departurePose(plan, cycle, t, pose);
}

/**
 * Planes at each airport: each cycle one lands, taxis to a stand and parks,
 * once the one parked before it has taxied out and taken off. They grow with
 * distance, so they still read from across the island.
 */
export class Planes {
  readonly group = new Group();
  /** Each plane's engines, where it is. */
  readonly voices: Voice[];
  private readonly plans: Plan[];
  private readonly fleet: Fleet;
  private readonly pose: Pose = {
    flying: false,
    heading: 0,
    pitch: 0,
    position: new Vector3(),
    shown: 1,
    thrust: 0,
  };
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, "YXZ");
  private readonly scale = new Vector3();

  constructor(
    airports: Airport[],
    frame: Frame,
    ground: Ground,
    shape: BufferGeometry,
    shared: SharedUniforms,
    shadows: boolean
  ) {
    this.group.name = "planes";
    this.plans = airports.flatMap((airport) => {
      const plan = planOf(airport, frame, ground);
      return plan ? [plan] : [];
    });
    this.fleet = new Fleet(shape, shared, this.plans.length * 3, shadows);
    this.voices = createVoices(this.plans.length * 3);
    this.group.add(this.fleet.mesh);
  }

  /** `life` in seconds; frozen, planes stay parked. */
  update(life: number, camera: Vector3, frozen: boolean): void {
    let slot = 0;
    for (const plan of this.plans) {
      const time = frozen ? plan.period * 10 + plan.parked : life;
      const latest = Math.floor(time / plan.period);
      for (let cycle = latest - 2; cycle <= latest; cycle += 1) {
        this.place(plan, cycle, time - cycle * plan.period, slot, camera);
        // Standing still, a plane in the air would look stuck there.
        if (frozen && this.pose.flying) {
          this.fleet.hide(slot);
          (this.voices[slot] as Voice).level = 0;
        }
        slot += 1;
      }
    }
  }

  private place(
    plan: Plan,
    cycle: number,
    t: number,
    slot: number,
    camera: Vector3
  ) {
    const { pose } = this;
    const voice = this.voices[slot] as Voice;
    if (t < 0 || !poseOf(plan, cycle, t, pose)) {
      this.fleet.hide(slot);
      voice.level = 0;
      return;
    }
    voice.position.copy(pose.position);
    voice.level = pose.thrust * pose.shown;
    // Bigger from far off, so a plane never shrinks to nothing.
    const grow =
      Math.min(6, Math.max(1, pose.position.distanceTo(camera) / 1800)) *
      pose.shown;
    this.euler.set(-pose.pitch, pose.heading, 0);
    this.rotation.setFromEuler(this.euler);
    this.scale.setScalar(grow);
    this.matrix.compose(pose.position, this.rotation, this.scale);
    this.fleet.set(
      slot,
      this.matrix,
      plan.colors[Math.floor(hash(cycle, 3) * plan.colors.length)]
    );
  }

  dispose(): void {
    this.fleet.dispose();
  }
}
