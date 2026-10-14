import {
  CABIN_DROP,
  ROPE_GAP,
  sagAt,
} from "../../../src/features/map/engine/cable.ts";
import type {
  AerialPoint,
  Aerialway,
} from "../../../src/features/map/engine/format.ts";
import type { Frame, Point } from "../../../src/features/map/engine/geo.ts";
import { toLocal } from "../../../src/features/map/engine/geo.ts";
import { tallestOf } from "../../../src/features/map/engine/worker/building-plan.ts";
import type { AerialwayData, AreaFeature } from "./osm.ts";

/** Meters a station holds its cable over the ground: cabins board at its floor. */
const STATION = 7;
/** The shortest and tallest pylons, in meters. */
const LOWEST = 10;
const TALLEST = 110;
/** Meters between a cabin's floor and anything under it. */
const CLEARANCE = 3;
/** Meters between checks along a span. */
const STEP = 4;
/** Buildings this close to a station are taken for it. */
const STATION_REACH = 14;

type Ground = (x: number, z: number) => number;

interface Obstacle {
  ring: Point[];
  box: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Meters above sea level of its roof's highest point, at most. */
  top: number;
}

function ringArea(ring: Point[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const a = ring[index] as Point;
    const b = ring[index + 1] as Point;
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum / 2);
}

function inside(point: Point, ring: Point[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] as Point;
    const b = ring[j] as Point;
    if (
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
    ) {
      result = !result;
    }
  }
  return result;
}

function distanceToRing(point: Point, ring: Point[]): number {
  if (inside(point, ring)) {
    return 0;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const a = ring[index] as Point;
    const b = ring[index + 1] as Point;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = dx * dx + dz * dz;
    const t =
      length === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length)
          );
    best = Math.min(
      best,
      Math.hypot(a.x + dx * t - point.x, a.z + dz * t - point.z)
    );
  }
  return best;
}

/** The buildings near a line, with the highest their roofs can reach. */
function obstaclesNear(
  line: Point[],
  buildings: AreaFeature[],
  frame: Frame,
  ground: Ground,
  reach: number
): Obstacle[] {
  const xs = line.map((point) => point.x);
  const zs = line.map((point) => point.z);
  const minX = Math.min(...xs) - reach;
  const maxX = Math.max(...xs) + reach;
  const minZ = Math.min(...zs) - reach;
  const maxZ = Math.max(...zs) + reach;
  const ends = [line[0] as Point, line.at(-1) as Point];
  const result: Obstacle[] = [];
  for (const building of buildings) {
    const [lng0, lat0] = building.polygon.outer[0] ?? [0, 0];
    const first = toLocal(frame, { lat: lat0, lng: lng0 });
    // No building is this big: most are skipped on one corner.
    const size = 400;
    if (
      first.x < minX - size ||
      first.x > maxX + size ||
      first.z < minZ - size ||
      first.z > maxZ + size
    ) {
      continue;
    }
    const ring = building.polygon.outer.map(([lng, lat]) =>
      toLocal(frame, { lat, lng })
    );
    const box = {
      maxX: Math.max(...ring.map((point) => point.x)),
      maxZ: Math.max(...ring.map((point) => point.z)),
      minX: Math.min(...ring.map((point) => point.x)),
      minZ: Math.min(...ring.map((point) => point.z)),
    };
    if (
      box.maxX < minX ||
      box.minX > maxX ||
      box.maxZ < minZ ||
      box.minZ > maxZ
    ) {
      continue;
    }
    // The stations themselves.
    if (ends.some((end) => distanceToRing(end, ring) < STATION_REACH)) {
      continue;
    }
    const floor = Math.max(...ring.map((point) => ground(point.x, point.z)));
    result.push({
      box,
      ring,
      top: floor + tallestOf(building.properties, ringArea(ring)),
    });
  }
  return result;
}

