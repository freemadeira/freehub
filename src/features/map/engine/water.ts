import type { Texture } from "three";
import {
  Color,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  UniformsLib,
  UniformsUtils,
} from "three";

import type { SeaGrid } from "./format.ts";
import type { SharedUniforms } from "./materials.ts";

const SIZE = 400_000;

function color(hex: number): Color {
  return new Color().setHex(hex, SRGBColorSpace);
}

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
uniform sampler2D seaMap;
uniform vec3 seaGrid;
uniform vec2 seaCells;
uniform float seaMax;
uniform float uNight;
uniform float uTime;
uniform vec3 shallow;
uniform vec3 middle;
uniform vec3 deep;
uniform vec3 nightShallow;
uniform vec3 nightDeep;
varying vec3 vWorld;

float ripple(vec2 p) {
  return sin(p.x * 0.031 + uTime * 0.6) * sin(p.y * 0.027 - uTime * 0.45);
}

void main() {
  vec2 uv = ((vWorld.xz - seaGrid.xy) / seaGrid.z + 0.5) / seaCells;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float encoded = texture2D(seaMap, uv).r;
  float distance = mix(seaMax, encoded * encoded * seaMax, inside);
  vec3 tint = mix(shallow, middle, smoothstep(6.0, 260.0, distance));
  tint = mix(tint, deep, smoothstep(260.0, 1800.0, distance));
  tint *= 1.0 + ripple(vWorld.xz) * 0.025;

  // Surf: a bright edge along the shore, and lines rolling in. The lines are
  // drawn as wide as a pixel needs and fade out once they'd be thinner.
  float phase = distance * 0.2 - uTime * 1.4 + ripple(vWorld.xz * 2.0) * 2.0;
  float blur = fwidth(phase);
  float crest = smoothstep(0.8 - blur, 0.97 + blur * 0.5, sin(phase));
  float lines = crest * smoothstep(60.0, 14.0, distance) * (1.0 - smoothstep(0.6, 1.6, blur));
  float edge = smoothstep(12.0 + fwidth(distance), 1.5, distance);
  float foam = clamp(edge * 0.9 + lines * 0.5, 0.0, 1.0);
  tint = mix(tint, vec3(1.0), foam);

  vec3 night = mix(nightShallow, nightDeep, smoothstep(6.0, 900.0, distance));
  night = mix(night, vec3(0.35, 0.45, 0.65), foam * 0.5);
  gl_FragColor = vec4(mix(tint, night, uNight), 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The sea: pastel blues by distance from the coast, with surf at the shore. */
export function createWater(
  sea: SeaGrid,
  map: Texture,
  shared: SharedUniforms
): Mesh {
  map.flipY = false;
  map.needsUpdate = true;
  const material = new ShaderMaterial({
    fog: true,
    fragmentShader,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        deep: { value: color(0x5f_b0_e3) },
        middle: { value: color(0x7f_cd_ea) },
        nightDeep: { value: color(0x07_0f_26) },
        nightShallow: { value: color(0x13_24_4a) },
        seaCells: { value: [sea.width, sea.height] },
        seaGrid: { value: [sea.x, sea.z, sea.step] },
        seaMax: { value: sea.max },
        shallow: { value: color(0xa6_e6_ef) },
      },
    ]),
    vertexShader,
  });
  // Merging copies values, textures included; these stay shared instead.
  material.uniforms.seaMap = { value: map };
  material.uniforms.uNight = shared.uNight;
  material.uniforms.uTime = shared.uTime;
  const geometry = new PlaneGeometry(SIZE, SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  mesh.renderOrder = -1;
  return mesh;
}
