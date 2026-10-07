import type { LngLat } from "./format.ts";

const EARTH_CIRCUMFERENCE = 40_075_016.686;
const RADIANS = Math.PI / 180;

/** Web Mercator in [0, 1], y growing to the south. */
export function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

export function mercatorY(lat: number): number {
  const sin = Math.sin(lat * RADIANS);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

export function lngOf(mercator: number): number {
  return mercator * 360 - 180;
}

export function latOf(mercator: number): number {
  return Math.atan(Math.sinh(Math.PI - 2 * Math.PI * mercator)) / RADIANS;
}

/** The local frame of a world: see `format.ts`. */
export interface Frame {
  /** Mercator position of the origin. */
  mx: number;
  my: number;
  /** Meters per mercator unit at the origin's latitude. */
  scale: number;
}

export function createFrame(origin: LngLat): Frame {
  return {
    mx: mercatorX(origin.lng),
    my: mercatorY(origin.lat),
    scale: EARTH_CIRCUMFERENCE * Math.cos(origin.lat * RADIANS),
  };
}

export interface Point {
  x: number;
  z: number;
}

export function toLocal(frame: Frame, position: LngLat): Point {
  return {
    x: (mercatorX(position.lng) - frame.mx) * frame.scale,
    z: (mercatorY(position.lat) - frame.my) * frame.scale,
  };
}

export function toLngLat(frame: Frame, point: Point): LngLat {
  return {
    lat: latOf(frame.my + point.z / frame.scale),
    lng: lngOf(frame.mx + point.x / frame.scale),
  };
}

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** A tile's north-west corner and side, in the local frame. */
export interface Square {
  x: number;
  z: number;
  size: number;
}

export function tileSquare(frame: Frame, tile: TileId): Square {
  const size = frame.scale / 2 ** tile.z;
  return {
    size,
    x: (tile.x / 2 ** tile.z - frame.mx) * frame.scale,
    z: (tile.y / 2 ** tile.z - frame.my) * frame.scale,
  };
}

/** The tile of a zoom that holds a local point. */
export function tileAt(frame: Frame, point: Point, z: number): TileId {
  const count = 2 ** z;
  return {
    x: Math.floor((frame.mx + point.x / frame.scale) * count),
    y: Math.floor((frame.my + point.z / frame.scale) * count),
    z,
  };
}

export function tileKey(tile: TileId): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/** The ancestor of a tile at a lower zoom. */
export function ancestor(tile: TileId, z: number): TileId {
  const shift = 2 ** (tile.z - z);
  return { x: Math.floor(tile.x / shift), y: Math.floor(tile.y / shift), z };
}
