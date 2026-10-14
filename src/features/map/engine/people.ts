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
import type { PeopleData } from "./protocol.ts";
import { PATH_WIDTH, STANDER_STRIDE, WALKER_STRIDE } from "./protocol.ts";
import { JOINTS, LIMB, MARK } from "./vehicles.ts";

/** Meters from the camera where people fade out. */
const FADE = [260, 520];
/** Meters a person covers in a full stride, left foot and right. */
const STRIDE = 1.45;

const SHIRTS = [
  0xe8_6a_5f, 0x6f_9f_d8, 0xf2_cf_63, 0x8f_d3_b6, 0xf4_f4_f2, 0xd6_8f_d0,
  0xf0_a0_6a, 0x55_63_80,
];
const SKINS = [0xf3_d3_b8, 0xe8_b8_94, 0xc9_8f_6b, 0x9a_66_48, 0x6e_4a_33];
const HAIRS = [
  0x2b_24_20, 0x4a_34_26, 0x7a_56_36, 0xc9_a2_6a, 0xd9_d4_cc, 0x9a_3c_2a,
];
const PANTS = [
  0x3b_46_60, 0x2d_30_38, 0x7d_76_66, 0xc9_b4_8f, 0x5a_6b_8c, 0xe9_e4_da,
];

function colors(list: number[]): Color[] {
  return list.map((hex) => new Color().setHex(hex, SRGBColorSpace));
}

/**
 * How each person looks, from their id: shirt, skin, hair and trousers from
 * small palettes, some bald, most grown-ups and a few children; fewer out
 * at night.
 */
const LOOKS = `
attribute float mark;
attribute float limb;
uniform float uLife;
uniform float uNight;
uniform vec2 peopleFade;
uniform vec3 shirts[8];
uniform vec3 skins[5];
uniform vec3 hairs[6];
uniform vec3 pants[6];

float personHash(float n) {
  return fract(sin(n) * 43758.5453123);
}

bool isPart(float value) {
  return abs(mark - value) < 0.25;
}

vec3 personColor(float id) {
  vec3 skin = skins[int(personHash(id * 13.7) * 4.999)];
  vec3 tint = color;
  if (isPart(${MARK.tint}.0)) {
    tint = shirts[int(personHash(id * 11.1) * 7.999)];
  } else if (isPart(${MARK.skin}.0)) {
    tint = skin;
  } else if (isPart(${MARK.hair}.0)) {
    tint = mix(hairs[int(personHash(id * 19.9) * 5.999)], skin, step(0.93, personHash(id * 17.3)));
  } else if (isPart(${MARK.pants}.0)) {
    tint = pants[int(personHash(id * 23.3) * 5.999)];
  }
  return tint;
}

float personSize(float id) {
  float pick = personHash(id * 29.7);
  return pick < 0.07 ? 0.6 + 0.12 * personHash(id * 31.1) : 0.9 + 0.18 * personHash(id * 37.3);
}

// Fewer people out at night.
float outTonight(float id) {
  return step(personHash(id * 41.9), mix(1.0, 0.4, uNight));
}

bool isLimb(float value) {
  return abs(limb - value) < 0.25;
}

// Turns a point about the x axis through a joint at height y.
vec3 swing(vec3 p, float joint, float angle) {
  float dy = p.y - joint;
  float c = cos(angle);
  float s = sin(angle);
  return vec3(p.x, joint + dy * c - p.z * s, dy * s + p.z * c);
}

// A person's pose: legs and arms swinging with the stride while they walk,
// an arm raised now and then while they talk, and the head looking about.
vec3 personPose(vec3 p, float phase, float walk, float gesture, float look) {
  float stride = sin(phase);
  if (isLimb(${LIMB.leftLeg}.0)) {
    p = swing(p, ${JOINTS.hip}, -0.42 * walk * stride);
  } else if (isLimb(${LIMB.rightLeg}.0)) {
    p = swing(p, ${JOINTS.hip}, 0.42 * walk * stride);
  } else if (isLimb(${LIMB.leftArm}.0)) {
    p = swing(p, ${JOINTS.shoulder}, 0.5 * walk * stride - 1.1 * gesture);
  } else if (isLimb(${LIMB.rightArm}.0)) {
    p = swing(p, ${JOINTS.shoulder}, -0.5 * walk * stride - 0.15 * gesture);
  } else if (isLimb(${LIMB.head}.0)) {
    float c = cos(look);
    float s = sin(look);
    p = vec3(p.x * c + p.z * s, p.y, p.z * c - p.x * s);
  }
  // Up a little at each step.
  p.y += walk * 0.035 * (1.0 - abs(stride));
  return p;
}

vec3 personTurn(vec3 v, vec2 forward) {
  return vec3(v.x * forward.y + v.z * forward.x, v.y, v.z * forward.y - v.x * forward.x);
}
`;

