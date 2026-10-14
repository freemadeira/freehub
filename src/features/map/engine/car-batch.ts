import type { BufferGeometry, Material } from "three";
import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshDepthMaterial,
  SRGBColorSpace,
} from "three";

import type { SharedUniforms } from "./materials.ts";
import type { Placement } from "./road-network.ts";
import { vehicleMaterial } from "./vehicles.ts";

/**
 * Each vehicle's pose as two attributes: where it is and its heading, then
 * its pitch, scale, tint and lights. The shape is turned to its heading,
 * pitched nose up, x to its left, and scaled.
 */
const CAR_PARS = `
attribute vec4 aPose;
attribute vec4 aLook;
uniform vec3 carTints[8];
mat4 carMatrix() {
  float cy = cos(aPose.w);
  float sy = sin(aPose.w);
  float cp = cos(aLook.x);
  float sp = sin(aLook.x);
  vec3 forward = vec3(sy * cp, sp, cy * cp);
  vec3 up = vec3(-sy * sp, cp, -cy * sp);
  vec3 left = vec3(cy, 0.0, -sy);
  return mat4(vec4(left * aLook.y, 0.0), vec4(up * aLook.y, 0.0), vec4(forward * aLook.y, 0.0), vec4(aPose.xyz, 1.0));
}
`;

/**
 * One kind of vehicle drawn many times, posed from attributes rewritten
 * every frame: only the vehicles in view, and only as many as there are.
 */
export class CarBatch {
  readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: Material;
  private readonly depth?: MeshDepthMaterial;
  private pose: InstancedBufferAttribute;
  private look: InstancedBufferAttribute;
  private capacity = 256;
  private count = 0;

  constructor(
    shape: BufferGeometry,
    shared: SharedUniforms,
    tints: number[],
    shadows: boolean
  ) {
    this.geometry = new InstancedBufferGeometry().copy(
      shape as InstancedBufferGeometry
    );
    this.pose = this.attribute("aPose");
    this.look = this.attribute("aLook");
    this.material = vehicleMaterial(shared, {
      fleet: {
        color: "carTints[int(aLook.z)]",
        matrix: "carMatrix()",
        pars: CAR_PARS,
        signals: "aLook.w",
        uniforms: {
          carTints: {
            value: tints.map((hex) => new Color().setHex(hex, SRGBColorSpace)),
          },
        },
      },
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = shadows;
    this.mesh.castShadow = shadows;
    this.mesh.renderOrder = 2;
    if (shadows) {
      this.depth = new MeshDepthMaterial();
      this.depth.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>\n${CAR_PARS}`)
          .replace(
            "#include <begin_vertex>",
            "vec3 transformed = (carMatrix() * vec4(position, 1.0)).xyz;"
          );
      };
      this.depth.customProgramCacheKey = () => "map-cars-depth";
      this.mesh.customDepthMaterial = this.depth;
    }
  }

  private attribute(name: string, old?: InstancedBufferAttribute) {
    const attribute = new InstancedBufferAttribute(
      new Float32Array(this.capacity * 4),
      4
    );
    attribute.setUsage(DynamicDrawUsage);
    if (old) {
      attribute.array.set(old.array);
    }
    this.geometry.setAttribute(name, attribute);
    return attribute;
  }

  /** Adds a vehicle to this frame's draw; `signals` are its light bits. */
  push(placed: Placement, scale: number, tint: number, signals: number): void {
    if (this.count >= this.capacity) {
      this.capacity *= 2;
      this.pose = this.attribute("aPose", this.pose);
      this.look = this.attribute("aLook", this.look);
    }
    const at = this.count * 4;
    const pose = this.pose.array;
    const look = this.look.array;
    pose[at] = placed.x;
    pose[at + 1] = placed.y;
    pose[at + 2] = placed.z;
    pose[at + 3] = placed.heading;
    look[at] = placed.pitch;
    look[at + 1] = scale;
    look[at + 2] = tint;
    look[at + 3] = signals;
    this.count += 1;
  }

  /** Sends this frame's vehicles to the GPU. */
  flush(): void {
    this.geometry.instanceCount = this.count;
    for (const attribute of [this.pose, this.look]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, this.count * 4);
      attribute.needsUpdate = true;
    }
    this.mesh.visible = this.count > 0;
    this.count = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.depth?.dispose();
  }
}