/** The highest thing under a point of the cable, cabins' width included. */
function heightUnder(
  point: Point,
  across: Point,
  obstacles: Obstacle[],
  ground: Ground
): number {
  const reach = ROPE_GAP + 2;
  let top = Number.NEGATIVE_INFINITY;
  for (const side of [-reach, 0, reach]) {
    top = Math.max(
      top,
      ground(point.x + across.x * side, point.z + across.z * side)
    );
  }
  for (const obstacle of obstacles) {
    const { box } = obstacle;
    if (
      point.x < box.minX - reach ||
      point.x > box.maxX + reach ||
      point.z < box.minZ - reach ||
      point.z > box.maxZ + reach ||
      obstacle.top <= top
    ) {
      continue;
    }
    if (distanceToRing(point, obstacle.ring) <= reach) {
      ({ top } = obstacle);
    }
  }
  return top;
}

/**
 * Cable heights at each station and pylon: stations hold the cable a little
 * over their floor, and pylons rise until every cabin clears the ground and
 * the tallest the buildings under it can be.
 */
function lift(
  supports: Point[],
  needs: { t: number; under: number }[][],
  ground: Ground
): number[] {
  const last = supports.length - 1;
  const tops = supports.map(
    (point, index) =>
      ground(point.x, point.z) +
      (index === 0 || index === last ? STATION : LOWEST)
  );
  for (let round = 0; round < 60; round += 1) {
    let raised = false;
    for (let span = 0; span < last; span += 1) {
      const a = supports[span] as Point;
      const b = supports[span + 1] as Point;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      let worst = 0;
      let at = 0;
      for (const { t, under } of needs[span] ?? []) {
        const cable =
          (tops[span] as number) * (1 - t) +
          (tops[span + 1] as number) * t -
          sagAt(length, t);
        const short = under + CABIN_DROP + CLEARANCE - cable;
        if (short > worst) {
          worst = short;
          at = t;
        }
      }
      if (worst <= 0.01) {
        continue;
      }
      // Raise the pylons at either end, the nearer more; stations stay put.
      const wa = span === 0 ? 0 : 1 - at;
      const wb = span + 1 === last ? 0 : at;
      const norm = wa * wa + wb * wb;
      if (norm < 1e-6) {
        continue;
      }
      tops[span] = (tops[span] ?? 0) + (worst * wa) / norm;
      tops[span + 1] = (tops[span + 1] ?? 0) + (worst * wb) / norm;
      raised = true;
    }
    for (let index = 1; index < last; index += 1) {
      const point = supports[index] as Point;
      const floor = ground(point.x, point.z);
      tops[index] = Math.min(floor + TALLEST, tops[index] as number);
    }
    if (!raised) {
      break;
    }
  }
  return tops;
}

/**
 * Cable cars and lifts for the manifest: their stations and pylons, each
 * with the height its cable runs at.
 */
export function liftAerialways(
  lifts: AerialwayData[],
  buildings: AreaFeature[],
  frame: Frame,
  ground: Ground
): Aerialway[] {
  return lifts.map((data) => {
    const line = data.line.map(([lng, lat]) => toLocal(frame, { lat, lng }));
    const supports = data.supports.map((index) => line[index] as Point);
    const obstacles = obstaclesNear(
      line,
      buildings,
      frame,
      ground,
      ROPE_GAP + 10
    );
    const needs = supports.slice(0, -1).map((a, span) => {
      const b = supports[span + 1] as Point;
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const across = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
      const count = Math.max(2, Math.ceil(length / STEP));
      return Array.from({ length: count - 1 }, (_, step) => {
        const t = (step + 1) / count;
        const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        return { t, under: heightUnder(point, across, obstacles, ground) };
      });
    });
    const tops = lift(supports, needs, ground);
    const path: AerialPoint[] = data.supports.map((index, support) => {
      const [lng, lat] = data.line[index] ?? [0, 0];
      return { ele: Math.round((tops[support] ?? 0) * 10) / 10, lat, lng };
    });
    return { kind: data.kind, name: data.name, path };
  });
}
