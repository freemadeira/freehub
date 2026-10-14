import type { BufferGeometry, Material } from "three";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry as Geometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { ROPE_GAP, sagAt } from "./cable.ts";
import type { Aerialway } from "./format.ts";
import type { Frame } from "./geo.ts";
import { toLocal } from "./geo.ts";
import type { Materials } from "./materials.ts";
import { PALETTE } from "./palette.ts";
import { vehicleMaterial } from "./vehicles.ts";
import type { Voice } from "./voice.ts";
import { createVoices } from "./voice.ts";

const VISIBLE_WITHIN = 9000;
/** Meters over the ground packs without heights hang their cables. */
const OLD_HEIGHT = 12;
/** Meters of rope between cabins on a gondola's loop. */
const CABIN_SPACING = 120;
/** Meters a second. */
const GONDOLA_SPEED = 5;
const SHUTTLE_SPEED = 8;
/** Seconds a shuttling cabin waits at each station. */
const DWELL = 20;
const STEEL = 0x8e_97_a8;

/** A rope as a polyline, with distances along it. */
interface Rope {
  points: Vector3[];
  lengths: number[];
}

function ropeOf(points: Vector3[]): Rope {
  let total = 0;
  const lengths = points.map((point, index) => {
    const before = points[index - 1];
    total += before ? point.distanceTo(before) : 0;
    return total;
  });
  return { lengths, points };
}

function lengthOf(rope: Rope): number {
  return rope.lengths.at(-1) ?? 0;
}

function pointAt(rope: Rope, along: number, out: Vector3): Vector3 {
  const total = lengthOf(rope);
  const at = Math.min(total, Math.max(0, along));
  let low = 0;
  let high = rope.lengths.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if ((rope.lengths[middle] ?? 0) <= at) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const start = rope.lengths[low] ?? 0;
  const end = rope.lengths[high] ?? start;
  const t = end > start ? (at - start) / (end - start) : 0;
  return out.lerpVectors(rope.points[low] ?? out, rope.points[high] ?? out, t);
}

/**
 * Where a lift holds its cable: every station and pylon with the height the
 * bake worked out, or, from older packs, every bend at a fixed height.
 */
function supportsOf(
  way: Aerialway,
  frame: Frame,
  ground: (x: number, z: number) => number
): { position: Vector3; pylon: boolean }[] {
  const last = way.path.length - 1;
  return way.path.map((point, index) => {
    const { x, z } = toLocal(frame, point);
    const floor = Math.max(0, ground(x, z));
    return {
      position: new Vector3(x, point.ele ?? floor + OLD_HEIGHT, z),
      pylon: point.ele !== undefined && index > 0 && index < last,
    };
  });
}

/** Right of the way from one point to another, flat. */
function rightAt(from: Vector3, to: Vector3): { x: number; z: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: -dz / length, z: dx / length };
}

function ease(value: number): number {
  return value * value * (3 - 2 * value);
}

/** The rope `side` meters right of the line, sagging between supports. */
function hang(supports: Vector3[], side: number): Vector3[] {
  const points: Vector3[] = [];
  for (let index = 0; index < supports.length - 1; index += 1) {
    const a = supports[index] as Vector3;
    const b = supports[index + 1] as Vector3;
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    const before = supports[Math.max(0, index - 1)] as Vector3;
    const after = supports[Math.min(supports.length - 1, index + 2)] as Vector3;
    // Offsets at each support follow the line through it, so ropes stay apart.
    const ra = rightAt(before, b);
    const rb = rightAt(a, after);
    const steps = Math.max(2, Math.ceil(span / 12));
    for (let step = index === 0 ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps;
      const rx = ra.x + (rb.x - ra.x) * t;
      const rz = ra.z + (rb.z - ra.z) * t;
      const norm = Math.hypot(rx, rz) || 1;
      points.push(
        new Vector3(
          a.x + (b.x - a.x) * t + (rx / norm) * side,
          a.y + (b.y - a.y) * t - sagAt(span, t),
          a.z + (b.z - a.z) * t + (rz / norm) * side
        )
      );
    }
  }
  return points;
}

