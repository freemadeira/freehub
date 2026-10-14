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
const TAXI_SPEED = 16;
/** Along a stand's lead line, and pushed back out of it. */
const LEAD_SPEED = 5;
const PUSH_SPEED = 5;
const ROTATE_SPEED = 78;
const CLIMB_SPEED = 85;
/** Meters from the runway's end where wheels touch, and where they leave it. */
const TOUCHDOWN = 300;
const TAKEOFF_ROLL = 1500;
/** Meters of approach and climb drawn, and of flare over the runway. */
const APPROACH = 10_000;
const CLIMB = 10_000;
const FLARE = 500;
/** Seconds lined up before rolling, of fading in and out of view, and parked after pushback while the tug lets go. */
const LINE_UP = 6;
const FADE = 15;
const UNHITCH = 6;
const RADIANS = Math.PI / 180;
/** Height above the ground the approach and climb keep, at least. */
const CLEARANCE = 80;
/** Meters from a plane's middle to its nose. */
const NOSE = 18;
/** Meters a pushback reaches past the lead line, onto the taxiway. */
const PUSH_PAST = 30;
/** Most planes parked at once, and the least room between their noses. */
const PARKED = 8;
const ROOM = 38;
/** Seconds after touchdown or before liftoff over which a plane shrinks or grows. */
const GROW_TIME = 4;

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

/** A stand: the way in from the taxiway, ending where the plane's middle stops. */
interface Spot {
  lead: Track;
  /** Where the plane's nose points once parked. */
  heading: number;
}

/**
 * Stands from the pack: each lead line, cut short so the nose, not the
 * middle, stops at its end.
 */
function mappedSpots(airport: Airport, frame: Frame, ground: Ground): Spot[] {
  return (airport.stands ?? []).flatMap((stand) => {
    const points = stand.lead.map((point) => {
      const { x, z } = toLocal(frame, point);
      return new Vector3(x, Math.max(0, ground(x, z)) + 0.15, z);
    });
    const full = trackOf(points);
    if (full.length < NOSE + 10) {
      return [];
    }
    const stop = full.length - NOSE;
    const kept = points.filter((_, index) => (full.along[index] ?? 0) < stop);
    const lead = trackOf([...kept, trackAt(full, stop, new Vector3())]);
    return [{ heading: trackHeading(lead, lead.length, 4), lead }];
  });
}

