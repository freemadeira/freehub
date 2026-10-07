import type { BufferGeometry } from "three";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry as Geometry,
  Color,
  CylinderGeometry,
  MeshLambertMaterial,
  SphereGeometry,
  SRGBColorSpace,
} from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";

import type { SharedUniforms } from "./materials.ts";
import { graded } from "./materials.ts";

/**
 * What each vertex of a vehicle is, in its `mark` attribute: its own color,
 * the color its instance is tinted, or a light that glows at night.
 */
export const MARK = {
  fixed: 0,
  /** Headlights, landing lights: white. */
  front: 2,
  /** Starboard navigation light. */
  green: 5,
  /** Port navigation light. */
  red: 4,
  /** Blinks white. */
  strobe: 6,
  /** Taillights: red. */
  tail: 3,
  tint: 1,
  /** Lit windows. */
  windows: 7,
} as const;

/** Shapes for everything that moves, facing +z with +x to their left. */
export interface Vehicles {
  car: BufferGeometry;
  person: BufferGeometry;
  plane: BufferGeometry;
  ferry: BufferGeometry;
  motorboat: BufferGeometry;
  sailboat: BufferGeometry;
  dispose: () => void;
}

function linear(hex: number): Color {
  return new Color().setHex(hex, SRGBColorSpace);
}

/** A shape as one part: flat, colored, marked, ready to merge. */
function part(
  geometry: BufferGeometry,
  hex: number,
  mark: number = MARK.fixed
): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute("uv");
  const { count } = flat.getAttribute("position");
  const color = linear(hex);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    colors.set([color.r, color.g, color.b], index * 3);
  }
  flat.setAttribute("color", new BufferAttribute(colors, 3));
  flat.setAttribute(
    "mark",
    new BufferAttribute(new Float32Array(count).fill(mark), 1)
  );
  return flat;
}

function box(
  size: [number, number, number],
  at: [number, number, number],
  hex: number,
  mark?: number
): BufferGeometry {
  return part(
    new BoxGeometry(...size).translate(...at),
    hex,
    mark ?? MARK.fixed
  );
}

/** A flat shape outlined in x and z, raised from `bottom` to `top`: hulls, wings. */
function slab(
  outline: [number, number][],
  bottom: number,
  top: number
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  type Corner = [number, number, number];
  // Wound to face its normal, whichever way round the outline goes.
  const triangle = (a: Corner, b: Corner, c: Corner, normal: Corner) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const facing =
      ((u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0)) * normal[0] +
      ((u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0)) * normal[1] +
      ((u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0)) * normal[2];
    for (const corner of facing >= 0 ? [a, b, c] : [a, c, b]) {
      positions.push(...corner);
      normals.push(...normal);
    }
  };
  let area = 0;
  for (const [index, [ax, az]] of outline.entries()) {
    const [bx, bz] = outline[(index + 1) % outline.length] ?? [0, 0];
    area += ax * bz - bx * az;
  }
  const outward = area > 0 ? 1 : -1;
  const [x0, z0] = outline[0] ?? [0, 0];
  for (let index = 1; index < outline.length - 1; index += 1) {
    const [x1, z1] = outline[index] ?? [0, 0];
    const [x2, z2] = outline[index + 1] ?? [0, 0];
    triangle([x0, top, z0], [x1, top, z1], [x2, top, z2], [0, 1, 0]);
    triangle([x0, bottom, z0], [x1, bottom, z1], [x2, bottom, z2], [0, -1, 0]);
  }
  for (const [index, [ax, az]] of outline.entries()) {
    const [bx, bz] = outline[(index + 1) % outline.length] ?? [0, 0];
    const length = Math.hypot(bx - ax, bz - az) || 1;
    const normal: Corner = [
      (outward * (bz - az)) / length,
      0,
      (-outward * (bx - ax)) / length,
    ];
    triangle([ax, bottom, az], [bx, bottom, bz], [bx, top, bz], normal);
    triangle([ax, bottom, az], [bx, top, bz], [ax, top, az], normal);
  }
  const geometry = new Geometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(Float32Array.from(positions), 3)
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(Float32Array.from(normals), 3)
  );
  return geometry;
}

