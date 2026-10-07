import type { Grid } from "../format.ts";
import { COVER } from "../format.ts";
import type { Frame, Square, TileId } from "../geo.ts";
import { ancestor, createFrame, tileAt, tileSquare } from "../geo.ts";
import { HeightField } from "../heights.ts";
import { buffersOf } from "../mesh.ts";
import { PALETTE } from "../palette.ts";
import type { BuiltTile, FromWorker, Quality, ToWorker } from "../protocol.ts";
import { buildBoats } from "./boats.ts";
import type { Detail } from "./buildings.ts";
import { buildBuildings } from "./buildings.ts";
import type { CoastDistance } from "./coast.ts";
import { COAST_MARGIN, coastMap, coastOf } from "./coast.ts";
import { paintGround } from "./ground.ts";
import { buildPiers, buildRoads } from "./roads.ts";
import { buildStreetLabels } from "./street-labels.ts";
import type { Surface } from "./terrain.ts";
import { buildTerrain } from "./terrain.ts";
import { buildTraffic } from "./traffic.ts";
import { buildTrees } from "./trees.ts";
import type { Area, TileFeatures } from "./vector.ts";
import { VectorSource } from "./vector.ts";

// The app compiles with the DOM's types, where `self` is a window; here it's
// this worker's scope, which talks the way a `Worker` handle does.
const scope = self as unknown as Worker;

interface State {
  frame: Frame;
  field: HeightField;
  cover: Uint8Array;
  coverGrid: Grid;
  source: VectorSource;
  zooms: [number, number, number];
  clear: { x: number; z: number; radius: number }[];
  quality: Quality;
}

let state: Promise<State> | undefined;

async function loadCover(url: string, grid: Grid): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const canvas = new OffscreenCanvas(grid.width, grid.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("2D canvas unavailable in worker");
  }
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, grid.width, grid.height).data;
  const classes = new Uint8Array(grid.width * grid.height);
  for (let cell = 0; cell < classes.length; cell += 1) {
    classes[cell] = pixels[cell * 4] ?? 0;
  }
  return classes;
}

async function init(
  message: Extract<ToWorker, { type: "init" }>
): Promise<State> {
  const { manifest } = message;
  const resolve = (path: string) => new URL(path, message.url).href;
  const [field, cover] = await Promise.all([
    HeightField.load(manifest.heights, resolve(manifest.heights.url)),
    loadCover(resolve(manifest.landcover.url), manifest.landcover),
  ]);
  return {
    clear: message.clear,
    cover,
    coverGrid: manifest.landcover,
    field,
    frame: createFrame(manifest.origin),
    quality: message.quality,
    source: new VectorSource(
      createFrame(manifest.origin),
      manifest.tiles.url,
      message.url,
      manifest.tiles.available
    ),
    zooms: manifest.tiles.zooms,
  };
}

/** The data zoom a render zoom draws from: the next one up, or the finest. */
function dataZoom(zooms: [number, number, number], z: number): number {
  return zooms.find((zoom) => zoom >= z) ?? zooms[2];
}

function dataTiles(tile: TileId, zoom: number): TileId[] {
  if (zoom <= tile.z) {
    return [ancestor(tile, zoom)];
  }
  const span = 2 ** (zoom - tile.z);
  const tiles: TileId[] = [];
  for (let dy = 0; dy < span; dy += 1) {
    for (let dx = 0; dx < span; dx += 1) {
      tiles.push({ x: tile.x * span + dx, y: tile.y * span + dy, z: zoom });
    }
  }
  return tiles;
}

type Rgb = [number, number, number];

const FALLBACK: Rgb = [184, 223, 135];

/** Cover the sea or a lake claims: far coarser than OSM's own outlines. */
const WET = new Set<number>([COVER.sea, COVER.water]);

/**
 * The ground's color at a point, blended between the cover cells around it.
 * Wet cells only count where no other is near, or their blocks would show
 * along the coast and lake shores OSM draws.
 */