/** Without mapped stands: spots spread along the aprons, away from their edges. */
function apronSpots(
  airport: Airport,
  frame: Frame,
  ground: Ground,
  runwayMiddle: Vector3
): Spot[] {
  const spots: Vector3[] = [];
  for (const apron of airport.aprons) {
    const ring = apron.map((point) => toLocal(frame, point));
    const xs = ring.map((point) => point.x);
    const zs = ring.map((point) => point.z);
    const step = 40;
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
  // Parked nose out from the runway, towards the terminal.
  return spots.map((spot) => {
    const heading = Math.atan2(
      spot.x - runwayMiddle.x,
      spot.z - runwayMiddle.z
    );
    const back = new Vector3(
      spot.x - Math.sin(heading) * 40,
      spot.y,
      spot.z - Math.cos(heading) * 40
    );
    return { heading, lead: trackOf([back, spot]) };
  });
}

/** Stands far enough apart to park at all at once, spread over the airport. */
function spreadSpots(spots: Spot[]): Spot[] {
  const ends = spots.map((spot) => spot.lead.points.at(-1) as Vector3);
  const chosen: number[] = [];
  // Every other stand first, so the parked planes spread out.
  const indices = spots.map((_, index) => index);
  const order = [
    ...indices.filter((index) => index % 2 === 0),
    ...indices.filter((index) => index % 2 === 1),
  ];
  for (const index of order) {
    const end = ends[index] as Vector3;
    if (
      chosen.every((other) => (ends[other] as Vector3).distanceTo(end) >= ROOM)
    ) {
      chosen.push(index);
    }
    if (chosen.length === PARKED) {
      break;
    }
  }
  return chosen.toSorted((a, b) => a - b).map((index) => spots[index] as Spot);
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

/** A taxi from the runway to a stand: quick on the taxiways, slow on the lead. */
interface TaxiIn {
  track: Track;
  /** Meters along where the lead line starts. */
  lead: number;
}

function taxiInTime(taxi: TaxiIn): number {
  return taxi.lead / TAXI_SPEED + (taxi.track.length - taxi.lead) / LEAD_SPEED;
}

function taxiInAt(taxi: TaxiIn, t: number): number {
  const quick = taxi.lead / TAXI_SPEED;
  return t < quick ? t * TAXI_SPEED : taxi.lead + (t - quick) * LEAD_SPEED;
}

/** Leaving a stand: pushed back onto the taxiway, then taxiing to the runway. */
interface Departure {
  push: Track;
  taxi: Track;
  /** Meters along the runway where the roll starts. */
  entry: number;
  climb: Track;
}

/** Seconds from the start of pushback to lined up on the runway. */
function leaveTime(departure: Departure): number {
  return (
    departure.push.length / PUSH_SPEED +
    UNHITCH +
    departure.taxi.length / TAXI_SPEED
  );
}

/** One direction of use: land and take off towards the same end. */
interface Way {
  runway: Track;
  approach: Track;
  /** Meters along the runway where planes leave it after landing. */
  exit: number;
  /** Per stand: from the runway exit in, and out to take off. */
  taxiIn: TaxiIn[];
  departures: Departure[];
}

/** Every runway node a taxiway joins, with how far along it lies. */
function junctions(runway: Track, network: Network) {
  return runway.points.flatMap((point, index) => {
    const node = nearest(network, point);
    const joined = index === 0 || (network.links.get(node)?.length ?? 0) > 2;
    return joined ? [{ along: runway.along[index] ?? 0, node }] : [];
  });
}

/**
 * Pushed back along the lead line and a little past it, tail first, so the
 * nose ends up pointing the way it taxis; then to the nearest junction with
 * runway enough ahead to take off.
 */
function departureOf(
  runway: Track,
  network: Network,
  spot: Spot,
  ground: Ground
): Departure {
  const direction = new Vector3()
    .subVectors(runway.points[1] as Vector3, runway.points[0] as Vector3)
    .setY(0)
    .normalize();
  const mouth = spot.lead.points[0] as Vector3;
  const from = nearest(network, mouth);
  const choices = junctions(runway, network)
    .filter(({ along }) => along <= runway.length - TAKEOFF_ROLL - 150)
    .map(({ along, node }) => ({
      along,
      path: [
        ...shortest(network, from, node),
        trackAt(runway, along + 40, new Vector3()),
      ],
    }))
    .toSorted((a, b) => trackOf(a.path).length - trackOf(b.path).length);
  const best = choices[0] ?? {
    along: 0,
    path: [trackAt(runway, 40, new Vector3())],
  };
  const next = best.path.find((point) => point.distanceTo(mouth) > 5) ?? mouth;
  const away = new Vector3().subVectors(next, mouth).setY(0).normalize();
  const tail = mouth.clone().addScaledVector(away, -PUSH_PAST);
  tail.y = Math.max(0, ground(tail.x, tail.z)) + 0.15;
  const entry = best.along + 40;
  const lift = trackAt(runway, entry + TAKEOFF_ROLL, new Vector3());
  const angle = angleOver(lift, direction, CLIMB, 7 * RADIANS, ground);
  return {
    climb: airTrack(lift, direction, angle, CLIMB, false),
    entry,
    push: trackOf([...spot.lead.points.toReversed(), tail]),
    taxi: trackOf([tail, ...best.path]),
  };
}

function wayOf(
  runway: Track,
  network: Network,
  spots: Spot[],
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
    departures: spots.map((spot) => departureOf(runway, network, spot, ground)),
    exit,
    runway,
    taxiIn: spots.map((spot) => {
      const taxiway = trackOf([
        exitPoint,
        ...shortest(
          network,
          exitNode,
          nearest(network, spot.lead.points[0] as Vector3)
        ),
      ]);
      return {
        lead: taxiway.length,
        track: trackOf([...taxiway.points, ...spot.lead.points]),
      };
    }),
  };
}

/** Meters a plane on the move keeps from one parked. */
const PASSING = 32;

/**
 * A stand whose parked plane sits in the way of planes going to or from
 * another: its lead line or pushback runs past, or a taxi route does.
 */
function inTheWay(ways: Way[], spots: Spot[]): number | undefined {
  const parked = spots.map((spot) => spot.lead.points.at(-1) as Vector3);
  const point = new Vector3();
  for (const way of ways) {
    for (const [index] of spots.entries()) {
      const taxiIn = way.taxiIn[index] as TaxiIn;
      const departure = way.departures[index] as Departure;
      for (const track of [taxiIn.track, departure.push, departure.taxi]) {
        for (let s = 0; s <= track.length; s += 4) {
          trackAt(track, s, point);
          const blocker = parked.findIndex(
            (other, at) => at !== index && other.distanceTo(point) < PASSING
          );
          if (blocker !== -1) {
            return blocker;
          }
        }
      }
    }
  }
  return undefined;
}

function rollTime(distance: number): number {
  return (2 * distance) / (APPROACH_SPEED + TAXI_SPEED);
}

const TAKEOFF_TIME = (2 * TAKEOFF_ROLL) / ROTATE_SPEED;
/** Seconds from the start of a takeoff roll to the next landing. */
const SEPARATION = TAKEOFF_TIME + 18;
/** Meters planes on the move keep between them. */
const APART = 60;

/** Seconds from touchdown to parked at a stand. */
function arrival(way: Way, spot: number): number {
  const taxi = way.taxiIn[spot] as TaxiIn;
  return rollTime(way.exit - TOUCHDOWN) + taxiInTime(taxi);
}

/** Where a landing plane is each second, from touchdown until it parks. */
function arrivalSamples(way: Way, spot: number): Vector3[] {
  const roll = rollTime(way.exit - TOUCHDOWN);
  const taxi = way.taxiIn[spot] as TaxiIn;
  const slowing = (APPROACH_SPEED - TAXI_SPEED) / roll;
  return Array.from({ length: Math.ceil(arrival(way, spot)) }, (_, t) =>
    t < roll
      ? trackAt(
          way.runway,
          TOUCHDOWN + APPROACH_SPEED * t - (slowing * t * t) / 2,
          new Vector3()
        )
      : trackAt(taxi.track, taxiInAt(taxi, t - roll), new Vector3())
  );
}

/** Where a leaving plane is each second, from pushback until it lifts off. */
function departureSamples(way: Way, spot: number): Vector3[] {
  const departure = way.departures[spot] as Departure;
  const { push, taxi } = departure;
  const pushed = push.length / PUSH_SPEED + UNHITCH;
  const rolled = leaveTime(departure) + LINE_UP;
  return Array.from({ length: Math.ceil(rolled + TAKEOFF_TIME) }, (_, t) => {
    if (t < pushed) {
      return trackAt(push, t * PUSH_SPEED, new Vector3());
    }
    if (t < rolled) {
      return trackAt(taxi, (t - pushed) * TAXI_SPEED, new Vector3());
    }
    const rolling = t - rolled;
    return trackAt(
      way.runway,
      departure.entry + (ROTATE_SPEED / TAKEOFF_TIME) * rolling * rolling * 0.5,
      new Vector3()
    );
  });
}

/**
 * Whether a departure pushing back `gap` seconds after a plane touches down
 * keeps clear of it on the ground.
 */
function clearOf(landing: Vector3[], leaving: Vector3[], gap: number): boolean {
  for (let t = Math.max(0, gap); t < landing.length; t += 1) {
    const other = leaving[t - gap];
    if (other && (landing[t] as Vector3).distanceTo(other) < APART) {
      return false;
    }
  }
  return true;
}

interface Plan {
  ways: Way[];
  spots: Spot[];
  colors: Color[];
  /** Seconds between arrivals. */
  period: number;
  approachTime: number;
  /** Seconds into a cycle when every plane on the ground is parked. */
  parked: number;
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
  const middle = trackAt(forward, forward.length / 2, new Vector3());
  const mapped = mappedSpots(airport, frame, ground);
  let candidates =
    mapped.length > 0 ? mapped : apronSpots(airport, frame, ground, middle);
  let spots = spreadSpots(candidates);
  let ways = [
    wayOf(forward, network, spots, ground),
    wayOf(backward, network, spots, ground),
  ];
  // Leave out stands that would block others, and pick again.
  for (let blocker = inTheWay(ways, spots); blocker !== undefined;) {
    const dropped = spots[blocker];
    candidates = candidates.filter((spot) => spot !== dropped);
    spots = spreadSpots(candidates);
    ways = [
      wayOf(forward, network, spots, ground),
      wayOf(backward, network, spots, ground),
    ];
    blocker = inTheWay(ways, spots);
  }
  if (spots.length === 0) {
    return undefined;
  }
  // Each cycle a plane lands; the plane parked at the next stand pushes back
  // once it can keep clear of that landing, and takes off just before the
  // next one lands, the same way. The cycle fits the tightest pair of them.
  const approachTime = APPROACH / APPROACH_SPEED;
  const pairs = ways.flatMap((way) =>
    spots.map((_, spot) => {
      const next = (spot + 1) % spots.length;
      const leave = leaveTime(way.departures[next] as Departure) + LINE_UP;
      return {
        landing: arrivalSamples(way, spot),
        // Its roll waits for the landing to leave the runway; a single
        // stand's plane has to park first.
        least:
          spots.length === 1
            ? arrival(way, spot)
            : rollTime(way.exit - TOUCHDOWN) - leave,
        leave,
        leaving: departureSamples(way, next),
      };
    })
  );
  // A cycle's departure pushes back `cycle - SEPARATION - leave` seconds after
  // the landing before it: find the shortest cycle that's clear for all.
  let cycle =
    Math.max(...pairs.map((pair) => pair.least + pair.leave)) + SEPARATION;
  const clear = (length: number) =>
    pairs.every((pair) => {
      const gap = Math.floor(length - SEPARATION - pair.leave);
      return gap >= pair.least && clearOf(pair.landing, pair.leaving, gap);
    });
  while (!clear(cycle)) {
    cycle += 1;
  }
  return {
    approachTime,
    colors: TAILS.map((hex) => new Color().setHex(hex, SRGBColorSpace)),
    parked:
      approachTime +
      Math.max(
        ...ways.flatMap((way) => spots.map((_, spot) => arrival(way, spot)))
      ) +
      5,
    period: Math.max(120, cycle + 5),
    spots,
    ways,
  };
}

interface Pose {
  position: Vector3;
  heading: number;
  pitch: number;
  /** 0 to 1: fading in or out of view. */
  shown: number;
  /** 0 on the ground to 1 in the air, where planes grow with distance. */
  air: number;
  /** 0 to 1: how hard its engines run. */
  thrust: number;
}

/** The direction in use: it changes now and then, as the wind would. */
function wayIndex(cycle: number): number {
  return hash(Math.floor(cycle / 7), 41) < 0.5 ? 0 : 1;
}

/**
 * Whether a cycle has a landing. When the direction changes nothing lands,
 * so the runway can turn round: that cycle's departure still leaves the old
 * way, clear of the landing before it.
 */
function lands(cycle: number): boolean {
  return wayIndex(cycle) === wayIndex(cycle - 1);
}

/** The stand a cycle's plane parks at: each in turn. */
function spotOf(plan: Plan, cycle: number): number {
  const count = plan.spots.length;
  return ((cycle % count) + count) % count;
}

function arrivalPose(
  plan: Plan,
  cycle: number,
  t: number,
  pose: Pose
): boolean {
  const way = plan.ways[wayIndex(cycle)] as Way;
  const spot = spotOf(plan, cycle);
  const roll = rollTime(way.exit - TOUCHDOWN);
  const taxi = way.taxiIn[spot] as TaxiIn;
  if (t < plan.approachTime) {
    trackAt(way.approach, t * APPROACH_SPEED, pose.position);
    pose.heading = trackHeading(way.runway, 0);
    pose.pitch = 3 * RADIANS;
    pose.shown = Math.min(1, t / FADE);
    pose.air = 1;
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
    pose.air = Math.max(0, 1 - rolling / GROW_TIME);
    // Reverse thrust as the wheels touch, easing off as it slows.
    pose.thrust = 0.35 + 0.55 * (1 - rolling / roll);
    return true;
  }
  const taxiing = rolling - roll;
  const parked = taxiing >= taxiInTime(taxi);
  const s = parked ? taxi.track.length : taxiInAt(taxi, taxiing);
  trackAt(taxi.track, s, pose.position);
  pose.heading = parked
    ? (plan.spots[spot] as Spot).heading
    : trackHeading(taxi.track, s, s > taxi.lead ? 6 : 18);
  pose.thrust = parked ? 0 : 0.25;
  return true;
}

/**
 * A plane leaves once its stand comes round again: it pushes back, taxis,
 * and starts its takeoff roll a little before that cycle's arrival lands.
 */
function scheduleOf(plan: Plan, cycle: number) {
  const later = cycle + plan.spots.length;
  const way = plan.ways[wayIndex(lands(later) ? later : later - 1)] as Way;
  const departure = way.departures[spotOf(plan, cycle)] as Departure;
  const takeoff =
    plan.spots.length * plan.period + plan.approachTime - SEPARATION;
  return {
    departure,
    pushStart: takeoff - LINE_UP - leaveTime(departure),
    takeoff,
    way,
  };
}

function departurePose(
  plan: Plan,
  cycle: number,
  t: number,
  pose: Pose
): boolean {
  const { departure, takeoff, pushStart, way } = scheduleOf(plan, cycle);
  const { push, taxi } = departure;
  const pushing = (t - pushStart) * PUSH_SPEED;
  if (pushing < push.length) {
    trackAt(push, pushing, pose.position);
    // Tail first: the nose points back where it came from.
    pose.heading = trackHeading(push, pushing, 6) + Math.PI;
    return true;
  }
  const taxiStart = pushStart + push.length / PUSH_SPEED + UNHITCH;
  if (t < takeoff) {
    const s = Math.max(0, Math.min(taxi.length, (t - taxiStart) * TAXI_SPEED));
    trackAt(taxi, s, pose.position);
    pose.heading =
      s >= taxi.length
        ? trackHeading(way.runway, departure.entry)
        : trackHeading(taxi, s);
    pose.thrust = t < taxiStart ? 0.1 : 0.25;
    return true;
  }
  const rolling = t - takeoff;
  if (rolling < TAKEOFF_TIME) {
    const s =
      departure.entry + (ROTATE_SPEED / TAKEOFF_TIME) * rolling * rolling * 0.5;
    trackAt(way.runway, s, pose.position);
    pose.heading = trackHeading(way.runway, s);
    pose.pitch = Math.max(0, (rolling - TAKEOFF_TIME + 3) / 3) * 8 * RADIANS;
    pose.air = Math.max(0, 1 - (TAKEOFF_TIME - rolling) / GROW_TIME);
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
  pose.air = 1;
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
  pose.air = 0;
  pose.shown = 1;
  pose.thrust = 0;
  return t < scheduleOf(plan, cycle).pushStart
    ? arrivalPose(plan, cycle, t, pose)
    : departurePose(plan, cycle, t, pose);
}

/** What a cycle's plane is: mostly jets, now and then a turboprop. */
function typeOf(cycle: number): number {
  return hash(cycle, 17) < 0.3 ? 1 : 0;
}

/**
 * Planes at each airport: each cycle one lands, taxis to a stand and parks
 * there while the stands go round; when its stand comes up again it pushes
 * back, taxis out and takes off, just before the next one lands. In the air
 * they grow with distance, so they still read from across the island.
 */
export class Planes {
  readonly group = new Group();
  /** Each plane's engines, where it is. */
  readonly voices: Voice[];
  private readonly plans: Plan[];
  /** One fleet per kind of plane, each with a slot for every plane. */
  private readonly fleets: Fleet[];
  private readonly pose: Pose = {
    air: 0,
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
    shapes: BufferGeometry[],
    shared: SharedUniforms,
    shadows: boolean
  ) {
    this.group.name = "planes";
    this.plans = airports.flatMap((airport) => {
      const plan = planOf(airport, frame, ground);
      return plan ? [plan] : [];
    });
    const slots = this.plans.reduce(
      (sum, plan) => sum + plan.spots.length + 2,
      0
    );
    this.fleets = shapes.map(
      (shape) => new Fleet(shape, shared, slots, shadows)
    );
    this.voices = createVoices(slots);
    this.group.add(...this.fleets.map((fleet) => fleet.mesh));
  }

  /** `life` in seconds; frozen, planes stay parked. */
  update(life: number, camera: Vector3, frozen: boolean): void {
    let slot = 0;
    for (const plan of this.plans) {
      const time = frozen ? plan.period * 100 + plan.parked : life;
      const latest = Math.floor(time / plan.period);
      // Every plane on the ground, the one landing and the one leaving.
      for (
        let cycle = latest - plan.spots.length - 1;
        cycle <= latest;
        cycle += 1
      ) {
        this.place(plan, cycle, time - cycle * plan.period, slot, camera);
        // Standing still, a plane in the air would look stuck there.
        if (frozen && this.pose.air > 0) {
          this.hide(slot);
        }
        slot += 1;
      }
    }
  }

  private hide(slot: number) {
    for (const fleet of this.fleets) {
      fleet.hide(slot);
    }
    (this.voices[slot] as Voice).level = 0;
  }

  private place(
    plan: Plan,
    cycle: number,
    t: number,
    slot: number,
    camera: Vector3
  ) {
    const { pose } = this;
    pose.air = 0;
    if (t < 0 || !lands(cycle) || !poseOf(plan, cycle, t, pose)) {
      this.hide(slot);
      return;
    }
    const voice = this.voices[slot] as Voice;
    voice.position.copy(pose.position);
    voice.level = pose.thrust * pose.shown;
    // Bigger from far off in the air, so a plane never shrinks to nothing;
    // on the ground they keep their size, among the others parked.
    const far = Math.min(
      6,
      Math.max(1, pose.position.distanceTo(camera) / 1800)
    );
    const grow = (1 + (far - 1) * pose.air) * pose.shown;
    this.euler.set(-pose.pitch, pose.heading, 0);
    this.rotation.setFromEuler(this.euler);
    this.scale.setScalar(grow);
    this.matrix.compose(pose.position, this.rotation, this.scale);
    const type = typeOf(cycle) % this.fleets.length;
    for (const [index, fleet] of this.fleets.entries()) {
      if (index === type) {
        fleet.set(
          slot,
          this.matrix,
          plan.colors[Math.floor(hash(cycle, 3) * plan.colors.length)]
        );
      } else {
        fleet.hide(slot);
      }
    }
  }

  dispose(): void {
    for (const fleet of this.fleets) {
      fleet.dispose();
    }
  }
}