/** One shape from its parts, with shared corners welded: fewer vertices. */
function merged(parts: BufferGeometry[]): BufferGeometry {
  const flat = mergeGeometries(parts) ?? new Geometry();
  for (const piece of parts) {
    piece.dispose();
  }
  const geometry = mergeVertices(flat);
  flat.dispose();
  geometry.computeBoundingSphere();
  return geometry;
}

const WHITE = 0xf7_f8_fb;
const GLASS = 0x46_53_6b;
const TYRE = 0x2e_34_40;
const LAMP = 0xfd_f6_e3;

function car(): BufferGeometry {
  return merged([
    box([1.8, 0.62, 4.2], [0, 0.57, 0], WHITE, MARK.tint),
    box([1.6, 0.5, 2.2], [0, 1.13, -0.25], GLASS),
    box([1.52, 0.1, 1.9], [0, 1.43, -0.3], WHITE, MARK.tint),
    // Wheels in pairs, showing either side under the body.
    box([1.86, 0.56, 0.56], [0, 0.28, 1.3], TYRE),
    box([1.86, 0.56, 0.56], [0, 0.28, -1.3], TYRE),
    box([1.4, 0.2, 0.42], [0, 0.8, 1.95], LAMP, MARK.front),
    box([1.4, 0.18, 0.36], [0, 0.82, -1.98], 0xd9_47_3c, MARK.tail),
  ]);
}

function person(): BufferGeometry {
  return merged([
    part(
      new CylinderGeometry(0.13, 0.1, 0.82, 6, 1, true).translate(0, 0.41, 0),
      0x4a_54_70
    ),
    part(
      new CylinderGeometry(0.2, 0.16, 0.62, 6).translate(0, 1.12, 0),
      WHITE,
      MARK.tint
    ),
    part(new SphereGeometry(0.14, 5, 3).translate(0, 1.58, 0), 0xf0_c9_a6),
  ]);
}

/** A cylinder along z, tapering from `back` to `front` radius. */
function tube(
  back: number,
  front: number,
  length: number,
  z: number,
  y: number,
  hex: number,
  mark?: number
): BufferGeometry {
  return part(
    new CylinderGeometry(front, back, length, 10)
      .rotateX(Math.PI / 2)
      .translate(0, y, z),
    hex,
    mark ?? MARK.fixed
  );
}

/** The same outline on the other side. */
function mirror(outline: [number, number][]): [number, number][] {
  return outline.map(([x, z]) => [-x, z] as [number, number]).toReversed();
}

function plane(): BufferGeometry {
  const axis = 3;
  const wing: [number, number][] = [
    [0, 4.2],
    [0, -2.6],
    [16.8, -6.6],
    [16.8, -4.9],
  ];
  const stabilizer: [number, number][] = [
    [0, -14.8],
    [0, -18.4],
    [6.2, -19.6],
    [6.2, -18.1],
  ];
  const fin = slab(
    [
      [2.5, -12.8],
      [2.5, -18.6],
      [9.3, -19.6],
      [9.3, -17.2],
    ],
    -0.22,
    0.22
  )
    // Drawn flat in x and z, then stood up: x becomes height.
    .rotateZ(Math.PI / 2);
  return merged([
    tube(1.95, 1.95, 25, 0, axis, WHITE),
    tube(1.95, 0.45, 5.5, 15.25, axis, WHITE),
    tube(0.55, 1.95, 7, -16, axis + 0.5, WHITE),
    box([0.06, 0.32, 20], [1.94, axis + 0.4, 0.5], GLASS, MARK.windows),
    box([0.06, 0.32, 20], [-1.94, axis + 0.4, 0.5], GLASS, MARK.windows),
    part(slab(wing, axis - 1.1, axis - 0.7), 0xe3_e7_ee),
    part(slab(mirror(wing), axis - 1.1, axis - 0.7), 0xe3_e7_ee),
    part(slab(stabilizer, axis + 0.6, axis + 0.85), 0xe3_e7_ee),
    part(slab(mirror(stabilizer), axis + 0.6, axis + 0.85), 0xe3_e7_ee),
    part(fin.translate(0, axis - 1, 0), WHITE, MARK.tint),
    ...[-1, 1].flatMap((side) => [
      part(
        new CylinderGeometry(1.05, 0.9, 4.2, 10)
          .rotateX(Math.PI / 2)
          .translate(side * 5.7, axis - 1.6, 2.6),
        0xcf_d4_dc
      ),
      box([0.5, 0.3, 0.3], [side * 1.6, axis - 1.6, 4.2], LAMP, MARK.front),
    ]),
    part(
      new SphereGeometry(0.4, 6, 4).translate(16.8, axis - 0.9, -5.8),
      0xe0_4b_45,
      MARK.red
    ),
    part(
      new SphereGeometry(0.4, 6, 4).translate(-16.8, axis - 0.9, -5.8),
      0x4b_c0_6a,
      MARK.green
    ),
    part(
      new SphereGeometry(0.35, 6, 4).translate(0, axis + 0.6, -19.6),
      WHITE,
      MARK.strobe
    ),
  ]);
}