function coverColor(
  stateNow: State,
  colors: Map<number, Rgb>,
  x: number,
  z: number,
  out: Rgb
): void {
  const { cover, coverGrid } = stateNow;
  const fx = (x - coverGrid.x) / coverGrid.step;
  const fz = (z - coverGrid.z) / coverGrid.step;
  const c0 = Math.max(0, Math.min(coverGrid.width - 1, Math.floor(fx)));
  const r0 = Math.max(0, Math.min(coverGrid.height - 1, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - c0));
  const tz = Math.min(1, Math.max(0, fz - r0));
  out.fill(0);
  let total = 0;
  for (let corner = 0; corner < 4; corner += 1) {
    const right = corner % 2 === 1;
    const down = corner >= 2;
    const column = right ? Math.min(coverGrid.width - 1, c0 + 1) : c0;
    const row = down ? Math.min(coverGrid.height - 1, r0 + 1) : r0;
    const value = cover[row * coverGrid.width + column] ?? 0;
    if (WET.has(value)) {
      continue;
    }
    // A sliver of weight keeps a dry corner in play right on a cell center.
    const weight = Math.max(1e-4, (right ? tx : 1 - tx) * (down ? tz : 1 - tz));
    const color = colors.get(value) ?? FALLBACK;
    for (let channel = 0; channel < 3; channel += 1) {
      out[channel] = (out[channel] ?? 0) + (color[channel] ?? 0) * weight;
    }
    total += weight;
  }
  const bare = colors.get(COVER.bare) ?? FALLBACK;
  for (let channel = 0; channel < 3; channel += 1) {
    out[channel] =
      total === 0 ? (bare[channel] ?? 0) : (out[channel] ?? 0) / total;
  }
}

/** Tiles of a zoom under a square and a margin around it. */
function tilesAround(
  frame: Frame,
  square: Square,
  margin: number,
  zoom: number
): TileId[] {
  const west = square.x - margin;
  const north = square.z - margin;
  const far = square.size + margin;
  const first = tileAt(frame, { x: west, z: north }, zoom);
  const last = tileAt(frame, { x: square.x + far, z: square.z + far }, zoom);
  const tiles: TileId[] = [];
  for (let row = first.y; row <= last.y; row += 1) {
    for (let column = first.x; column <= last.x; column += 1) {
      tiles.push({ x: column, y: row, z: zoom });
    }
  }
  return tiles;
}

/** Ground colors for a tile, from the land cover. */
function paintCover(
  stateNow: State,
  square: Square,
  size: number
): ImageBitmap {
  const colors = new Map<number, Rgb>();
  for (const [key, hex] of Object.entries(PALETTE.cover)) {
    colors.set(Number(key), [
      Math.floor(hex / 65_536) % 256,
      Math.floor(hex / 256) % 256,
      hex % 256,
    ]);
  }
  const pixels = new ImageData(size, size);
  const { data } = pixels;
  const meters = square.size / size;
  const color: Rgb = [0, 0, 0];
  for (let row = 0; row < size; row += 1) {
    const z = square.z + (row + 0.5) * meters;
    for (let column = 0; column < size; column += 1) {
      coverColor(
        stateNow,
        colors,
        square.x + (column + 0.5) * meters,
        z,
        color
      );
      const offset = (row * size + column) * 4;
      const [red, green, blue] = color;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = 255;
    }
  }
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext("2d")?.putImageData(pixels, 0, 0);
  return canvas.transferToImageBitmap();
}

function centroidIn(area: Area, square: Square): boolean {
  const ring = area.rings[0] ?? [];
  let x = 0;
  let z = 0;
  const count = Math.max(1, ring.length - 1);
  for (const point of ring.slice(0, -1)) {
    x += point.x / count;
    z += point.z / count;
  }
  return (
    x >= square.x &&
    z >= square.z &&
    x < square.x + square.size &&
    z < square.z + square.size
  );
}

/** What moves on the closest tiles: traffic, and boats at their moorings. */
function buildLife(
  stateNow: State,
  data: TileFeatures[],
  square: Square,
  surface: Surface,
  coast: CoastDistance | undefined
): Pick<BuiltTile, "boats" | "traffic"> {
  const { quality } = stateNow;
  const [detailData] = data;
  return {
    boats:
      coast && quality.boats > 0
        ? buildBoats({ coast, data, density: quality.boats, square, surface })
        : undefined,
    traffic:
      detailData && data.length === 1
        ? buildTraffic({
            cars: quality.cars,
            cover: stateNow.cover,
            coverGrid: stateNow.coverGrid,
            data: detailData,
            field: stateNow.field,
            people: quality.people,
            square,
            surface,
          })
        : undefined,
  };
}

/** The terrain, shaped to OSM's coast, and the coast map it's drawn with. */
async function groundOf(
  stateNow: State,
  tile: TileId,
  square: Square,
  zoom: number
) {
  const segments = tile.z >= 14 ? 64 : 128;
  const cell = square.size / segments;
  // The coast map: a few texels a cell, about two ground texels each.
  const pixel = cell / (segments === 64 ? 4 : 3);
  const around = await Promise.all(
    tilesAround(stateNow.frame, square, cell * COAST_MARGIN, zoom).map((id) =>
      stateNow.source.get(id)
    )
  );
  const coast = coastOf(square, around, cell, pixel);
  const { data: terrain, surface } = buildTerrain(
    stateNow.field,
    square,
    segments,
    coast
  );
  return {
    coast,
    coastTexture: coast ? coastMap(coast, square, pixel) : undefined,
    surface,
    terrain,
  };
}

