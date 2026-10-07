import type { Material, Object3D, Texture } from "three";
import {
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { Landmark } from "./format.ts";
import type { Frame } from "./geo.ts";
import { toLocal } from "./geo.ts";
import type { SharedUniforms } from "./materials.ts";

const LOAD_WITHIN = 14_000;

/** Lambert in the map's light, graded at night like everything else. */
function adopt(material: Material, shared: SharedUniforms): Material {
  const source = material as MeshStandardMaterial;
  const lambert = new MeshLambertMaterial({
    color: source.color,
    map: source.map,
    vertexColors: Boolean(source.vertexColors),
  });
  const emissive =
    source instanceof MeshStandardMaterial && source.emissiveIntensity > 0
      ? source.emissive.clone().multiplyScalar(source.emissiveIntensity)
      : undefined;
  lambert.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.uNight;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uNight;
vec3 nightGrade(vec3 color) {
  float light = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(color, vec3(0.028, 0.045, 0.115) + light * vec3(0.16, 0.22, 0.42), uNight);
}`
      )
      .replace(
        "#include <opaque_fragment>",
        `outgoingLight = nightGrade(outgoingLight)${emissive ? ` + uNight * vec3(${emissive.r.toFixed(3)}, ${emissive.g.toFixed(3)}, ${emissive.b.toFixed(3)}) * 2.0` : ""};\n#include <opaque_fragment>`
      );
  };
  lambert.customProgramCacheKey = () =>
    `map-landmark-${emissive ? emissive.getHexString() : "plain"}`;
  material.dispose();
  return lambert;
}

/** The model's highest vertex, where its badge belongs. */
function highest(model: Object3D): Vector3 {
  model.updateMatrixWorld(true);
  const top = new Vector3(0, Number.NEGATIVE_INFINITY, 0);
  const point = new Vector3();
  model.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    const positions = object.geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index += 1) {
      point
        .fromBufferAttribute(positions, index)
        .applyMatrix4(object.matrixWorld);
      if (point.y > top.y) {
        top.copy(point);
      }
    }
  });
  return top;
}

/** Frees a model's geometries, materials and their textures. */
function release(root: Object3D) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    object.geometry.dispose();
    const materials: Material[] = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      (material as Material & { map?: Texture | null }).map?.dispose();
      material.dispose();
    }
  });
}

interface Pending {
  landmark: Landmark;
  x: number;
  z: number;
  loading: boolean;
}

/** Hand-made models standing in for the map's own buildings at their spots. */
export class Landmarks {
  readonly group = new Group();
  private readonly loader = new GLTFLoader();
  private readonly pending: Pending[];
  private readonly base: string;
  private readonly ground: (x: number, z: number) => number;
  private readonly shared: SharedUniforms;
  private disposed = false;
  /** A model arrived; `top` is its highest point, in the local frame. */
  onLoad?: (id: string, top: Vector3) => void;

  constructor(
    landmarks: Landmark[],
    frame: Frame,
    base: string,
    ground: (x: number, z: number) => number,
    shared: SharedUniforms
  ) {
    this.group.name = "landmarks";
    this.base = base;
    this.ground = ground;
    this.shared = shared;
    this.pending = landmarks.map((landmark) => ({
      landmark,
      loading: false,
      ...toLocal(frame, landmark),
    }));
  }

  /** Loads the models the camera has come close to. */
  update(cameraX: number, cameraZ: number): void {
    for (const item of this.pending) {
      if (
        item.loading ||
        Math.hypot(item.x - cameraX, item.z - cameraZ) > LOAD_WITHIN
      ) {
        continue;
      }
      item.loading = true;
      this.load(item);
    }
  }

  private async load(item: Pending) {
    try {
      const gltf = await this.loader.loadAsync(
        new URL(item.landmark.model, this.base).href
      );
      if (this.disposed) {
        release(gltf.scene);
        return;
      }
      const model: Object3D = gltf.scene;
      model.traverse((object) => {
        if (object instanceof Mesh) {
          object.material = Array.isArray(object.material)
            ? object.material.map((material) => adopt(material, this.shared))
            : adopt(object.material, this.shared);
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      model.position.set(item.x, this.ground(item.x, item.z), item.z);
      model.rotation.y = (-item.landmark.heading * Math.PI) / 180;
      model.name = item.landmark.id;
      this.group.add(model);
      this.onLoad?.(item.landmark.id, highest(model));
    } catch {
      // A missing model leaves the map as it was.
    }
  }

  dispose(): void {
    this.disposed = true;
    release(this.group);
  }
}