function ferry(): BufferGeometry {
  const hull: [number, number][] = [
    [-10, -55],
    [10, -55],
    [10, 34],
    [6, 49],
    [0, 55],
    [-6, 49],
    [-10, 34],
  ];
  const deck = hull.map(([x, z]) => [x * 0.96, z * 0.97] as [number, number]);
  return merged([
    part(slab(hull, -3, 4.2), 0x2f_5d_9e, MARK.tint),
    part(slab(deck, 4.2, 5.2), WHITE),
    box([18, 5, 74], [0, 7.7, -6], WHITE),
    box([18.1, 1.3, 70], [0, 8, -6], GLASS, MARK.windows),
    box([15, 4, 44], [0, 12.2, -2], WHITE),
    box([15.1, 1.2, 40], [0, 12.4, -2], GLASS, MARK.windows),
    box([20, 3, 8], [0, 15.6, 17], WHITE),
    box([20.1, 1.1, 8.1], [0, 15.9, 17], GLASS, MARK.windows),
    ...[-1, 1].map((side) =>
      box([3, 6.5, 5], [side * 4, 17.2, -22], 0xf2_6d_5b)
    ),
    part(
      new SphereGeometry(0.6, 6, 4).translate(10, 17.4, 17),
      0xe0_4b_45,
      MARK.red
    ),
    part(
      new SphereGeometry(0.6, 6, 4).translate(-10, 17.4, 17),
      0x4b_c0_6a,
      MARK.green
    ),
    part(
      new CylinderGeometry(0.15, 0.15, 6, 4).translate(0, 20, 14),
      0xd9_db_e2
    ),
    part(
      new SphereGeometry(0.5, 6, 4).translate(0, 23.2, 14),
      LAMP,
      MARK.front
    ),
  ]);
}

function hullOf(length: number, beam: number): [number, number][] {
  const half = length / 2;
  return [
    [beam / 2, -half],
    [beam / 2, half * 0.45],
    [beam * 0.3, half * 0.8],
    [0, half],
    [-beam * 0.3, half * 0.8],
    [-beam / 2, half * 0.45],
    [-beam / 2, -half],
  ];
}

function motorboat(): BufferGeometry {
  const hull = hullOf(8.5, 2.8);
  const band = hull.map(([x, z]) => [x * 1.02, z * 1.01] as [number, number]);
  return merged([
    part(slab(hull, -0.4, 0.95), WHITE),
    part(slab(band, 0.45, 0.7), WHITE, MARK.tint),
    box([1.9, 0.85, 2.8], [0, 1.37, -0.6], WHITE),
    box([1.92, 0.4, 0.06], [0, 1.5, 0.82], GLASS),
  ]);
}

function sailboat(): BufferGeometry {
  const hull = hullOf(10, 3.1);
  return merged([
    part(slab(hull, -0.5, 0.9), WHITE),
    box([1.7, 0.55, 3], [0, 1.17, -0.8], WHITE),
    box([0.16, 12.5, 0.16], [0, 7.1, 0.9], 0xd9_db_e2),
    box([0.34, 0.34, 3.6], [0, 2.3, -1], WHITE, MARK.tint),
    part(
      new SphereGeometry(0.18, 5, 3).translate(0, 13.4, 0.9),
      LAMP,
      MARK.front
    ),
  ]);
}

