import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  Bounds,
  Camera,
  LngLat,
} from "../../../src/features/map/engine/format.ts";

export interface LandmarkConfig extends LngLat {
  id: string;
  name: string;
  /** glTF binary, relative to the config file. */
  model: string;
  /** Round picture for the label, relative to the config file. */
  badge?: string;
  heading?: number;
  /** Meters around the landmark where the map's own buildings are hidden. */
  clear?: number;
}

export interface WorldConfig {
  name: string;
  bounds: Bounds;
  origin: LngLat;
  view: Camera;
  zooms: [number, number, number];
  overpass: string;
  landmarks: LandmarkConfig[];
  /** Folder the config lives in; model and badge paths resolve from here. */
  root: string;
}

const DEFAULT_ZOOMS: [number, number, number] = [11, 13, 15];
const DEFAULT_OVERPASS = "https://overpass-api.de/api/interpreter";

function fail(message: string): never {
  throw new Error(`world config: ${message}`);
}

function number(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`"${name}" must be a number.`);
  }
  return value;
}

function lngLat(value: unknown, name: string): LngLat {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    lat: number(raw.lat, `${name}.lat`),
    lng: number(raw.lng, `${name}.lng`),
  };
}

export async function loadConfig(file: string): Promise<WorldConfig> {
  const raw = JSON.parse(await readFile(file, "utf-8")) as Record<
    string,
    unknown
  >;
  const { bounds } = raw;
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    fail('"bounds" must be [west, south, east, north].');
  }
  const [west, south, east, north] = bounds.map((value, index) =>
    number(value, `bounds[${index}]`)
  ) as Bounds;
  if (!(west < east && south < north)) {
    fail('"bounds" must be [west, south, east, north].');
  }
  const view = (raw.view ?? {}) as Record<string, unknown>;
  const landmarks = Array.isArray(raw.landmarks) ? raw.landmarks : [];
  return {
    bounds: [west, south, east, north],
    landmarks: landmarks.map((item: Record<string, unknown>, index) => ({
      ...lngLat(item, `landmarks[${index}]`),
      badge: typeof item.badge === "string" ? item.badge : undefined,
      clear: typeof item.clear === "number" ? item.clear : undefined,
      heading: typeof item.heading === "number" ? item.heading : undefined,
      id: String(item.id ?? fail(`landmarks[${index}].id is missing.`)),
      model: String(
        item.model ?? fail(`landmarks[${index}].model is missing.`)
      ),
      name: String(item.name ?? item.id),
    })),
    name: typeof raw.name === "string" ? raw.name : "World",
    origin: raw.origin
      ? lngLat(raw.origin, "origin")
      : { lat: (south + north) / 2, lng: (west + east) / 2 },
    overpass:
      typeof raw.overpass === "string" ? raw.overpass : DEFAULT_OVERPASS,
    root: path.dirname(path.resolve(file)),
    view: {
      ...lngLat(view, "view"),
      distance: number(view.distance ?? 3000, "view.distance"),
      heading: number(view.heading ?? 0, "view.heading"),
      pitch: number(view.pitch ?? 50, "view.pitch"),
    },
    zooms: Array.isArray(raw.zooms)
      ? (raw.zooms.map((value, index) => number(value, `zooms[${index}]`)) as [
          number,
          number,
          number,
        ])
      : DEFAULT_ZOOMS,
  };
}