const DETAIL: Record<number, Detail> = {
  14: "simple",
  15: "medium",
  16: "full",
};

async function build(stateNow: State, tile: TileId): Promise<BuiltTile> {
  const square = tileSquare(stateNow.frame, tile);
  const zoom = dataZoom(stateNow.zooms, tile.z);
  const data: TileFeatures[] = await Promise.all(
    dataTiles(tile, zoom).map((id) => stateNow.source.get(id))
  );
  const { coast, coastTexture, surface, terrain } = await groundOf(
    stateNow,
    tile,
    square,
    zoom
  );
  const detail = DETAIL[Math.min(16, tile.z)];
  const buildings = detail
    ? data
        .flatMap((item) => item.buildings)
        .filter((area) => centroidIn(area, square))
    : [];
  const buildingMesh = detail
    ? buildBuildings(buildings, {
        clear: stateNow.clear,
        detail,
        originX: square.x,
        originZ: square.z,
        surface,
      })
    : undefined;
  const spacing = { 14: 34, 15: 17, 16: 9 }[tile.z];
  const trees =
    spacing === undefined
      ? undefined
      : buildTrees({
          buildings,
          cover: stateNow.cover,
          coverGrid: stateNow.coverGrid,
          data,
          spacing: spacing * stateNow.quality.treeSpacing,
          square,
          surface,
        });
  const near = tile.z >= 16;
  const roads = near
    ? buildRoads(
        data.flatMap((item) => item.roads),
        { lamps: stateNow.quality.lamps, square, surface }
      )
    : undefined;
  const life = near ? buildLife(stateNow, data, square, surface, coast) : {};
  const labels = near
    ? buildStreetLabels(
        data.flatMap((item) => item.roads),
        square,
        surface
      )
    : undefined;
  const piers =
    tile.z >= 14
      ? buildPiers(
          data.flatMap((item) => item.piers),
          square,
          surface
        )
      : undefined;
  const size = near ? stateNow.quality.nearTexture : 512;
  const ground = paintGround({
    buildings: tile.z >= 14 ? buildings : [],
    cover: paintCover(stateNow, square, Math.min(size, 512)),
    data,
    roads: !near,
    size,
    square,
    trees: tile.z >= 15 ? (trees?.shade ?? []) : [],
  });
  return {
    ...life,
    buildings: buildingMesh,
    coast: coastTexture,
    ground,
    labels,
    lamps: roads?.lamps,
    piers,
    roads: roads?.surface,
    structures: roads?.structures,
    terrain,
    trees: trees?.batches ?? [],
  };
}

function transferables(tile: BuiltTile): Transferable[] {
  return [
    tile.ground,
    tile.terrain.positions.buffer as ArrayBuffer,
    tile.terrain.normals.buffer as ArrayBuffer,
    tile.terrain.uvs.buffer as ArrayBuffer,
    tile.terrain.indices.buffer as ArrayBuffer,
    ...(tile.coast ? [tile.coast.data.buffer as ArrayBuffer] : []),
    ...buffersOf(tile.buildings),
    ...buffersOf(tile.roads),
    ...buffersOf(tile.structures),
    ...buffersOf(tile.piers),
    ...tile.trees.flatMap((batch) => [
      batch.matrices.buffer as ArrayBuffer,
      batch.colors.buffer as ArrayBuffer,
    ]),
    ...(tile.lamps ? [tile.lamps.buffer as ArrayBuffer] : []),
    ...(tile.boats ?? []).flatMap((batch) => [
      batch.matrices.buffer as ArrayBuffer,
      batch.colors.buffer as ArrayBuffer,
    ]),
    ...(tile.traffic
      ? [
          tile.traffic.paths.buffer as ArrayBuffer,
          tile.traffic.cars.buffer as ArrayBuffer,
          tile.traffic.people.buffer as ArrayBuffer,
        ]
      : []),
    ...(tile.labels
      ? [
          tile.labels.atlas,
          tile.labels.positions.buffer as ArrayBuffer,
          tile.labels.uvs.buffer as ArrayBuffer,
          tile.labels.indices.buffer as ArrayBuffer,
        ]
      : []),
  ];
}

function post(message: FromWorker, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

async function respond(message: ToWorker): Promise<void> {
  if (message.type === "init") {
    state = init(message);
    try {
      await state;
      post({ type: "ready" });
    } catch (error) {
      post({ error: String(error), job: -1, type: "failed" });
    }
    return;
  }
  try {
    if (!state) {
      throw new Error("worker not initialized");
    }
    const tile = await build(await state, message.tile);
    post({ job: message.job, tile, type: "built" }, transferables(tile));
  } catch (error) {
    post({ error: String(error), job: message.job, type: "failed" });
  }
}

scope.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  respond(event.data);
});
