import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from "three";

import type { Materials } from "./materials.ts";
import { SEA_COLOR } from "./sea.ts";

const SIZE = 400_000;

const vertexShader = `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = `
#include <common>
#include <fog_pars_fragment>
uniform float uNight;
uniform float uTime;
${SEA_COLOR}
varying vec3 vWorld;

void main() {
  gl_FragColor = vec4(seaColor(vWorld.xz), 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The sea: one plane at sea level, colored by distance from the coast. */
export function createWater(materials: Materials): Mesh {
  const material = new ShaderMaterial({
    fog: true,
    fragmentShader,
    uniforms: UniformsUtils.merge([UniformsLib.fog]),
    vertexShader,
  });
  // Merging copies values, textures included; these stay shared instead.
  Object.assign(material.uniforms, materials.sea, {
    uNight: materials.shared.uNight,
    uTime: materials.shared.uTime,
  });
  const geometry = new PlaneGeometry(SIZE, SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  mesh.renderOrder = -1;
  return mesh;
}