/** Half a turn round a station's bull wheel, from one rope to the other. */
function turn(from: Vector3, to: Vector3): Vector3[] {
  const center = new Vector3().addVectors(from, to).multiplyScalar(0.5);
  const arm = new Vector3().subVectors(from, center);
  const outward = new Vector3(arm.z, 0, -arm.x);
  const points: Vector3[] = [];
  for (let step = 1; step < 8; step += 1) {
    const angle = (step / 8) * Math.PI;
    points.push(
      center
        .clone()
        .addScaledVector(arm, Math.cos(angle))
        .addScaledVector(outward, Math.sin(angle))
    );
  }
  return points;
}

interface Lift {
  /** A gondola's cabins go round a loop; a cable car's two shuttle. */
  loop?: Rope;
  shuttles?: [Rope, Rope];
  cabins: number;
}

/** A pylon's head: a crossarm carrying both ropes' sheaves, along +x. */
function pylonHead(): BufferGeometry {
  const width = ROPE_GAP * 2 + 1.4;
  return (
    mergeGeometries([
      new BoxGeometry(width, 0.7, 0.9).translate(0, -0.9, 0),
      new BoxGeometry(0.6, 0.5, 3.2).translate(ROPE_GAP, -0.35, 0),
      new BoxGeometry(0.6, 0.5, 3.2).translate(-ROPE_GAP, -0.35, 0),
    ]) ?? new BoxGeometry(width, 0.7, 0.9)
  );
}

/** Cable cars and lifts from OSM: pylons, sagging ropes and moving cabins. */
export class Aerialways {
  readonly group = new Group();
  /** Each cabin, rumbling along its cable while it's drawn. */
  readonly voices: Voice[];
  private readonly lifts: Lift[] = [];
  private readonly cabins: InstancedMesh;
  private readonly cabinMaterial: Material;
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly position = new Vector3();
  private readonly ahead = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private readonly disposables: { dispose: () => void }[] = [];

  constructor(
    aerialways: Aerialway[],
    frame: Frame,
    ground: (x: number, z: number) => number,
    materials: Materials,
    cabin: BufferGeometry,
    shadows: boolean
  ) {
    this.group.name = "aerialways";
    const ropes: Vector3[] = [];
    const pylons: Matrix4[] = [];
    for (const way of aerialways) {
      const supports = supportsOf(way, frame, ground);
      if (supports.length < 2) {
        continue;
      }
      const tops = supports.map((support) => support.position);
      const right = hang(tops, ROPE_GAP);
      const left = hang(tops, -ROPE_GAP);
      for (const rope of [right, left]) {
        for (let index = 1; index < rope.length; index += 1) {
          ropes.push(rope[index - 1] as Vector3, rope[index] as Vector3);
        }
      }
      for (const [index, support] of supports.entries()) {
        if (!support.pylon) {
          continue;
        }
        const before = tops[index - 1] as Vector3;
        const after = tops[index + 1] as Vector3;
        const heading = Math.atan2(after.x - before.x, after.z - before.z);
        const { x, y, z } = support.position;
        const floor = Math.max(0, ground(x, z)) - 1;
        pylons.push(
          new Matrix4()
            .makeRotationY(heading)
            .setPosition(x, floor, z)
            .multiply(new Matrix4().makeScale(1, y - floor, 1)),
          new Matrix4().makeRotationY(heading).setPosition(x, y, z)
        );
      }
      const length = lengthOf(ropeOf(right));
      // Lines without pylons are mostly small cable cars: two cabins.
      const measured = way.path.some((point) => point.ele !== undefined);
      const shuttle =
        way.kind === "cable_car" ||
        (measured && supports.every((support) => !support.pylon));
      if (shuttle) {
        this.lifts.push({
          cabins: 2,
          shuttles: [ropeOf(right), ropeOf(left.toReversed())],
        });
        continue;
      }
      const back = left.toReversed();
      const loop = ropeOf([
        ...right,
        ...turn(right.at(-1) as Vector3, back[0] as Vector3),
        ...back,
        ...turn(back.at(-1) as Vector3, right[0] as Vector3),
        right[0] as Vector3,
      ]);
      this.lifts.push({
        cabins: Math.max(2, Math.round((2 * length) / CABIN_SPACING)),
        loop,
      });
    }

    const ropeGeometry = new Geometry().setFromPoints(ropes);
    const ropeMaterial = new LineBasicMaterial({
      color: new Color(0x4a_53_68),
    });
    this.group.add(new LineSegments(ropeGeometry, ropeMaterial));
    this.disposables.push(ropeGeometry, ropeMaterial);

    if (pylons.length > 0) {
      const pole = new CylinderGeometry(0.45, 0.8, 1, 8).translate(0, 0.5, 0);
      const head = pylonHead();
      const steel = new Color().setHex(STEEL, SRGBColorSpace).toArray();
      for (const geometry of [pole, head]) {
        const { count } = geometry.getAttribute("position");
        const colors = new Float32Array(count * 3);
        for (let index = 0; index < count; index += 1) {
          colors.set(steel, index * 3);
        }
        geometry.setAttribute("color", new BufferAttribute(colors, 3));
      }
      const count = pylons.length / 2;
      const poles = new InstancedMesh(pole, materials.solidInstanced, count);
      const heads = new InstancedMesh(head, materials.solidInstanced, count);
      for (let index = 0; index < count; index += 1) {
        poles.setMatrixAt(index, pylons[index * 2] as Matrix4);
        heads.setMatrixAt(index, pylons[index * 2 + 1] as Matrix4);
      }
      for (const mesh of [poles, heads]) {
        mesh.castShadow = shadows;
        mesh.receiveShadow = shadows;
        mesh.customDepthMaterial = materials.instancedDepth;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      }
      this.disposables.push(pole, head, poles, heads);
    }

    const count = this.lifts.reduce((sum, lift) => sum + lift.cabins, 0);
    this.voices = createVoices(count);
    this.cabinMaterial = vehicleMaterial(materials.shared);
    this.cabins = new InstancedMesh(
      cabin,
      this.cabinMaterial,
      Math.max(1, count)
    );
    for (let index = 0; index < count; index += 1) {
      this.cabins.setColorAt(
        index,
        new Color().setHex(
          PALETTE.cabin[index % PALETTE.cabin.length] ?? 0xf2_6d_5b,
          SRGBColorSpace
        )
      );
    }
    this.cabins.count = count;
    this.cabins.castShadow = shadows;
    this.cabins.customDepthMaterial = materials.tintedDepth;
    this.cabins.frustumCulled = false;
    this.group.add(this.cabins);
  }

