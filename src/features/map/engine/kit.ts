import type { BufferGeometry } from "three";
import {
  BufferAttribute,
  CylinderGeometry,
  IcosahedronGeometry,
  SphereGeometry,
} from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";

import type { TreeKind } from "./worker/trees.ts";

/**
 * Shapes shared by every tile: the trees' canopies and trunks, and street
 * lamps. Canopies carry a light-to-dark gradient in their vertex colors; the
 * instance color tints them.
 */
export interface Kit {
  canopy: Record<TreeKind, BufferGeometry>;
  trunk: Record<TreeKind, BufferGeometry>;
  pole: BufferGeometry;
  bulb: BufferGeometry;
  dispose: () => void;
}

/** Shades a canopy brighter on top, softly, like Fenn's trees. */
function shade(
  geometry: BufferGeometry,
  bottom: number,
  top: number,
  low = 0.72
): BufferGeometry {
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index += 1) {
    const t = Math.min(
      1,
      Math.max(0, (positions.getY(index) - bottom) / (top - bottom))
    );
    const value = low + (1 - low) * t ** 0.8;
    colors.set([value, value, value], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

/** Non-indexed with only positions and normals, so parts can be merged. */
function part(geometry: BufferGeometry): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute("uv");
  return flat;
}

/** A smooth lump: welded so its normals round off instead of faceting. */
function blob(
  radius: number,
  detail: number,
  x: number,
  y: number,
  z: number,
  stretch = 1
) {
  const source = new IcosahedronGeometry(radius, detail);
  source.deleteAttribute("uv");
  source.deleteAttribute("normal");
  const geometry = mergeVertices(source);
  geometry.scale(1, stretch, 1);
  geometry.translate(x, y, z);
  geometry.computeVertexNormals();
  return part(geometry);
}

function broadCanopy(): BufferGeometry {
  const parts = [
    blob(2.9, 1, 0, 5.4, 0),
    blob(1.9, 1, 1.7, 4.6, 0.6),
    blob(1.8, 1, -1.5, 4.9, -0.8),
    blob(1.6, 0, 0.2, 6.9, 0.2),
  ];
  const merged = mergeGeometries(parts);
  return shade(merged ?? new IcosahedronGeometry(3, 1), 2.6, 8.2);
}

function coneCanopy(): BufferGeometry {
  const merged = mergeGeometries([
    blob(1.55, 1, 0, 6.4, 0, 2.4),
    blob(1.2, 1, 0, 3.6, 0, 1.4),
  ]);
  return shade(merged ?? new IcosahedronGeometry(1.6, 1), 1.8, 10.2, 0.66);
}

function palmCanopy(): BufferGeometry {
  // Fronds: flat, drooping leaves fanned around the crown.
  const fronds = [];
  const count = 7;
  for (let index = 0; index < count; index += 1) {
    const frond = new SphereGeometry(1, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    frond.scale(2.6, 0.35, 0.55);
    frond.translate(2.3, 0, 0);
    frond.rotateZ(-0.35);
    frond.rotateY((index / count) * Math.PI * 2);
    frond.translate(0, 8.3, 0);
    fronds.push(part(frond));
  }
  fronds.push(blob(0.6, 1, 0, 8.3, 0));
  const merged = mergeGeometries(fronds);
  merged?.computeVertexNormals();
  return shade(merged ?? new IcosahedronGeometry(2, 0), 6.8, 9.2, 0.7);
}

function trunk(
  height: number,
  bottom: number,
  top: number,
  lean = 0
): BufferGeometry {
  const geometry = new CylinderGeometry(
    top,
    bottom,
    height,
    6,
    lean > 0 ? 4 : 1,
    true
  );
  geometry.translate(0, height / 2, 0);
  if (lean > 0) {
    // A palm's gentle curve.
    const positions = geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index += 1) {
      const t = positions.getY(index) / height;
      positions.setX(index, positions.getX(index) + lean * t * t);
    }
    geometry.computeVertexNormals();
  }
  return geometry;
}

export function createKit(): Kit {
  const kit = {
    bulb: new SphereGeometry(0.32, 10, 6).translate(0, 4.6, 0.7),
    canopy: { broad: broadCanopy(), cone: coneCanopy(), palm: palmCanopy() },
    pole:
      mergeGeometries([
        part(new CylinderGeometry(0.07, 0.1, 4.6, 6).translate(0, 2.3, 0)),
        part(
          new CylinderGeometry(0.05, 0.05, 0.8, 4)
            .rotateX(Math.PI / 2)
            .translate(0, 4.6, 0.35)
        ),
      ]) ?? new CylinderGeometry(0.08, 0.1, 4.6, 6),
    trunk: {
      broad: trunk(3.4, 0.32, 0.22),
      cone: trunk(2.4, 0.3, 0.2),
      palm: trunk(8.4, 0.3, 0.22, 0.9),
    },
  };
  return {
    ...kit,
    dispose() {
      for (const geometry of [
        kit.bulb,
        kit.pole,
        ...Object.values(kit.canopy),
        ...Object.values(kit.trunk),
      ]) {
        geometry.dispose();
      }
    },
  };
}