/**
 * Each slot works out where its person is from the time alone: people go
 * round their lane's loop at a steady pace and spacing, and the slot shows
 * the one on its stretch of path, going its way. Some stop a while every so
 * often, stepping aside to look about, then catch up. See `WALKER_STRIDE`.
 */
const WALK = `
attribute vec4 aRoute;
attribute vec4 aSlot;
attribute vec4 aPath;
attribute vec3 aEnds;
uniform sampler2D pathMap;

vec4 pathAt(float index) {
  int i = int(index);
  return texelFetch(pathMap, ivec2(i % ${PATH_WIDTH}, i / ${PATH_WIDTH}), 0);
}

// Shrinks near an end where people leave the path.
float walkEnd(float kind, float distance) {
  return kind < 0.5 ? 1.0 : smoothstep(0.0, 5.0, distance);
}

// How far behind a steady walk a person is, in seconds of walking, and how
// fast they're going now, 1 being steady. A third of people stop now and
// then: easing to a halt, waiting, easing off, a little quicker after.
vec2 dawdle(float id, float time) {
  if (personHash(id * 7.3) > 0.35) {
    return vec2(0.0, 1.0);
  }
  float cycle = 22.0 + 22.0 * personHash(id * 3.7);
  float hold = 2.0 + 3.0 * personHash(id * 5.9);
  float ramp = 0.7;
  float pace = cycle / (cycle - hold - ramp);
  float tau = mod(time + cycle * personHash(id * 9.1), cycle);
  float gone;
  float now;
  if (tau < ramp) {
    gone = pace * (tau - tau * tau / (2.0 * ramp));
    now = pace * (1.0 - tau / ramp);
  } else if (tau < ramp + hold) {
    gone = pace * ramp * 0.5;
    now = 0.0;
  } else if (tau < 2.0 * ramp + hold) {
    float x = tau - ramp - hold;
    gone = pace * (ramp * 0.5 + x * x / (2.0 * ramp));
    now = pace * x / ramp;
  } else {
    gone = pace * (tau - ramp - hold);
    now = pace;
  }
  return vec2(gone - tau, now);
}

struct Walker {
  vec3 position;
  vec2 forward;
  float scale;
  float id;
  float phase;
  float walk;
  float look;
};

Walker walkerPlace() {
  float period = aRoute.x;
  float spacing = aRoute.y;
  float speed = aRoute.w;
  float count = max(1.0, floor(period / spacing + 0.5));
  float moved = aRoute.z + uLife * speed - aSlot.x;
  float lap = floor(moved / spacing);
  float id = personHash(aEnds.z * 0.0173 + mod(aSlot.y - lap, count) * 1.6180339);
  vec2 pause = dawdle(id, uLife);
  float along = aSlot.x + (moved - lap * spacing) + aSlot.y * spacing
    + (personHash(id * 37.3 + 0.71) - 0.5) * 0.5 * spacing + pause.x * speed;
  float u = mod(along, period);
  float shown = outTonight(id);

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
    return Walker(vec3(0.0), vec2(0.0, 1.0), 0.0, id, 0.0, 0.0, 0.0);
  }

  float scale = shown;
  if (!closed) {
    scale *= walkEnd(startEnd, s) * walkEnd(endEnd, len - s);
  }
  // Where the next data tile takes over, people can't carry on.
  if (mod(seams, 2.0) > 0.5) {
    scale *= smoothstep(aPath.y, aPath.y + 3.0, s);
  }
  if (seams > 1.5) {
    scale *= smoothstep(aPath.z, aPath.z - 3.0, s);
  }

  float walk = smoothstep(0.05, 0.7, pause.y);
  // Stopped, they step to the side and turn half towards it.
  float stopped = 1.0 - walk;
  side += sign(side + 1e-4) * 0.55 * stopped;

  float index = aPath.x + (s - aPath.y) / 2.0;
  float first = floor(index);
  float t = index - first;
  vec4 a = pathAt(first);
  vec4 b = pathAt(first + 1.0);
  vec3 point = mix(a.xyz, b.xyz, t);
  vec2 tangent = normalize(mix(vec2(sin(a.w), cos(a.w)), vec2(sin(b.w), cos(b.w)), t) + 1e-5);
  vec2 left = vec2(tangent.y, -tangent.x);
  point.xz += left * side;
  vec2 forward = normalize(tangent * travel + left * sideRate);
  forward = normalize(mix(forward, left * sign(side + 1e-4), 0.6 * stopped));

  float far = distance((modelMatrix * vec4(point, 1.0)).xyz, cameraPosition);
  scale *= 1.0 - smoothstep(peopleFade.x, peopleFade.y, far);
  float size = personSize(id);
  float look = stopped * 0.7 * sin(uLife * 0.6 + id * 20.0)
    + walk * 0.35 * smoothstep(0.85, 1.0, sin(uLife * 0.23 + id * 9.0));
  return Walker(point, forward, scale * size, id, along * ${((2 * Math.PI) / STRIDE).toFixed(5)} / size, walk, look);
}
`;

