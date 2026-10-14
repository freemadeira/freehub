import type {
  AirPoint,
  Airport,
  LngLat,
  Runway,
  Stand,
} from "../../../src/features/map/engine/format.ts";
import { mercatorX, mercatorY } from "../../../src/features/map/engine/geo.ts";
import type { Vec } from "./geometry.ts";
import { isClosed } from "./geometry.ts";
import type { AirportData, LineFeature } from "./osm.ts";
import type { Elevation } from "./tiles.ts";
import { deckOf } from "./tiles.ts";

/** A way's points, with the deck height the tiles give it on a bridge. */
function pointsOf(feature: LineFeature, elevation: Elevation): AirPoint[] {
  const points = feature.line.map(([lng, lat]) => ({ lat, lng }));
  if (feature.properties.bridge !== 1) {
    return points;
  }
  const projected = feature.line.map(
    ([lng, lat]) => [mercatorX(lng), mercatorY(lat)] as [number, number]
  );
  const deck = deckOf(projected, elevation);
  return points.map((point, index) => ({
    ...point,
    deck: deck(projected[index] ?? [0, 0]),
  }));
}

function same(a: AirPoint | undefined, b: AirPoint | undefined): boolean {
  return (
    a !== undefined && b !== undefined && a.lat === b.lat && a.lng === b.lng
  );
}

/** Joins a runway's ways end to end. */
function join(parts: AirPoint[][]): AirPoint[][] {
  const paths: AirPoint[][] = [];
  const open = [...parts];
  while (open.length > 0) {
    const path = [...(open.pop() ?? [])];
    for (;;) {
      const index = open.findIndex(
        (part) =>
          same(path.at(-1), part[0]) ||
          same(path.at(-1), part.at(-1)) ||
          same(path[0], part[0]) ||
          same(path[0], part.at(-1))
      );
      const part = open[index];
      if (!part) {
        break;
      }
      open.splice(index, 1);
      if (same(path.at(-1), part[0])) {
        path.push(...part.slice(1));
      } else if (same(path.at(-1), part.at(-1))) {
        path.push(...part.toReversed().slice(1));
      } else if (same(path[0], part.at(-1))) {
        path.unshift(...part.slice(0, -1));
      } else {
        path.unshift(...part.toReversed().slice(0, -1));
      }
    }
    paths.push(path);
  }
  return paths;
}

function runwaysOf(data: AirportData, elevation: Elevation): Runway[] {
  const byRef = new Map<string, LineFeature[]>();
  for (const way of data.runways) {
    const ref = String(way.properties.ref ?? "");
    byRef.set(ref, [...(byRef.get(ref) ?? []), way]);
  }
  return [...byRef].flatMap(([ref, ways]) => {
    const widths = ways.flatMap((way) =>
      typeof way.properties.width === "number" ? [way.properties.width] : []
    );
    return join(ways.map((way) => pointsOf(way, elevation))).map((path) => ({
      path,
      ref: ref || undefined,
      width: widths.length > 0 ? Math.max(...widths) : undefined,
    }));
  });
}

function distanceToLines(point: Vec, lines: Vec[][]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      const [ax, ay] = line[index - 1] ?? [0, 0];
      const [bx, by] = line[index] ?? [0, 0];
      const dx = bx - ax;
      const dy = by - ay;
      const length = dx * dx + dy * dy;
      const t =
        length === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((point[0] - ax) * dx + (point[1] - ay) * dy) / length
              )
            );
      best = Math.min(
        best,
        Math.hypot(ax + dx * t - point[0], ay + dy * t - point[1])
      );
    }
  }
  return best;
}

/** Meters a stand's lead line reaches back from where the nose stops. */
const LEAD = 60;
/** Stands whose noses stop closer than this are the same one, mapped twice. */
const SAME_STAND = 25;

/** The way an outline is longest, through its middle, and how far it reaches. */
function axisOf(ring: Vec[]): { center: Vec; unit: Vec; reach: number } {
  const center: Vec = [
    ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
  ];
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const [x, y] of ring) {
    xx += (x - center[0]) ** 2;
    xy += (x - center[0]) * (y - center[1]);
    yy += (y - center[1]) ** 2;
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const unit: Vec = [Math.cos(angle), Math.sin(angle)];
  const reach = Math.max(
    0,
    ...ring.map(
      ([x, y]) => (x - center[0]) * unit[0] + (y - center[1]) * unit[1]
    )
  );
  return { center, reach, unit };
}

