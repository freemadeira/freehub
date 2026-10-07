import type { BufferGeometry, Material, Matrix4 } from "three";
import {
  Color,
  InstancedBufferGeometry,
  Matrix4 as Transform,
  Mesh,
  MeshDepthMaterial,
} from "three";

import type { SharedUniforms } from "./materials.ts";
import { vehicleMaterial } from "./vehicles.ts";

const PARS = (count: number) => `
uniform mat4 fleetMatrices[${count}];
uniform vec3 fleetColors[${count}];
`;

const POSITION =
  "vec3 transformed = (fleetMatrices[gl_InstanceID] * vec4(position, 1.0)).xyz;";

/**
 * A few vehicles moved every frame, like planes and ferries. Their transforms
 * go to the GPU as uniforms: rewriting an instance buffer every frame makes
 * the GPU stop and wait for the frame still drawing from it.
 */
export class Fleet {
  readonly mesh: Mesh;
  private readonly matrices: Transform[];
  private readonly colors: Color[];
  private readonly hidden = new Transform().makeScale(0, 0, 0);

  constructor(
    shape: BufferGeometry,
    shared: SharedUniforms,
    count: number,
    shadows: boolean
  ) {
    const size = Math.max(1, count);
    this.matrices = Array.from({ length: size }, () => this.hidden.clone());
    this.colors = Array.from({ length: size }, () => new Color(1, 1, 1));
    const geometry = new InstancedBufferGeometry().copy(
      shape as InstancedBufferGeometry
    );
    geometry.instanceCount = size;
    const material = vehicleMaterial(shared, {
      fleet: {
        color: "fleetColors[gl_InstanceID]",
        matrix: "fleetMatrices[gl_InstanceID]",
        pars: PARS(size),
        uniforms: {
          fleetColors: { value: this.colors },
          fleetMatrices: { value: this.matrices },
        },
      },
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
    if (shadows) {
      const depth = new MeshDepthMaterial();
      depth.onBeforeCompile = (shader) => {
        shader.uniforms.fleetMatrices = { value: this.matrices };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>\n${PARS(size)}`)
          .replace("#include <begin_vertex>", POSITION);
      };
      depth.customProgramCacheKey = () => `map-fleet-depth-${size}`;
      this.mesh.customDepthMaterial = depth;
    }
  }

  /** Shows a vehicle where `matrix` puts it; `color` tints its tinted parts. */
  set(index: number, matrix: Matrix4, color?: Color): void {
    this.matrices[index]?.copy(matrix);
    if (color) {
      this.colors[index]?.copy(color);
    }
  }

  hide(index: number): void {
    this.matrices[index]?.copy(this.hidden);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as Material).dispose();
    this.mesh.customDepthMaterial?.dispose();
  }
}
