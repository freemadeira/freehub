import type { BufferGeometry, Sphere } from "three";
import {
  Color,
  DataTexture,
  FloatType,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
} from "three";

import type { SharedUniforms } from "./materials.ts";
import { graded } from "./materials.ts";
import type { TrafficData } from "./protocol.ts";
import { PATH_WIDTH, TRAFFIC_STRIDE } from "./protocol.ts";
import { MARK } from "./vehicles.ts";

/**
 * Each slot works out where its car is from the time alone: cars go round
 * their lane's loop at a steady speed and spacing, and the slot shows the one
 * that's on its stretch of road, going its way. See `TRAFFIC_STRIDE`.
 */
const PARS = `
attribute vec4 aRoute;
attribute vec4 aSlot;
attribute vec4 aPath;
attribute vec3 aEnds;
attribute float mark;
uniform sampler2D pathMap;
uniform float uLife;
uniform vec2 trafficFade;
uniform float trafficWalk;
uniform vec3 tints[8];
varying float vMark;

float trafficHash(float n) {
  return fract(sin(n) * 43758.5453123);
}

vec4 pathAt(float index) {
  int i = int(index);
  return texelFetch(pathMap, ivec2(i % ${PATH_WIDTH}, i / ${PATH_WIDTH}), 0);
}

vec3 trafficTurn(vec3 v, vec2 forward) {
  return vec3(v.x * forward.y + v.z * forward.x, v.y, v.z * forward.y - v.x * forward.x);
}

// Shrinks near an end where traffic leaves the road; sinks it into a tunnel.
float trafficEnd(float kind, float distance, inout float sink) {
  if (kind < 0.5) {
    return 1.0;
  }
  if (abs(kind - 2.0) < 0.5) {
    sink += 3.0 * (1.0 - smoothstep(0.0, 12.0, distance));
    return smoothstep(0.0, 1.5, distance);
  }
  return smoothstep(0.0, 5.0, distance);
}

struct Placed {
  vec3 position;
  vec2 forward;
  float scale;
  float id;
};

Placed trafficPlace() {
  float period = aRoute.x;
  float spacing = aRoute.y;
  float count = max(1.0, floor(period / spacing + 0.5));
  float moved = aRoute.z + uLife * aRoute.w - aSlot.x;
  float lap = floor(moved / spacing);
  float u = aSlot.x + (moved - lap * spacing) + aSlot.y * spacing;
  float id = trafficHash(aEnds.z * 0.0173 + mod(aSlot.y - lap, count) * 1.6180339);
  float shown = 1.0;
  u = mod(u + (trafficHash(id * 37.3 + 0.71) - 0.5) * 0.5 * spacing, period);

  float code = aEnds.y;
  float startEnd = mod(code, 4.0);
  float endEnd = mod(floor(code / 4.0), 4.0);
  bool twoWay = mod(floor(code / 16.0), 2.0) > 0.5;
  bool reversed = mod(floor(code / 32.0), 2.0) > 0.5;
  float seams = floor(code / 64.0);
  float len = aPath.w;
  float right = aSlot.w;
  bool closed = !twoWay && period - len < 0.01;

  float travel = reversed ? -1.0 : 1.0;
  float s = reversed ? len - u : u;
  float side = -travel * right;
  float sideRate = 0.0;
  if (twoWay) {
    float back = 2.0 * len + aEnds.x;
    travel = u < len ? 1.0 : -1.0;
    s = u < len ? u : back - u;
    shown *= (u < len || (u >= len + aEnds.x && u < back)) ? 1.0 : 0.0;
    side = -travel * right;
    // Dead ends: swing round onto the other side.
    float radius = max(abs(right), 3.0);
    float atEnd = (u - (len - radius)) / (2.0 * radius);
    if (endEnd < 0.5 && atEnd > 0.0 && atEnd < 1.0) {
      side = -right * cos(PI * atEnd);
      sideRate = right * PI / (2.0 * radius) * sin(PI * atEnd);
    }
    float atStart = ((u < len ? u : u - period) + radius) / (2.0 * radius);
    if (startEnd < 0.5 && atStart > 0.0 && atStart < 1.0) {
      side = right * cos(PI * atStart);
      sideRate = -right * PI / (2.0 * radius) * sin(PI * atStart);
    }
  } else {
    shown *= step(u, len);
  }
  // Only the slot for this stretch and direction draws it.
  shown *= step(aPath.y, s) * step(s, aPath.z) * step(abs(travel - aSlot.z), 0.5);
  if (shown < 0.5) {
    return Placed(vec3(0.0), vec2(0.0, 1.0), 0.0, id);
  }

  float sink = 0.0;
  float scale = shown;
  if (!closed) {
    scale *= trafficEnd(startEnd, s, sink) * trafficEnd(endEnd, len - s, sink);
  }
  // Where the next data tile takes over, traffic can't carry on.
  if (mod(seams, 2.0) > 0.5) {
    scale *= smoothstep(aPath.y, aPath.y + 3.0, s);
  }
  if (seams > 1.5) {
    scale *= smoothstep(aPath.z, aPath.z - 3.0, s);
  }

  float index = aPath.x + (s - aPath.y) / 2.0;
  float first = floor(index);
  float t = index - first;
  vec4 a = pathAt(first);
  vec4 b = pathAt(first + 1.0);
  vec3 point = mix(a.xyz, b.xyz, t);
  vec2 tangent = normalize(mix(vec2(sin(a.w), cos(a.w)), vec2(sin(b.w), cos(b.w)), t) + 1e-5);
  vec2 left = vec2(tangent.y, -tangent.x);
  point.xz += left * side;
  point.y -= sink;
  vec2 forward = normalize(tangent * travel + left * sideRate);

  float far = distance((modelMatrix * vec4(point, 1.0)).xyz, cameraPosition);
  scale *= 1.0 - smoothstep(trafficFade.x, trafficFade.y, far);
  return Placed(point, forward, scale, id);
}
`;

