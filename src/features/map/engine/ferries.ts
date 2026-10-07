import type { BufferGeometry } from "three";
import {
  Color,
  Group,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";

import { Fleet } from "./fleet.ts";
import type { Bounds, Ferry, Grid } from "./format.ts";
import type { Frame, Point } from "./geo.ts";
import { toLocal } from "./geo.ts";
import type { SharedUniforms } from "./materials.ts";
import { hash } from "./random.ts";

/** Meters a second, and seconds at the quay, away out of sight, turning. */
const SPEED = 10;
const DWELL = 150;
const AWAY = 420;
const TURN = 40;
const FADE = 1500;
const BOATS = 2;
/** Half a ferry's length and beam, with room to spare: what has to float. */
const HALF_LENGTH = 62;
const HALF_BEAM = 13;
const HULLS = [0x2f_5d_9e, 0x1f_7a_8c, 0x34_4a_7a, 0xc8_4b_4b];

/** A route as far as the map's sea reaches, starting at its port. */
interface Run {
  points: Point[];
  along: number[];
  length: number;
  /** Both ends in port: shuttling, never out of sight. */
  shuttle: boolean;
  hull: Color;
}

function inBounds(point: { lat: number; lng: number }, bounds: Bounds) {
  const [west, south, east, north] = bounds;
  return (
    point.lng >= west &&
    point.lng <= east &&
    point.lat >= south &&
    point.lat <= north
  );
}

function runAt(
  run: Pick<Run, "along" | "length" | "points">,
  s: number,
  out: Vector3
): number {
  const at = Math.min(run.length, Math.max(0, s));
  let index = 1;
  while (index < run.along.length - 1 && (run.along[index] ?? 0) < at) {
    index += 1;
  }
  const start = run.along[index - 1] ?? 0;
  const end = run.along[index] ?? start;
  const a = run.points[index - 1] ?? { x: 0, z: 0 };
  const b = run.points[index] ?? a;
  const t = end > start ? (at - start) / (end - start) : 0;
  out.set(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
  return Math.atan2(b.x - a.x, b.z - a.z);
}

type Ground = (x: number, z: number) => number;

function measure(points: Point[]): number[] {
  let total = 0;
  return points.map((point, index) => {
    const before = points[index - 1];
    total += before ? Math.hypot(point.x - before.x, point.z - before.z) : 0;
    return total;
  });
}

/**
 * Routes start on the quay; the ship berths at the first spot along the way
 * where all of it floats.
 */
function berthOf(points: Point[], ground: Ground): Point[] {
  const along = measure(points);
  const run = { along, length: along.at(-1) ?? 0, points };
  const at = new Vector3();
  const corner = (s: number, side: number, ahead: number) => {
    const heading = runAt(run, s, at);
    return ground(
      at.x + Math.sin(heading) * ahead + Math.cos(heading) * side,
      at.z + Math.cos(heading) * ahead - Math.sin(heading) * side
    );
  };
  for (let s = 0; s < Math.min(run.length, 800); s += 10) {
    const floats = [-1, 1].every((ahead) =>
      [-1, 0, 1].every(
        (side) => corner(s, side * HALF_BEAM, ahead * HALF_LENGTH) < 0
      )
    );
    if (floats) {
      runAt(run, s, at);
      const rest = points.filter((_, index) => (along[index] ?? 0) > s);
      return [{ x: at.x, z: at.z }, ...rest];
    }
  }
  return points;
}

/** The route from its port up to where it leaves the sea, in local meters. */
function runOf(
  ferry: Ferry,
  frame: Frame,
  bounds: Bounds,
  sea: Grid,
  ground: Ground
): Run | undefined {
  const [first] = ferry.path;
  const last = ferry.path.at(-1);
  if (!first || !last) {
    return undefined;
  }
  const startIn = inBounds(first, bounds);
  const endIn = inBounds(last, bounds);
  if (!startIn && !endIn) {
    return undefined;
  }
  const path = startIn ? ferry.path : ferry.path.toReversed();
  const minX = sea.x;
  const minZ = sea.z;
  const maxX = sea.x + (sea.width - 1) * sea.step;
  const maxZ = sea.z + (sea.height - 1) * sea.step;
  const points: Point[] = [];
  for (const point of path.map((item) => toLocal(frame, item))) {
    points.push(point);
    if (point.x < minX || point.x > maxX || point.z < minZ || point.z > maxZ) {
      break;
    }
  }
  const berthed = berthOf(points, ground);
  const along = measure(berthed);
  const total = along.at(-1) ?? 0;
  return {
    along,
    hull: new Color().setHex(
      HULLS[Math.floor(hash(total, 5) * HULLS.length)] ?? 0x2f_5d_9e,
      SRGBColorSpace
    ),
    length: total,
    points: berthed,
    shuttle: startIn && endIn,
  };
}

function turn(from: number, to: number, t: number): number {
  const delta =
    ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return from + delta * t;
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

interface Pose {
  position: Vector3;
  heading: number;
  shown: number;
}

/**
 * Where a boat is `t` seconds into its round: at the quay, out along the
 * route, away out of sight (or at the far quay), and back.
 */
function poseOf(run: Run, t: number, pose: Pose): boolean {
  const crossing = run.length / SPEED;
  const away = run.shuttle ? DWELL : AWAY;
  const outward = runAt(run, 0, pose.position);
  pose.shown = 1;
  if (t < DWELL) {
    const inward =
      runAt(run, Math.min(run.length, 50), pose.position) + Math.PI;
    runAt(run, 0, pose.position);
    pose.heading = turn(inward, outward, smooth((t - (DWELL - TURN)) / TURN));
    return true;
  }
  const out = t - DWELL;
  if (out < crossing) {
    pose.heading = runAt(run, out * SPEED, pose.position);
    pose.shown = run.shuttle ? 1 : smooth((run.length - out * SPEED) / FADE);
    return true;
  }
  const back = out - crossing - away;
  if (back < 0) {
    pose.heading = runAt(run, run.length, pose.position);
    return run.shuttle;
  }
  pose.heading = runAt(run, run.length - back * SPEED, pose.position) + Math.PI;
  pose.shown = run.shuttle ? 1 : smooth((back * SPEED) / FADE);
  return back < crossing;
}

/** Ferries on their routes, a couple each, growing a little with distance. */
export class Ferries {
  readonly group = new Group();
  private readonly runs: Run[];
  private readonly fleet: Fleet;
  private readonly pose: Pose = {
    heading: 0,
    position: new Vector3(),
    shown: 1,
  };
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly scale = new Vector3();

  constructor(
    ferries: Ferry[],
    frame: Frame,
    bounds: Bounds,
    sea: Grid,
    ground: Ground,
    shape: BufferGeometry,
    shared: SharedUniforms,
    shadows: boolean
  ) {
    this.group.name = "ferries";
    this.runs = ferries.flatMap((ferry) => {
      const run = runOf(ferry, frame, bounds, sea, ground);
      return run && run.length > 200 ? [run] : [];
    });
    this.fleet = new Fleet(shape, shared, this.runs.length * BOATS, shadows);
    this.group.add(this.fleet.mesh);
  }

  /** `life` in seconds; frozen, boats wait at the quay. */
  update(life: number, camera: Vector3, frozen: boolean): void {
    for (const [index, run] of this.runs.entries()) {
      const away = run.shuttle ? DWELL : AWAY;
      const period = DWELL + (2 * run.length) / SPEED + away;
      for (let boat = 0; boat < BOATS; boat += 1) {
        const time = life + (boat * period) / BOATS;
        const slot = index * BOATS + boat;
        if (!frozen) {
          this.place(run, ((time % period) + period) % period, slot, camera);
        } else if (boat === 0) {
          // Standing still, one waits at the quay.
          this.place(run, DWELL / 2, slot, camera);
        } else {
          this.fleet.hide(slot);
        }
      }
    }
  }

  private place(run: Run, t: number, slot: number, camera: Vector3) {
    const { pose } = this;
    if (!poseOf(run, t, pose) || pose.shown <= 0) {
      this.fleet.hide(slot);
      return;
    }
    const grow = Math.min(
      3,
      Math.max(1, pose.position.distanceTo(camera) / 4000)
    );
    this.rotation.setFromAxisAngle(this.up, pose.heading);
    this.scale.setScalar(grow * pose.shown);
    this.matrix.compose(pose.position, this.rotation, this.scale);
    this.fleet.set(slot, this.matrix, run.hull);
  }

  dispose(): void {
    this.fleet.dispose();
  }
}
