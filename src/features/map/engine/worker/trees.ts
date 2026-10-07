import type { Grid } from "../format.ts";
import { COVER } from "../format.ts";
import type { Square } from "../geo.ts";
import { linear, PALETTE } from "../palette.ts";
import { generator, hash, pick } from "../random.ts";
import { ROAD_WIDTH } from "./ground.ts";
import type { Surface } from "./terrain.ts";
import type { Area, TileFeatures } from "./vector.ts";

export const TREE_KINDS = ["broad", "cone", "palm"] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

/** Instances of one tree kind: 4×4 matrices and canopy colors. */
export interface TreeBatch {
  kind: TreeKind;
  matrices: Float32Array;
  colors: Float32Array;
}

export interface TreeResult {
  batches: TreeBatch[];
  /** Where to paint shade under the canopies. */
  shade: { x: number; z: number; radius: number }[];
}

/** Chance of a tree in each spot, by land cover, before land use overrides it. */
const COVER_DENSITY: Record<number, number> = {
  [COVER.bare]: 0.01,
  [COVER.built]: 0.05,
  [COVER.crop]: 0.06,
  [COVER.forest]: 0.92,
  [COVER.grass]: 0.05,
  [COVER.sea]: 0,
  [COVER.shrub]: 0.22,
  [COVER.water]: 0,
  [COVER.wetland]: 0.15,
};

/** Land use that sets the chance itself; zero keeps a place clear. */
const LANDUSE_DENSITY: Record<string, number> = {
  airport: 0,
  apron: 0,
  beach: 0,
  cemetery: 0.25,
  commercial: 0.04,
  farmland: 0.04,
  forest: 0.95,
  golf: 0.12,
  grass: 0.06,
  industrial: 0.02,
  institution: 0.1,
  marina: 0,
  orchard: 0.3,
  park: 0.4,
  parking: 0,
  pedestrian: 0.06,
  pitch: 0,
  playground: 0.15,
  residential: 0.07,
  rock: 0.01,
  scrub: 0.3,
  vineyard: 0.03,
  wetland: 0.15,
};

const URBAN = new Set([
  "residential",
  "commercial",
  "pedestrian",
  "institution",
  "park",
]);

function trace(
  context: OffscreenCanvasRenderingContext2D,
  rings: { x: number; z: number }[][]
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

/**
 * A small map of where trees may stand: red holds the chance set by land use,
 * blue marks that land use decided, and roads, buildings and water clear both.
 */
function chanceMap(
  square: Square,
  data: TileFeatures[],
  buildings: Area[],
  size: number
) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("2D canvas unavailable in worker");
  }
  const scale = size / square.size;
  context.setTransform(
    scale,
    0,
    0,
    scale,
    -square.x * scale,
    -square.z * scale
  );
  context.fillStyle = "#000";
  context.fillRect(square.x, square.z, square.size, square.size);
  const landuse = data.flatMap((tile) => tile.landuse);
  for (const item of landuse) {
    const chance = LANDUSE_DENSITY[String(item.properties.kind)];
    if (chance === undefined) {
      continue;
    }
    context.fillStyle = `rgb(${Math.round(chance * 255)}, ${URBAN.has(String(item.properties.kind)) ? 255 : 0}, 255)`;
    context.beginPath();
    trace(context, item.rings);
    context.fill("evenodd");
  }
  context.fillStyle = "rgb(0, 0, 255)";
  context.strokeStyle = "rgb(0, 0, 255)";
  context.beginPath();
  for (const tile of data) {
    for (const water of tile.water) {
      trace(context, water.rings);
    }
  }
  for (const building of buildings) {
    trace(context, building.rings.slice(0, 1));
  }
  context.fill();
  context.lineCap = "round";
  for (const tile of data) {
    for (const road of tile.roads) {
      const kind = String(road.properties.kind) as keyof typeof ROAD_WIDTH;
      context.lineWidth = (ROAD_WIDTH[kind] ?? 4) + 3;
      context.beginPath();
      for (const [index, point] of road.points.entries()) {
        if (index === 0) {
          context.moveTo(point.x, point.z);
        } else {
          context.lineTo(point.x, point.z);
        }
      }
      context.stroke();
    }
    for (const waterway of tile.waterways) {
      context.lineWidth = 3;
      context.beginPath();
      for (const [index, point] of waterway.points.entries()) {
        if (index === 0) {
          context.moveTo(point.x, point.z);
        } else {
          context.lineTo(point.x, point.z);
        }
      }
      context.stroke();
    }
  }
  return context.getImageData(0, 0, size, size).data;
}

/** Pines and heather take over the higher the ground. */
function conifersAt(height: number): number {
  if (height > 1100) {
    return 0.6;
  }
  return height > 600 ? 0.3 : 0.12;
}

export interface TreeOptions {
  square: Square;
  data: TileFeatures[];
  buildings: Area[];
  surface: Surface;
  cover: Uint8Array;
  coverGrid: Grid;
  /** Meters between candidate spots; wider spacing gets bigger trees. */
  spacing: number;
  /** Only OSM's own trees, no scattering. */
  mappedOnly?: boolean;
}