const PLACE = `
Placed placed = trafficPlace();
vColor = vec4(abs(mark - ${MARK.tint}.0) < 0.25 ? tints[int(placed.id * 7.999)] : color, 1.0);
vMark = mark;
`;

const NORMAL = "vec3 objectNormal = trafficTurn(normal, placed.forward);";

const POSITION = `
vec3 local = position * placed.scale;
local.y += trafficWalk * abs(sin(uLife * 7.0 + placed.id * 40.0)) * 0.07 * placed.scale;
vec3 transformed = placed.position + trafficTurn(local, placed.forward);
`;

const GLOW = `
varying float vMark;
float isMark(float value) {
  return 1.0 - step(0.25, abs(vMark - value));
}
`;

type Kind = "cars" | "people";

/** Meters from the camera where they fade out, and their colors. */
const LOOK: Record<
  Kind,
  { fade: [number, number]; tints: number[]; walk: number }
> = {
  cars: {
    fade: [700, 1300],
    tints: [
      0xf4_f4_f2, 0xc9_ce_d6, 0xe8_6a_5f, 0x6f_9f_d8, 0xf2_cf_63, 0x8f_d3_b6,
      0x55_63_80, 0xef_e3_c8,
    ],
    walk: 0,
  },
  people: {
    fade: [260, 520],
    tints: [
      0xe8_6a_5f, 0x6f_9f_d8, 0xf2_cf_63, 0x8f_d3_b6, 0xf4_f4_f2, 0xd6_8f_d0,
      0xf0_a0_6a, 0x55_63_80,
    ],
    walk: 1,
  },
};

