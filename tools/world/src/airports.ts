import type {
  AirPoint,
  Airport,
  Runway,
} from "../../../src/features/map/engine/format.ts";
import { mercatorX, mercatorY } from "../../../src/features/map/engine/geo.ts";
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

/** Airports for the manifest: what the planes need, deck heights included. */
export function airportsOf(
  data: AirportData[],
  elevation: Elevation
): Airport[] {
  return data.map((airport) => ({
    aprons: airport.aprons.map((polygon) =>
      polygon.outer.map(([lng, lat]) => ({ lat, lng }))
    ),
    name: airport.name,
    runways: runwaysOf(airport, elevation),
    taxiways: airport.taxiways.map((way) => pointsOf(way, elevation)),
  }));
}
