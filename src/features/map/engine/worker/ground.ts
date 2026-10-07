import type { LanduseKind, RoadKind } from "../format.ts";
import type { Point, Square } from "../geo.ts";
import { css, PALETTE } from "../palette.ts";
import type { Area, Line, TileFeatures } from "./vector.ts";

/** Road widths in meters, asphalt only. */
export const ROAD_WIDTH: Record<RoadKind, number> = {
  footway: 1.8,
  motorway: 13,
  pedestrian: 5,
  primary: 9,
  residential: 5.5,
  runway: 45,
  secondary: 8,
  service: 3.8,
  steps: 1.8,
  taxiway: 18,
  tertiary: 6.5,
  track: 3,
  trunk: 11,
};

/** Drawing order: wide natural cover first, small built details last. */
const LANDUSE_ORDER: LanduseKind[] = [
  "forest",
  "scrub",
  "grass",
  "farmland",
  "orchard",
  "vineyard",
  "rock",
  "wetland",
  "beach",
  "residential",
  "commercial",
  "industrial",
  "institution",
  "airport",
  "apron",
  "marina",
  "cemetery",
  "park",
  "golf",
  "pitch",
  "playground",
  "parking",
  "pedestrian",
];

const WATERWAY_WIDTH: Record<string, number> = {
  canal: 1.4,
  ditch: 0.9,
  drain: 0.9,
  river: 6,
  stream: 2,
};

/** Outside OSM's coast, where ground only shows at the water's edge: surf. */
const SHORE = 0xf6_fc_fd;
/** Far enough that the shapes land off the canvas and only their shadows on it. */
const SHADOW_SHIFT = 20_000;

function tracePolygon(
  context: OffscreenCanvasRenderingContext2D,
  rings: Point[][]
) {
  for (const ring of rings) {
    for (const [index, point] of ring.entries()) {
      if (index === 0) {
        context.moveTo(point.x, point.z);
      } else {
        context.lineTo(point.x, point.z);
      }
    }
    context.closePath();
  }
}

function traceLine(
  context: OffscreenCanvasRenderingContext2D,
  points: Point[]
) {
  for (const [index, point] of points.entries()) {
    if (index === 0) {
      context.moveTo(point.x, point.z);
    } else {
      context.lineTo(point.x, point.z);
    }
  }
}

function area(rings: Point[][]): number {
  const outer = rings[0] ?? [];
  let sum = 0;
  for (let index = 0; index < outer.length - 1; index += 1) {
    const a = outer[index] ?? { x: 0, z: 0 };
    const b = outer[index + 1] ?? { x: 0, z: 0 };
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum / 2);
}

const ROAD_ORDER: RoadKind[] = [
  "track",
  "footway",
  "steps",
  "pedestrian",
  "service",
  "residential",
  "tertiary",
  "secondary",
  "primary",
  "trunk",
  "motorway",
  "taxiway",
  "runway",
];

function paintRoads(
  context: OffscreenCanvasRenderingContext2D,
  roads: Line[],
  pixel: number
) {
  const sorted = roads
    .map((road) => ({
      order: ROAD_ORDER.indexOf(String(road.properties.kind) as RoadKind),
      road,
    }))
    .filter(({ order }) => order !== -1)
    .toSorted((a, b) => a.order - b.order);
  context.lineCap = "round";
  context.lineJoin = "round";
  // Pale verges first, so crossings merge into one surface.
  for (const pass of ["verge", "asphalt"] as const) {
    for (const { road, order } of sorted) {
      const kind = ROAD_ORDER[order] ?? "residential";
      const width = ROAD_WIDTH[kind];
      // Paths vanish at a distance rather than turning into thick lines.
      if (
        width < pixel * 0.6 &&
        kind !== "motorway" &&
        kind !== "trunk" &&
        kind !== "primary"
      ) {
        continue;
      }
      const verge = width >= 5 && kind !== "runway" && kind !== "taxiway";
      if (pass === "verge" && !verge) {
        continue;
      }
      context.strokeStyle = css(
        pass === "verge" ? PALETTE.sidewalk : PALETTE.road[kind]
      );
      context.lineWidth = Math.max(
        pixel,
        pass === "verge" ? width + 3.5 : width
      );
      context.beginPath();
      traceLine(context, road.points);
      context.stroke();
    }
  }
}