export function createVehicles(): Vehicles {
  const shapes = {
    car: car(),
    ferry: ferry(),
    motorboat: motorboat(),
    person: person(),
    plane: plane(),
    sailboat: sailboat(),
  };
  return {
    ...shapes,
    dispose() {
      for (const geometry of Object.values(shapes)) {
        geometry.dispose();
      }
    },
  };
}

const VEHICLE_PARS = `
attribute float mark;
uniform float uLife;
uniform float uTime;
varying float vMark;
varying float vBlink;
`;

/**
 * Tints only the tinted parts, and picks a phase per vehicle for its lights.
 * `tint` and `place` say where its color and transform come from.
 */
function vehicleColor(tint: string, place: string): string {
  return `
vColor = vec4(color, 1.0);
#if defined(USE_INSTANCING_COLOR) || defined(FLEET)
if (abs(mark - ${MARK.tint}.0) < 0.25) {
  vColor.rgb = ${tint};
}
#endif
vMark = mark;
float vehicleSeed = fract(sin(dot(${place}[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
vBlink = step(0.92, fract(uTime * 0.9 + vehicleSeed));
`;
}

/** Moored boats rock and bob on the swell. */
const BOB = `
vec3 transformed = vec3(position);
float sway = uLife * 1.1 + vehicleSeed * 30.0;
float roll = sin(sway) * 0.035;
transformed.xy = mat2(cos(roll), sin(roll), -sin(roll), cos(roll)) * transformed.xy;
transformed.y += sin(sway * 0.8 + 1.3) * 0.08;
`;

const LIGHTS = `
varying float vMark;
varying float vBlink;
float isMark(float value) {
  return 1.0 - step(0.25, abs(vMark - value));
}
`;

const LIGHTS_GLOW = [
  `isMark(${MARK.front}.0) * vec3(1.0, 0.95, 0.85) * 2.6`,
  `isMark(${MARK.tail}.0) * vec3(1.0, 0.12, 0.06) * 2.6`,
  `isMark(${MARK.red}.0) * vec3(1.0, 0.12, 0.1) * 2.8`,
  `isMark(${MARK.green}.0) * vec3(0.15, 1.0, 0.4) * 2.4`,
  `isMark(${MARK.strobe}.0) * vBlink * vec3(4.0)`,
  `isMark(${MARK.windows}.0) * vec3(1.0, 0.78, 0.45) * 1.3`,
].join(" + ");

/** Vehicles placed by uniforms rather than instance attributes: a `Fleet`. */
export interface FleetShader {
  /** Declarations of the uniforms below. */
  pars: string;
  /** GLSL for this vehicle's transform and tint. */
  matrix: string;
  color: string;
  uniforms: Record<string, { value: unknown }>;
}

/**
 * The material for vehicles: vertex colors, their own color on tinted parts,
 * and lights that shine at night. Instanced meshes place them, or a fleet's
 * uniforms; `bob` rocks them on the water.
 */
export function vehicleMaterial(
  shared: SharedUniforms,
  options: { bob?: boolean; fleet?: FleetShader } = {}
): MeshLambertMaterial {
  const { bob = false, fleet } = options;
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    graded(shader, shared, { before: LIGHTS, glow: LIGHTS_GLOW });
    shader.uniforms.uLife = shared.uLife;
    Object.assign(shader.uniforms, fleet?.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${VEHICLE_PARS}\n${fleet ? `#define FLEET\n${fleet.pars}` : ""}`
      )
      .replace(
        "#include <color_vertex>",
        fleet
          ? vehicleColor(fleet.color, fleet.matrix)
          : vehicleColor("instanceColor.rgb", "instanceMatrix")
      );
    if (fleet) {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <beginnormal_vertex>",
          `vec3 objectNormal = mat3(${fleet.matrix}) * normal;`
        )
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = (${fleet.matrix} * vec4(position, 1.0)).xyz;`
        );
    } else if (bob) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        BOB
      );
    }
  };
  material.customProgramCacheKey = () =>
    fleet ? `map-fleet-${fleet.pars}` : `map-vehicle${bob ? "-bob" : ""}`;
  return material;
}
