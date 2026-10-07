import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Vector3,
} from "three";

import type { Aerialway } from "./format.ts";
import type { Frame } from "./geo.ts";
import { toLocal } from "./geo.ts";
import type { Materials } from "./materials.ts";
import { PALETTE } from "./palette.ts";

const HANG = 2.6;
const VISIBLE_WITHIN = 9000;

interface Cable {
  points: Vector3[];
  /** Distance along the cable at each point. */
  lengths: number[];
  cabins: number;
  speed: number;
}

function pointAt(cable: Cable, along: number, out: Vector3): Vector3 {
  const total = cable.lengths.at(-1) ?? 0;
  const at = ((along % total) + total) % total;
  let index = 1;
  while (index < cable.lengths.length - 1 && (cable.lengths[index] ?? 0) < at) {
    index += 1;
  }
  const start = cable.lengths[index - 1] ?? 0;
  const end = cable.lengths[index] ?? start;
  const t = end > start ? (at - start) / (end - start) : 0;
  return out.lerpVectors(
    cable.points[index - 1] ?? out,
    cable.points[index] ?? out,
    t
  );
}

/** Cable cars and lifts from OSM: a sagging cable and cabins riding it. */
export class Aerialways {
  readonly group = new Group();
  private readonly cables: Cable[] = [];
  private readonly cabins: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly ahead = new Vector3();
  private readonly lines: Line[] = [];
  private readonly cableMaterial: LineBasicMaterial;

  constructor(
    aerialways: Aerialway[],
    frame: Frame,
    ground: (x: number, z: number) => number,
    materials: Materials
  ) {
    this.group.name = "aerialways";
    this.cableMaterial = new LineBasicMaterial({
      color: new Color(0x4a_53_68),
    });
    for (const way of aerialways) {
      const stations = way.path.map((point) => {
        const { x, z } = toLocal(frame, point);
        return new Vector3(x, Math.max(0, ground(x, z)) + 12, z);
      });
      const points: Vector3[] = [];
      for (let index = 0; index < stations.length - 1; index += 1) {
        const a = stations[index] ?? new Vector3();
        const b = stations[index + 1] ?? new Vector3();
        const span = a.distanceTo(b);
        const steps = Math.max(2, Math.ceil(span / 40));
        for (let step = 0; step < steps; step += 1) {
          const t = step / steps;
          const point = new Vector3().lerpVectors(a, b, t);
          // A gentle sag between pylons.
          point.y -= Math.sin(t * Math.PI) * span * 0.035;
          points.push(point);
        }
      }
      const last = stations.at(-1);
      if (!last || points.length === 0) {
        continue;
      }
      points.push(last);
      const lengths = [0];
      for (let index = 1; index < points.length; index += 1) {
        lengths.push(
          (lengths.at(-1) ?? 0) +
            (points[index] ?? last).distanceTo(points[index - 1] ?? last)
        );
      }
      const total = lengths.at(-1) ?? 0;
      const gondola = way.kind === "gondola" || way.kind === "chair_lift";
      this.cables.push({
        cabins: gondola ? Math.max(2, Math.round(total / 140)) : 2,
        lengths,
        points,
        speed: gondola ? 4 : 7,
      });
      const line = new Line(
        new BufferGeometry().setFromPoints(points),
        this.cableMaterial
      );
      this.lines.push(line);
      this.group.add(line);
    }
    const count = this.cables.reduce((sum, cable) => sum + cable.cabins, 0);
    this.cabins = new InstancedMesh(
      new BoxGeometry(2.2, 2.3, 2.6).translate(0, -HANG, 0),
      materials.solid,
      Math.max(1, count)
    );
    // The solid material reads vertex colors: white, tinted per cabin.
    const vertices = this.cabins.geometry.getAttribute("position").count;
    this.cabins.geometry.setAttribute(
      "color",
      new BufferAttribute(new Float32Array(vertices * 3).fill(1), 3)
    );
    let index = 0;
    for (const cable of this.cables) {
      for (let cabin = 0; cabin < cable.cabins; cabin += 1) {
        this.cabins.setColorAt(
          index,
          new Color(PALETTE.cabin[index % PALETTE.cabin.length] ?? 0xf2_6d_5b)
        );
        index += 1;
      }
    }
    this.cabins.count = count;
    this.cabins.castShadow = true;
    this.cabins.frustumCulled = false;
    this.group.add(this.cabins);
  }

  update(seconds: number, cameraPosition: Vector3, target: Vector3): void {
    const near = cameraPosition.distanceTo(target) < VISIBLE_WITHIN;
    this.group.visible = near && this.cables.length > 0;
    if (!this.group.visible) {
      return;
    }
    let index = 0;
    for (const cable of this.cables) {
      const total = cable.lengths.at(-1) ?? 1;
      for (let cabin = 0; cabin < cable.cabins; cabin += 1) {
        let along: number;
        if (cable.cabins === 2 && cable.speed > 5) {
          // Two cars shuttling, passing each other mid-way.
          const phase =
            (Math.sin(((seconds * cable.speed) / total) * Math.PI) + 1) / 2;
          along = cabin === 0 ? phase * total : (1 - phase) * total;
        } else {
          along = seconds * cable.speed + (cabin / cable.cabins) * total;
        }
        pointAt(cable, along, this.position);
        pointAt(cable, along + 2, this.ahead);
        const heading = Math.atan2(
          this.ahead.x - this.position.x,
          this.ahead.z - this.position.z
        );
        this.matrix.makeRotationY(heading);
        this.matrix.setPosition(this.position);
        this.cabins.setMatrixAt(index, this.matrix);
        index += 1;
      }
    }
    this.cabins.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const line of this.lines) {
      line.geometry.dispose();
    }
    this.cableMaterial.dispose();
    this.cabins.geometry.dispose();
    this.cabins.dispose();
  }
}
