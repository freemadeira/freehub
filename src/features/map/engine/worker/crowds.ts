import type { RoadKind } from "../format.ts";
import type { Point, Square } from "../geo.ts";
import { generator, hash } from "../random.ts";
import { ROAD_WIDTH } from "./ground.ts";
import type { Route } from "./routes.ts";
import { routeAt } from "./routes.ts";
import type { Surface } from "./terrain.ts";
import type { Area, TileFeatures } from "./vector.ts";

/** Most people standing about in a tile drawn, before quality thins them. */
const STANDERS = 320;
/** Square meters of each kind of place per group standing about in it. */
const EVERY: Record<string, number> = {
  marina: 1500,
  park: 2500,
  pedestrian: 350,
};

export function inRing(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] ?? point;
    const b = ring[j] ?? point;
    if (
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function busyAt(point: Point, busy: Area[]): boolean {
  return busy.some((area) => inRing(point, area.rings[0] ?? []));
}

function areaOf(ring: Point[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const a = ring[index] as Point;
    const b = ring[index + 1] as Point;
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum / 2);
}

function widthOf(route: Route): number {
  const { width, kind } = route.properties;
  return typeof width === "number"
    ? width
    : ROAD_WIDTH[String(kind) as RoadKind];
}

/**
 * People standing about in a tile, five floats each: x, y and z in the tile,
 * heading, and an id that picks how they look. Never inside a building.
 */
class Crowd {
  readonly values: number[] = [];
  readonly random: () => number;
  private readonly square: Square;
  private readonly surface: Surface;
  private readonly limit: number;
  private readonly buildings: Area[];

  constructor(
    data: TileFeatures,
    square: Square,
    surface: Surface,
    share: number
  ) {
    this.square = square;
    this.surface = surface;
    this.limit = Math.round(STANDERS * share);
    this.random = generator(hash(square.x, square.z, 23));
    this.buildings = data.buildings.filter((building) =>
      (building.rings[0] ?? []).some(
        (point) =>
          point.x > square.x - 30 &&
          point.z > square.z - 30 &&
          point.x < square.x + square.size + 30 &&
          point.z < square.z + square.size + 30
      )
    );
  }

  /** Someone standing at a point, facing `heading`, if there's room. */
  add(point: Point, heading: number): void {
    const { square } = this;
    const inside =
      point.x >= square.x &&
      point.z >= square.z &&
      point.x < square.x + square.size &&
      point.z < square.z + square.size;
    if (
      !inside ||
      this.values.length / 5 >= this.limit ||
      this.buildings.some((building) => inRing(point, building.rings[0] ?? []))
    ) {
      return;
    }
    this.values.push(
      point.x - square.x,
      this.surface.height(point.x, point.z) + 0.12,
      point.z - square.z,
      heading,
      this.random()
    );
  }

  /** Two or three people round a little circle, facing its middle. */
  group(center: Point): void {
    const size = 2 + Math.floor(this.random() * this.random() * 3);
    const turn = this.random() * Math.PI * 2;
    const radius = 0.45 + 0.12 * size;
    for (let index = 0; index < size; index += 1) {
      const angle =
        turn + (index / size) * Math.PI * 2 + (this.random() - 0.5) * 0.5;
      this.add(
        {
          x: center.x + Math.sin(angle) * radius,
          z: center.z + Math.cos(angle) * radius,
        },
        angle + Math.PI
      );
    }
  }

  /** Somewhere inside an area. */
  within(ring: Point[]): Point | undefined {
    const xs = ring.map((point) => point.x);
    const zs = ring.map((point) => point.z);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
    for (let tries = 0; tries < 12; tries += 1) {
      const point = {
        x: x0 + this.random() * (x1 - x0),
        z: z0 + this.random() * (z1 - z0),
      };
      if (inRing(point, ring)) {
        return point;
      }
    }
    return undefined;
  }
}

/** Groups on squares, in parks and at the marina. */
function inPlaces(crowd: Crowd, landuse: Area[]) {
  for (const area of landuse) {
    const spacing = EVERY[String(area.properties.kind)];
    const ring = area.rings[0] ?? [];
    if (spacing !== undefined && ring.length >= 4) {
      const count = Math.min(
        8,
        Math.floor(areaOf(ring) / spacing + crowd.random())
      );
      for (let index = 0; index < count; index += 1) {
        const point = crowd.within(ring);
        if (point) {
          crowd.group(point);
        }
      }
    }
  }
}

/** Groups along pedestrian streets now and then, by the side. */
function onStreets(crowd: Crowd, walks: Route[]) {
  for (const route of walks) {
    if (route.properties.kind === "pedestrian") {
      const length = route.along.at(-1) ?? 0;
      const half = Math.max(0.8, widthOf(route) / 2 - 1);
      for (let s = 15; s < length; s += 30) {
        if (crowd.random() < 0.45) {
          const at = routeAt(route, s);
          const side = (crowd.random() < 0.5 ? -1 : 1) * half;
          crowd.group({ x: at.x - at.dz * side, z: at.z + at.dx * side });
        }
      }
    }
  }
}

/** One or two people window shopping where streets are busy, facing in. */
function atShops(crowd: Crowd, sidewalks: Route[], shops: Area[]) {
  for (const route of sidewalks) {
    const length = route.along.at(-1) ?? 0;
    const out = widthOf(route) / 2 + 1.6;
    for (let s = 20; s < length; s += 45) {
      const at = routeAt(route, s);
      if (crowd.random() <= 0.35 && busyAt(at, shops)) {
        const side = crowd.random() < 0.5 ? -1 : 1;
        const facing = Math.atan2(-at.dz * side, at.dx * side);
        const count = crowd.random() < 0.6 ? 1 : 2;
        for (let index = 0; index < count; index += 1) {
          const shift = (index - (count - 1) / 2) * 0.7;
          crowd.add(
            {
              x: at.x - at.dz * side * out + at.dx * shift,
              z: at.z + at.dx * side * out + at.dz * shift,
            },
            facing + (crowd.random() - 0.5) * 0.4
          );
        }
      }
    }
  }
}

export interface CrowdOptions {
  data: TileFeatures;
  square: Square;
  surface: Surface;
  /** Multiplies how many there are. */
  share: number;
  /** Streets with sidewalks, and footpaths, as routes. */
  sidewalks: Route[];
  walks: Route[];
}

/**
 * People standing about: chatting in twos and threes on squares, in parks,
 * on pedestrian streets and at the marina, and looking in shop windows along
 * busy streets.
 */
export function buildCrowds(options: CrowdOptions): number[] {
  const { data } = options;
  const crowd = new Crowd(data, options.square, options.surface, options.share);
  inPlaces(crowd, data.landuse);
  onStreets(crowd, options.walks);
  atShops(
    crowd,
    options.sidewalks,
    data.landuse.filter((area) => area.properties.kind === "commercial")
  );
  return crowd.values;
}
