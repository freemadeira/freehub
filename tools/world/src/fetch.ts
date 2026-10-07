import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { WorldConfig } from "./config.ts";

const USER_AGENT = "freehub-world-bake/0.1";
const RETRY_DELAYS = [30, 60, 120, 240];

/** OSM themes, each one Overpass query. */
export const THEMES = [
  "coastline",
  "points",
  "areas",
  "roads",
  "buildings",
  "routes",
] as const;

export type Theme = (typeof THEMES)[number];

function queryFor(theme: Theme, config: WorldConfig): string {
  const [west, south, east, north] = config.bounds;
  const box = `${south},${west},${north},${east}`;
  const body: Record<Theme, string> = {
    areas: [
      `way["landuse"](${box})`,
      `relation["landuse"]["type"="multipolygon"](${box})`,
      `way["natural"]["natural"!~"^(tree|tree_row|coastline)$"](${box})`,
      `relation["natural"]["type"="multipolygon"](${box})`,
      `way["leisure"](${box})`,
      `relation["leisure"]["type"="multipolygon"](${box})`,
      `way["amenity"~"^(parking|school|university|college|hospital|grave_yard|marketplace)$"](${box})`,
      `way["place"~"^(square|islet)$"](${box})`,
      `way["man_made"~"^(pier|breakwater|groyne|quay)$"](${box})`,
      `way["waterway"](${box})`,
      `way["aeroway"](${box})`,
      `way["tourism"~"^(zoo|theme_park)$"](${box})`,
    ].join(";"),
    buildings: [
      `way["building"](${box})`,
      `relation["building"]["type"="multipolygon"](${box})`,
    ].join(";"),
    coastline: `way["natural"="coastline"](${box})`,
    points: [
      `node["natural"="tree"](${box})`,
      `way["natural"="tree_row"](${box})`,
      `node["place"](${box})`,
      `node["natural"~"^(peak|volcano)$"](${box})`,
      `way["aerialway"](${box})`,
    ].join(";"),
    roads: `way["highway"](${box})`,
    routes: [
      `way["route"="ferry"](${box})`,
      `relation["route"="ferry"](${box})`,
    ].join(";"),
  };
  return `[out:json][timeout:300][maxsize:536870912];(${body[theme]};);out geom;`;
}

async function exists(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.size > 0;
  } catch {
    return false;
  }
}

/** Downloads to a temporary name first, so a cut-off run never looks cached. */
async function download(
  file: string,
  request: () => Promise<Response>,
  check: (body: Uint8Array) => string | undefined
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    let problem: string | undefined;
    try {
      // oxlint-disable-next-line no-await-in-loop -- retries must wait in turn
      const response = await request();
      // oxlint-disable-next-line no-await-in-loop
      const body = new Uint8Array(await response.arrayBuffer());
      problem = response.ok ? check(body) : `HTTP ${response.status}`;
      if (!problem) {
        // oxlint-disable-next-line no-await-in-loop
        await writeFile(`${file}.part`, body);
        // oxlint-disable-next-line no-await-in-loop
        await rename(`${file}.part`, file);
        return;
      }
    } catch (error) {
      problem = String(error);
    }
    const delay = RETRY_DELAYS[attempt];
    if (delay === undefined) {
      throw new Error(`${path.basename(file)}: ${problem}`);
    }
    console.log(`  ${path.basename(file)}: ${problem}; retrying in ${delay}s`);
    // oxlint-disable-next-line no-await-in-loop
    await sleep(delay * 1000);
  }
}

function overpassProblem(body: Uint8Array): string | undefined {
  const text = new TextDecoder().decode(body.subarray(0, 400));
  if (!text.trimStart().startsWith("{")) {
    return "Overpass is busy";
  }
  // Timeouts come back as JSON with a remark and only part of the data.
  const tail = new TextDecoder().decode(body.subarray(-600));
  return tail.includes('"remark"') ? "Overpass gave partial data" : undefined;
}

function tiffProblem(body: Uint8Array): string | undefined {
  const intel = body[0] === 0x49 && body[1] === 0x49;
  const motorola = body[0] === 0x4d && body[1] === 0x4d;
  return intel || motorola ? undefined : "not a GeoTIFF";
}

function degrees(
  value: number,
  positive: string,
  negative: string,
  width: number
) {
  const whole = Math.abs(value);
  return `${value < 0 ? negative : positive}${String(whole).padStart(width, "0")}`;
}

/** Copernicus GLO-30 tiles are one degree square, named by their south-west corner. */
export function demTiles(config: WorldConfig): { name: string; url: string }[] {
  const [west, south, east, north] = config.bounds;
  const tiles: { name: string; url: string }[] = [];
  for (let lat = Math.floor(south); lat < north; lat += 1) {
    for (let lng = Math.floor(west); lng < east; lng += 1) {
      const id = `Copernicus_DSM_COG_10_${degrees(lat, "N", "S", 2)}_00_${degrees(lng, "E", "W", 3)}_00_DEM`;
      tiles.push({
        name: `${degrees(lat, "N", "S", 2)}${degrees(lng, "E", "W", 3)}`,
        url: `https://copernicus-dem-30m.s3.amazonaws.com/${id}/${id}.tif`,
      });
    }
  }
  return tiles;
}

/** ESA WorldCover tiles are three degrees square. */
export function coverTiles(
  config: WorldConfig
): { name: string; url: string }[] {
  const [west, south, east, north] = config.bounds;
  const tiles: { name: string; url: string }[] = [];
  for (let lat = Math.floor(south / 3) * 3; lat < north; lat += 3) {
    for (let lng = Math.floor(west / 3) * 3; lng < east; lng += 3) {
      const name = `${degrees(lat, "N", "S", 2)}${degrees(lng, "E", "W", 3)}`;
      tiles.push({
        name,
        url: `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`,
      });
    }
  }
  return tiles;
}

export function osmFile(cache: string, theme: Theme): string {
  return path.join(cache, "osm", `${theme}.json`);
}

export function demFile(cache: string, name: string): string {
  return path.join(cache, "dem", `${name}.tif`);
}

export function coverFile(cache: string, name: string): string {
  return path.join(cache, `worldcover-${name}.tif`);
}

/** Fetches whatever the cache lacks, or everything with `refresh`. */
export async function fetchSources(
  config: WorldConfig,
  cache: string,
  refresh: boolean
): Promise<void> {
  for (const theme of THEMES) {
    const file = osmFile(cache, theme);
    // oxlint-disable-next-line no-await-in-loop -- Overpass allows one query at a time
    if (refresh || !(await exists(file))) {
      console.log(`Downloading OSM ${theme}…`);
      // oxlint-disable-next-line no-await-in-loop
      await download(
        file,
        () =>
          fetch(config.overpass, {
            body: new URLSearchParams({ data: queryFor(theme, config) }),
            headers: { "User-Agent": USER_AGENT },
            method: "POST",
          }),
        overpassProblem
      );
    }
  }
  const rasters = [
    ...demTiles(config).map((tile) => ({
      ...tile,
      file: demFile(cache, tile.name),
    })),
    ...coverTiles(config).map((tile) => ({
      ...tile,
      file: coverFile(cache, tile.name),
    })),
  ];
  for (const tile of rasters) {
    // oxlint-disable-next-line no-await-in-loop
    if (refresh || !(await exists(tile.file))) {
      console.log(`Downloading ${path.basename(tile.url)}…`);
      // oxlint-disable-next-line no-await-in-loop
      await download(tile.file, () => fetch(tile.url), tiffProblem);
    }
  }
}