  /** Puts a cabin `along` a rope, facing the way it's heading. */
  private place(index: number, rope: Rope, along: number, heading: 1 | -1) {
    pointAt(rope, along, this.position);
    pointAt(rope, along + heading * 2, this.ahead);
    const angle = Math.atan2(
      this.ahead.x - this.position.x,
      this.ahead.z - this.position.z
    );
    this.rotation.setFromAxisAngle(this.up, angle);
    this.matrix.compose(this.position, this.rotation, this.one);
    this.cabins.setMatrixAt(index, this.matrix);
    const voice = this.voices[index] as Voice;
    voice.position.copy(this.position);
    voice.level = 1;
  }

  update(seconds: number, cameraPosition: Vector3, target: Vector3): void {
    const near = cameraPosition.distanceTo(target) < VISIBLE_WITHIN;
    this.group.visible = near && this.lifts.length > 0;
    if (!this.group.visible) {
      for (const voice of this.voices) {
        voice.level = 0;
      }
      return;
    }
    let index = 0;
    for (const lift of this.lifts) {
      if (lift.loop) {
        const total = lengthOf(lift.loop);
        for (let cabin = 0; cabin < lift.cabins; cabin += 1) {
          const along =
            (((seconds * GONDOLA_SPEED + (cabin / lift.cabins) * total) %
              total) +
              total) %
            total;
          this.place(index, lift.loop, along, 1);
          index += 1;
        }
        continue;
      }
      for (const rope of lift.shuttles ?? []) {
        const length = lengthOf(rope);
        const travel = length / SHUTTLE_SPEED;
        const period = 2 * (travel + DWELL);
        // Out along its own rope and back, waiting at each end; the other
        // cabin does the same from the far end, so they pass mid-way.
        const t = (((seconds % period) + period) % period) - DWELL;
        const out = Math.min(1, Math.max(0, t / travel));
        const home = Math.min(1, Math.max(0, (t - travel - DWELL) / travel));
        const share = ease(out) - ease(home);
        const forward = t < travel + DWELL;
        this.place(index, rope, share * length, forward ? 1 : -1);
        index += 1;
      }
    }
    this.cabins.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.cabins.dispose();
    this.cabinMaterial.dispose();
  }
}