export interface GroundOptions {
  size: number;
  square: Square;
  /** Data tiles covering the square. */
  data: TileFeatures[];
  /** Land cover colors already laid out over the square. */
  cover: ImageBitmap;
  /** Roads go into the texture unless they're built as geometry. */
  roads: boolean;
  /** Footprints that get a soft shadow at their foot. */
  buildings: Area[];
  /** Tree trunks and canopy radii, for their shade. */
  trees: { x: number; z: number; radius: number }[];
}

/** Paints a tile's ground: cover, land use, water and, at a distance, roads. */
export function paintGround(options: GroundOptions): ImageBitmap {
  const { size, square, data } = options;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("2D canvas unavailable in worker");
  }
  const scale = size / square.size;
  const pixel = 1 / scale;
  context.setTransform(
    scale,
    0,
    0,
    scale,
    -square.x * scale,
    -square.z * scale
  );
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.fillStyle = css(SHORE);
  context.fillRect(square.x, square.z, square.size, square.size);

  // Everything else stays on land, so the coast is as sharp as OSM's.
  context.save();
  context.beginPath();
  for (const tile of data) {
    for (const land of tile.land) {
      tracePolygon(context, land.rings);
    }
  }
  context.clip();

  context.drawImage(
    options.cover,
    square.x,
    square.z,
    square.size,
    square.size
  );
  options.cover.close();

  const landuse = data
    .flatMap((tile) => tile.landuse)
    .map((item) => ({
      item,
      order: LANDUSE_ORDER.indexOf(String(item.properties.kind) as LanduseKind),
      size: area(item.rings),
    }))
    .filter(({ order }) => order !== -1)
    .toSorted((a, b) => a.order - b.order || b.size - a.size);
  for (const { item, order } of landuse) {
    const kind = LANDUSE_ORDER[order] ?? "grass";
    context.fillStyle = css(PALETTE.landuse[kind]);
    context.beginPath();
    tracePolygon(context, item.rings);
    context.fill("evenodd");
  }

  for (const tile of data) {
    for (const water of tile.water) {
      context.fillStyle = css(
        water.properties.kind === "pool" ? 0x7f_dc_f3 : PALETTE.water
      );
      context.beginPath();
      tracePolygon(context, water.rings);
      context.fill("evenodd");
    }
  }
  context.strokeStyle = css(PALETTE.water);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const tile of data) {
    for (const waterway of tile.waterways) {
      const width = WATERWAY_WIDTH[String(waterway.properties.kind)] ?? 1;
      context.lineWidth = Math.max(width, pixel);
      context.beginPath();
      traceLine(context, waterway.points);
      context.stroke();
    }
  }

  // Soft shade where walls and trunks meet the ground.
  context.save();
  context.shadowColor = "rgba(70, 60, 95, 0.34)";
  context.shadowOffsetX = SHADOW_SHIFT;
  context.shadowOffsetY = 0;
  context.fillStyle = "#000";
  const shift = SHADOW_SHIFT / scale;
  context.translate(-shift, 0);
  if (options.buildings.length > 0) {
    context.shadowBlur = Math.max(2, 3.5 * scale);
    context.beginPath();
    for (const building of options.buildings) {
      tracePolygon(context, building.rings.slice(0, 1));
    }
    context.fill();
  }
  if (options.trees.length > 0) {
    context.shadowColor = "rgba(50, 80, 60, 0.3)";
    context.shadowBlur = Math.max(1.5, 2.2 * scale);
    context.beginPath();
    for (const tree of options.trees) {
      context.moveTo(tree.x + tree.radius, tree.z);
      context.arc(tree.x, tree.z, tree.radius, 0, Math.PI * 2);
    }
    context.fill();
  }
  context.restore();

  if (options.roads) {
    paintRoads(
      context,
      data.flatMap((tile) => tile.roads),
      pixel
    );
  }
  context.restore();
  return canvas.transferToImageBitmap();
}
