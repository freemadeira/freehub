import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import type {
  Landmark,
  WorldManifest,
} from "../../../src/features/map/engine/format.ts";
import { WORLD_FORMAT } from "../../../src/features/map/engine/format.ts";
import { createFrame } from "../../../src/features/map/engine/geo.ts";
import { airportsOf } from "./airports.ts";
import { loadConfig } from "./config.ts";
import {
  coverFile,
  coverTiles,
  demFile,
  demTiles,
  fetchSources,
} from "./fetch.ts";
import { readOsm } from "./osm.ts";
import {
  distanceToLand,
  encodeGray,
  encodeHeights,
  extentOf,
  heights,
  landcover,
  landMask,
  sampleHeight,
  seaGrid,
} from "./rasters.ts";
import { writeTiles } from "./tiles.ts";

const MASK_STEP = 10;
const HEIGHT_STEP = 25;
const COVER_STEP = 15;
const SEA_STEP = 20;
/** Sea distances beyond this many meters all read as open sea. */
const SEA_MAX = 3000;
const HEIGHT_SCALE = 0.1;
const HEIGHT_OFFSET = -100;

const ATTRIBUTION = [
  "© OpenStreetMap contributors, ODbL",
  "Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA",
  "ESA WorldCover 2021, CC BY 4.0",
];

function timer() {
  const start = performance.now();
  return () => `${((performance.now() - start) / 1000).toFixed(1)}s`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      cache: { type: "string" },
      config: { type: "string" },
      out: { type: "string" },
      refresh: { type: "boolean" },
    },
  });
  if (!values.config) {
    console.error(
      "Usage: pnpm bake --config path/to/world.config.json [--out dir] [--cache dir] [--refresh]"
    );
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(values.config);
  const out = path.resolve(values.out ?? path.join(config.root, "dist"));
  const cache = path.resolve(values.cache ?? path.join(config.root, ".cache"));
  const frame = createFrame(config.origin);
  const elapsed = timer();

  await fetchSources(config, cache, values.refresh ?? false);
  console.log(`Reading OpenStreetMap… (${elapsed()})`);
  const osm = await readOsm(cache);
  console.log(
    `  ${osm.buildings.length} buildings, ${osm.roads.length} roads, ${osm.landuse.length} areas, ${osm.trees.length} trees, ${osm.land.length} land polygons, ${osm.airports.length} airports, ${osm.ferries.length} ferry routes`
  );

  await rm(out, { force: true, recursive: true });
  await mkdir(out, { recursive: true });

  console.log(`Rasters… (${elapsed()})`);
  const landExtent = extentOf(frame, config.bounds, 1000);
  const seaExtent = extentOf(frame, config.bounds, 5000);
  const mask = landMask(frame, seaExtent, osm.land, MASK_STEP);
  const cover = await landcover(
    frame,
    landExtent,
    coverTiles(config).map((tile) => coverFile(cache, tile.name)),
    mask,
    config.bounds,
    COVER_STEP
  );
  const heightGrid = await heights(
    frame,
    landExtent,
    demTiles(config).map((tile) => demFile(cache, tile.name)),
    mask,
    cover,
    HEIGHT_STEP
  );
  const sea = seaGrid(seaExtent, mask, distanceToLand(mask), SEA_STEP, SEA_MAX);
  await writeFile(
    path.join(out, "heights.bin"),
    encodeHeights(heightGrid, HEIGHT_SCALE, HEIGHT_OFFSET)
  );
  await writeFile(path.join(out, "landcover.png"), encodeGray(cover));
  await writeFile(path.join(out, "sea.png"), encodeGray(sea));

  console.log(`Vector tiles… (${elapsed()})`);
  const elevation = (mx: number, my: number) =>
    sampleHeight(
      heightGrid,
      (mx - frame.mx) * frame.scale,
      (my - frame.my) * frame.scale
    );
  const available = await writeTiles(
    osm,
    config.zooms,
    config.origin.lat,
    elevation,
    out
  );

  const landmarks: Landmark[] = [];
  if (config.landmarks.length > 0) {
    await mkdir(path.join(out, "landmarks"), { recursive: true });
  }
  for (const landmark of config.landmarks) {
    const model = `landmarks/${path.basename(landmark.model)}`;
    // oxlint-disable-next-line no-await-in-loop
    await copyFile(
      path.resolve(config.root, landmark.model),
      path.join(out, model)
    );
    let badge: string | undefined;
    if (landmark.badge) {
      badge = `landmarks/${path.basename(landmark.badge)}`;
      // oxlint-disable-next-line no-await-in-loop
      await copyFile(
        path.resolve(config.root, landmark.badge),
        path.join(out, badge)
      );
    }
    landmarks.push({
      badge,
      clear: landmark.clear ?? 25,
      heading: landmark.heading ?? 0,
      id: landmark.id,
      lat: landmark.lat,
      lng: landmark.lng,
      model,
      name: landmark.name,
    });
  }

  const [west, south, east, north] = config.bounds;
  const within = (lat: number, lng: number) =>
    lat >= south && lat <= north && lng >= west && lng <= east;
  const manifest: WorldManifest = {
    aerialways: osm.aerialways,
    airports: airportsOf(osm.airports, elevation),
    attribution: ATTRIBUTION,
    bounds: config.bounds,
    ferries: osm.ferries,
    format: WORLD_FORMAT,
    heights: {
      height: heightGrid.height,
      offset: HEIGHT_OFFSET,
      scale: HEIGHT_SCALE,
      step: heightGrid.step,
      url: "heights.bin",
      width: heightGrid.width,
      x: heightGrid.x,
      z: heightGrid.z,
    },
    landcover: {
      height: cover.height,
      step: cover.step,
      url: "landcover.png",
      width: cover.width,
      x: cover.x,
      z: cover.z,
    },
    landmarks,
    name: config.name,
    origin: config.origin,
    // Hamlets and localities would crowd the labels; peaks and towns stay.
    places: osm.places.filter(
      (place) =>
        within(place.lat, place.lng) &&
        place.kind !== "hamlet" &&
        place.kind !== "locality"
    ),
    sea: {
      height: sea.height,
      max: SEA_MAX,
      step: sea.step,
      url: "sea.png",
      width: sea.width,
      x: sea.x,
      z: sea.z,
    },
    tiles: {
      available,
      url: "tiles/{z}/{x}/{y}.mvt",
      zooms: config.zooms,
    },
    view: config.view,
  };
  await writeFile(
    path.join(out, "world.json"),
    `${JSON.stringify(manifest)}\n`
  );
  console.log(`Done in ${elapsed()}: ${out}`);
}

await main();