function trafficMaterial(
  shared: SharedUniforms,
  paths: DataTexture,
  kind: Kind
): MeshLambertMaterial {
  const look = LOOK[kind];
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    graded(shader, shared, {
      before: GLOW,
      glow: `isMark(${MARK.front}.0) * vec3(1.0, 0.92, 0.75) * 3.2 + isMark(${MARK.tail}.0) * vec3(1.0, 0.12, 0.06) * 3.4`,
    });
    Object.assign(shader.uniforms, {
      pathMap: { value: paths },
      tints: {
        value: look.tints.map((hex) => new Color().setHex(hex, SRGBColorSpace)),
      },
      trafficFade: { value: look.fade },
      trafficWalk: { value: look.walk },
      uLife: shared.uLife,
    });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PARS}`)
      .replace("#include <color_vertex>", PLACE)
      .replace("#include <beginnormal_vertex>", NORMAL)
      .replace("#include <begin_vertex>", POSITION);
  };
  material.customProgramCacheKey = () => "map-traffic";
  return material;
}

function trafficMesh(
  shape: BufferGeometry,
  slots: Float32Array,
  material: MeshLambertMaterial,
  bounds: Sphere
): Mesh {
  const geometry = new InstancedBufferGeometry().copy(
    shape as InstancedBufferGeometry
  );
  const buffer = new InstancedInterleavedBuffer(slots, TRAFFIC_STRIDE, 1);
  geometry.setAttribute("aRoute", new InterleavedBufferAttribute(buffer, 4, 0));
  geometry.setAttribute("aSlot", new InterleavedBufferAttribute(buffer, 4, 4));
  geometry.setAttribute("aPath", new InterleavedBufferAttribute(buffer, 4, 8));
  geometry.setAttribute("aEnds", new InterleavedBufferAttribute(buffer, 3, 12));
  geometry.instanceCount = slots.length / TRAFFIC_STRIDE;
  // The shape sits at the origin; its slots spread over the whole tile.
  geometry.boundingSphere = bounds.clone();
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * A tile's cars and people: one mesh each, sharing the tile's path texture.
 * Dispose it with `disposeTraffic`.
 */
export function createTraffic(
  data: TrafficData,
  shapes: { car: BufferGeometry; person: BufferGeometry },
  shared: SharedUniforms,
  bounds: Sphere
): Mesh[] {
  const paths = new DataTexture(
    data.paths,
    PATH_WIDTH,
    data.rows,
    RGBAFormat,
    FloatType
  );
  paths.magFilter = NearestFilter;
  paths.minFilter = NearestFilter;
  paths.needsUpdate = true;
  const meshes: Mesh[] = [];
  for (const [kind, slots, shape] of [
    ["cars", data.cars, shapes.car],
    ["people", data.people, shapes.person],
  ] as const) {
    if (slots.length === 0) {
      continue;
    }
    const mesh = trafficMesh(
      shape,
      slots,
      trafficMaterial(shared, paths, kind),
      bounds
    );
    mesh.name = `traffic-${kind}`;
    mesh.userData.paths = paths;
    [, mesh.userData.far] = LOOK[kind].fade;
    meshes.push(mesh);
  }
  if (meshes.length === 0) {
    paths.dispose();
  }
  return meshes;
}

/**
 * Roughly where each car slot's car is, x and z in the tile, two floats a
 * slot: the middle of the stretch of road it covers. Enough to hear how busy
 * a street is; the shader above has the exact places.
 */
export function carSpots(data: TrafficData): Float32Array {
  const { cars, paths } = data;
  const count = cars.length / TRAFFIC_STRIDE;
  const spots = new Float32Array(count * 2);
  for (let slot = 0; slot < count; slot += 1) {
    const at = slot * TRAFFIC_STRIDE;
    const value = (offset: number) => cars[at + offset] ?? 0;
    const u = value(4) + (value(5) + 0.5) * value(1);
    const [first, s0, s1, length, gap, code] = [8, 9, 10, 11, 12, 13].map(
      value
    ) as [number, number, number, number, number, number];
    const twoWay = Math.floor(code / 16) % 2 === 1;
    const reversed = Math.floor(code / 32) % 2 === 1;
    let s = reversed ? length - u : u;
    if (twoWay) {
      s = u < length ? u : 2 * length + gap - u;
    }
    // Path samples are two meters apart.
    const index = first + Math.round((Math.min(s1, Math.max(s0, s)) - s0) / 2);
    spots[slot * 2] = paths[index * 4] ?? 0;
    spots[slot * 2 + 1] = paths[index * 4 + 2] ?? 0;
  }
  return spots;
}

/** Frees a traffic mesh; the path texture goes with the tile's last one. */
export function disposeTraffic(mesh: Mesh): void {
  mesh.geometry.dispose();
  (mesh.material as MeshLambertMaterial).dispose();
  (mesh.userData.paths as DataTexture).dispose();
}