const WALK_COLOR = `
Walker placed = walkerPlace();
vColor = vec4(personColor(placed.id), 1.0);
`;

const WALK_POSITION = `
vec3 posed = personPose(position, placed.phase, placed.walk, 0.0, placed.look);
vec3 transformed = placed.position + personTurn(posed * placed.scale, placed.forward);
`;

/** People standing about: chatting, gesturing now and then, looking round. */
const STAND = `
attribute vec4 aSpot;
attribute float aId;
`;

const STAND_COLOR = `
vColor = vec4(personColor(aId), 1.0);
`;

const STAND_POSITION = `
vec2 facing = vec2(sin(aSpot.w), cos(aSpot.w));
float far = distance((modelMatrix * vec4(aSpot.xyz, 1.0)).xyz, cameraPosition);
float size = personSize(aId) * outTonight(aId) * (1.0 - smoothstep(peopleFade.x, peopleFade.y, far));
float talk = smoothstep(0.7, 0.95, sin(uLife * (0.5 + 0.4 * personHash(aId * 3.1)) + aId * 31.0));
float look = 0.45 * sin(uLife * 0.4 + aId * 13.0);
vec3 posed = personPose(position, 0.0, 0.0, talk, look);
// Shifting their weight from foot to foot.
posed.x += 0.03 * sin(uLife * 0.7 + aId * 5.0) * smoothstep(0.0, ${JOINTS.hip}, position.y);
vec3 transformed = aSpot.xyz + personTurn(posed * size, facing);
`;

const NORMAL_WALK = "vec3 objectNormal = personTurn(normal, placed.forward);";
const NORMAL_STAND =
  "vec3 objectNormal = personTurn(normal, vec2(sin(aSpot.w), cos(aSpot.w)));";

/** People walking along a path texture, or without one, standing. */
function peopleMaterial(
  shared: SharedUniforms,
  paths?: DataTexture
): MeshLambertMaterial {
  const walking = paths !== undefined;
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    graded(shader, shared);
    Object.assign(shader.uniforms, {
      hairs: { value: colors(HAIRS) },
      pants: { value: colors(PANTS) },
      pathMap: { value: paths },
      peopleFade: { value: FADE },
      shirts: { value: colors(SHIRTS) },
      skins: { value: colors(SKINS) },
      uLife: shared.uLife,
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${LOOKS}\n${walking ? WALK : STAND}`
      )
      .replace("#include <color_vertex>", walking ? WALK_COLOR : STAND_COLOR)
      .replace(
        "#include <beginnormal_vertex>",
        walking ? NORMAL_WALK : NORMAL_STAND
      )
      .replace(
        "#include <begin_vertex>",
        walking ? WALK_POSITION : STAND_POSITION
      );
  };
  material.customProgramCacheKey = () =>
    walking ? "map-people-walking" : "map-people-standing";
  return material;
}

/**
 * A tile's people: walking along its path texture, and standing about.
 * Dispose them with `disposePeople`.
 */
export function createPeople(
  data: PeopleData,
  person: BufferGeometry,
  shared: SharedUniforms,
  bounds: Sphere
): Mesh[] {
  const meshes: Mesh[] = [];
  const make = (
    values: Float32Array,
    stride: number,
    layout: [string, number, number][],
    material: MeshLambertMaterial
  ) => {
    const geometry = new InstancedBufferGeometry().copy(
      person as InstancedBufferGeometry
    );
    const buffer = new InstancedInterleavedBuffer(values, stride, 1);
    for (const [name, size, offset] of layout) {
      geometry.setAttribute(
        name,
        new InterleavedBufferAttribute(buffer, size, offset)
      );
    }
    geometry.instanceCount = values.length / stride;
    // The shape sits at the origin; its people spread over the whole tile.
    geometry.boundingSphere = bounds.clone();
    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    mesh.name = "people";
    [, mesh.userData.far] = FADE;
    meshes.push(mesh);
    return mesh;
  };
  if (data.walkers.length > 0) {
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
    const walkers = make(
      data.walkers,
      WALKER_STRIDE,
      [
        ["aRoute", 4, 0],
        ["aSlot", 4, 4],
        ["aPath", 4, 8],
        ["aEnds", 3, 12],
      ],
      peopleMaterial(shared, paths)
    );
    walkers.userData.paths = paths;
  }
  if (data.standers.length > 0) {
    make(
      data.standers,
      STANDER_STRIDE,
      [
        ["aSpot", 4, 0],
        ["aId", 1, 4],
      ],
      peopleMaterial(shared)
    );
  }
  return meshes;
}

/** Frees one of a tile's people meshes, with its path texture. */
export function disposePeople(mesh: Mesh): void {
  mesh.geometry.dispose();
  (mesh.material as MeshLambertMaterial).dispose();
  (mesh.userData.paths as DataTexture | undefined)?.dispose();
}