export function buildTrees(options: TreeOptions): TreeResult {
  const { square, surface, cover, coverGrid, spacing } = options;
  const size = 256;
  const chances = chanceMap(square, options.data, options.buildings, size);
  const lists = new Map<TreeKind, { matrices: number[]; colors: number[] }>(
    TREE_KINDS.map((kind) => [kind, { colors: [], matrices: [] }])
  );
  const shade: TreeResult["shade"] = [];
  const grow = Math.sqrt(spacing / 9);

  const place = (
    x: number,
    z: number,
    kind: TreeKind,
    color: number,
    scale: number,
    seed: number
  ) => {
    const list = lists.get(kind);
    if (!list) {
      return;
    }
    const y = surface.height(x, z) - 0.3;
    const angle = seed * Math.PI * 2;
    const cos = Math.cos(angle) * scale;
    const sin = Math.sin(angle) * scale;
    const height = scale * (0.9 + hash(seed, 7) * 0.25);
    // Column-major, relative to the tile's corner.
    list.matrices.push(
      cos,
      0,
      -sin,
      0,
      0,
      height,
      0,
      0,
      sin,
      0,
      cos,
      0,
      x - square.x,
      y,
      z - square.z,
      1
    );
    const [r, g, b] = linear(color);
    list.colors.push(r, g, b);
    shade.push({ radius: 2.4 * scale, x, z });
  };

  const sample = (x: number, z: number) => {
    const column = Math.floor(((x - square.x) / square.size) * size);
    const row = Math.floor(((z - square.z) / square.size) * size);
    const offset =
      (Math.min(size - 1, Math.max(0, row)) * size +
        Math.min(size - 1, Math.max(0, column))) *
      4;
    return {
      chance: (chances[offset] ?? 0) / 255,
      decided: (chances[offset + 2] ?? 0) > 127,
      urban: (chances[offset + 1] ?? 0) > 127,
    };
  };

  const coverAt = (x: number, z: number) => {
    const column = Math.round((x - coverGrid.x) / coverGrid.step);
    const row = Math.round((z - coverGrid.z) / coverGrid.step);
    if (
      column < 0 ||
      row < 0 ||
      column >= coverGrid.width ||
      row >= coverGrid.height
    ) {
      return COVER.sea;
    }
    return cover[row * coverGrid.width + column] ?? COVER.sea;
  };

  const species = (
    x: number,
    z: number,
    urban: boolean,
    seed: number
  ): [TreeKind, number] => {
    const height = surface.height(x, z);
    const roll = hash(seed, 3);
    if (urban && height < 150 && roll < 0.22) {
      return ["palm", pick(PALETTE.tree.palm, hash(seed, 5))];
    }
    if (urban && height < 450 && roll < 0.36) {
      return ["broad", pick(PALETTE.tree.blossom, hash(seed, 5))];
    }
    if (roll > 1 - conifersAt(height)) {
      return ["cone", pick(PALETTE.tree.cone, hash(seed, 5))];
    }
    return ["broad", pick(PALETTE.tree.broad, hash(seed, 5))];
  };

  // OSM's own trees always stand.
  for (const tile of options.data) {
    for (const tree of tile.trees) {
      const { x, z } = tree.point;
      if (
        x < square.x ||
        z < square.z ||
        x >= square.x + square.size ||
        z >= square.z + square.size
      ) {
        continue;
      }
      const seed = hash(Math.round(x * 10), Math.round(z * 10));
      const palm = tree.properties.kind === "palm";
      const needle = tree.properties.kind === "needleleaved";
      if (palm) {
        place(
          x,
          z,
          "palm",
          pick(PALETTE.tree.palm, seed),
          0.9 + hash(seed, 1) * 0.3,
          seed
        );
      } else if (needle) {
        place(
          x,
          z,
          "cone",
          pick(PALETTE.tree.cone, seed),
          0.8 + hash(seed, 1) * 0.3,
          seed
        );
      } else {
        const [kind, color] = species(x, z, true, seed);
        place(x, z, kind, color, 0.75 + hash(seed, 1) * 0.35, seed);
      }
    }
  }

  if (!options.mappedOnly) {
    const random = generator(hash(square.x, square.z, spacing));
    const columns = Math.ceil(square.size / spacing);
    for (let row = 0; row < columns; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = square.x + (column + random()) * spacing;
        const z = square.z + (row + random()) * spacing;
        const here = sample(x, z);
        const covered = coverAt(x, z);
        if (covered === COVER.sea || covered === COVER.water) {
          continue;
        }
        const chance = here.decided
          ? here.chance
          : (COVER_DENSITY[covered] ?? 0);
        const roll = random();
        if (roll >= chance) {
          continue;
        }
        const seed = hash(Math.round(x * 10), Math.round(z * 10));
        const shrub = !here.decided && covered === COVER.shrub;
        const [kind, color] = species(x, z, here.urban, seed);
        const scale =
          (shrub ? 0.45 + hash(seed, 1) * 0.25 : 0.85 + hash(seed, 1) * 0.45) *
          grow;
        place(x, z, kind, color, scale, seed);
      }
    }
  }

  return {
    batches: [...lists].flatMap(([kind, list]) =>
      list.colors.length > 0
        ? [
            {
              colors: Float32Array.from(list.colors),
              kind,
              matrices: Float32Array.from(list.matrices),
            },
          ]
        : []
    ),
    shade,
  };
}