/**
 * Stands from OSM's parking positions. Lead lines run from the taxiway to
 * where the nose stops, whichever way OSM drew them; outlines and points
 * point their nose away from the nearest taxiway.
 */
function standsOf(data: AirportData): Stand[] {
  const origin = data.runways[0]?.line[0] ?? [0, 0];
  const east = 111_320 * Math.cos((origin[1] * Math.PI) / 180);
  const local = ([lng, lat]: Vec): Vec => [
    (lng - origin[0]) * east,
    (lat - origin[1]) * 110_574,
  ];
  const back = ([x, y]: Vec): LngLat => ({
    lat: origin[1] + y / 110_574,
    lng: origin[0] + x / east,
  });
  const taxiways = data.taxiways.map((way) => way.line.map(local));
  const away = (point: Vec) => distanceToLines(point, taxiways);
  const leads: Vec[][] = [];
  const taken = (stop: Vec) =>
    leads.some((other) => {
      const [x, y] = other.at(-1) ?? [0, 0];
      return Math.hypot(x - stop[0], y - stop[1]) < SAME_STAND;
    });
  // Lines first: they say exactly where planes go.
  const shapes = data.stands
    .map((shape) => shape.map(local))
    .toSorted(
      (a, b) =>
        Number(a.length < 2 || isClosed(a)) -
        Number(b.length < 2 || isClosed(b))
    );
  for (const shape of shapes) {
    if (shape.length >= 2 && !isClosed(shape)) {
      const lead =
        away(shape[0] as Vec) > away(shape.at(-1) as Vec)
          ? shape.toReversed()
          : shape;
      if (!taken(lead.at(-1) as Vec)) {
        leads.push(lead);
      }
      continue;
    }
    const ring = isClosed(shape) ? shape.slice(0, -1) : shape;
    const { center } = axisOf(ring);
    let { reach, unit } = axisOf(ring);
    if (ring.length < 3) {
      // A point: nose away from the taxiway.
      const step = 5;
      const [x, y] = center;
      const gx = away([x + step, y]) - away([x - step, y]);
      const gy = away([x, y + step]) - away([x, y - step]);
      const length = Math.hypot(gx, gy) || 1;
      unit = [gx / length, gy / length];
      reach = 0;
    }
    const ahead = away([center[0] + unit[0] * 10, center[1] + unit[1] * 10]);
    const behind = away([center[0] - unit[0] * 10, center[1] - unit[1] * 10]);
    if (ahead < behind) {
      unit = [-unit[0], -unit[1]];
    }
    const stop: Vec = [
      center[0] + unit[0] * Math.max(0, reach - 3),
      center[1] + unit[1] * Math.max(0, reach - 3),
    ];
    // An outline mapped over a lead line already taken.
    const covered = leads.some((other) => {
      const [x, y] = other.at(-1) ?? [0, 0];
      return (
        Math.hypot(x - center[0], y - center[1]) < Math.max(SAME_STAND, reach)
      );
    });
    if (!covered && !taken(stop)) {
      leads.push([[stop[0] - unit[0] * LEAD, stop[1] - unit[1] * LEAD], stop]);
    }
  }
  return leads.map((lead) => ({ lead: lead.map(back) }));
}

/** Airports for the manifest: what the planes need, deck heights included. */
export function airportsOf(
  data: AirportData[],
  elevation: Elevation
): Airport[] {
  return data.map((airport) => {
    const stands = standsOf(airport);
    return {
      aprons: airport.aprons.map((polygon) =>
        polygon.outer.map(([lng, lat]) => ({ lat, lng }))
      ),
      name: airport.name,
      runways: runwaysOf(airport, elevation),
      stands: stands.length > 0 ? stands : undefined,
      taxiways: airport.taxiways.map((way) => pointsOf(way, elevation)),
    };
  });
}
