import type { Texture } from "three";
import { Color, SRGBColorSpace } from "three";

import type { SeaGrid } from "./format.ts";

function color(hex: number): Color {
  return new Color().setHex(hex, SRGBColorSpace);
}

/**
 * What the sea's color reads, shared by the water and by the terrain, which
 * paints the same sea over itself up to the coast.
 */
export interface SeaUniforms {
  seaMap: { value: Texture };
  seaGrid: { value: [number, number, number] };
  seaCells: { value: [number, number] };
  seaMax: { value: number };
  seaShallow: { value: Color };
  seaMiddle: { value: Color };
  seaDeep: { value: Color };
  seaNightShallow: { value: Color };
  seaNightDeep: { value: Color };
}

export function createSeaUniforms(sea: SeaGrid, map: Texture): SeaUniforms {
  map.flipY = false;
  map.needsUpdate = true;
  return {
    seaCells: { value: [sea.width, sea.height] },
    seaDeep: { value: color(0x5f_b0_e3) },
    seaGrid: { value: [sea.x, sea.z, sea.step] },
    seaMap: { value: map },
    seaMax: { value: sea.max },
    seaMiddle: { value: color(0x7f_cd_ea) },
    seaNightDeep: { value: color(0x07_0f_26) },
    seaNightShallow: { value: color(0x13_24_4a) },
    seaShallow: { value: color(0xa6_e6_ef) },
  };
}

/**
 * `seaColor(xz)`: pastel blues by distance from the coast, with surf at the
 * shore, in linear color. Needs `uTime` and `uNight` declared before it.
 */
export const SEA_COLOR = `
uniform sampler2D seaMap;
uniform vec3 seaGrid;
uniform vec2 seaCells;
uniform float seaMax;
uniform vec3 seaShallow;
uniform vec3 seaMiddle;
uniform vec3 seaDeep;
uniform vec3 seaNightShallow;
uniform vec3 seaNightDeep;

float seaRipple(vec2 p) {
  return sin(p.x * 0.031 + uTime * 0.6) * sin(p.y * 0.027 - uTime * 0.45);
}

vec3 seaColor(vec2 xz) {
  vec2 uv = ((xz - seaGrid.xy) / seaGrid.z + 0.5) / seaCells;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float encoded = texture2D(seaMap, uv).r;
  float distance = mix(seaMax, encoded * encoded * seaMax, inside);
  vec3 tint = mix(seaShallow, seaMiddle, smoothstep(6.0, 260.0, distance));
  tint = mix(tint, seaDeep, smoothstep(260.0, 1800.0, distance));
  tint *= 1.0 + seaRipple(xz) * 0.025;

  // Surf: a bright edge along the shore, and lines rolling in. The lines are
  // drawn as wide as a pixel needs and fade out once they'd be thinner.
  float phase = distance * 0.2 - uTime * 1.4 + seaRipple(xz * 2.0) * 2.0;
  float blur = fwidth(phase);
  float crest = smoothstep(0.8 - blur, 0.97 + blur * 0.5, sin(phase));
  float lines = crest * smoothstep(60.0, 14.0, distance) * (1.0 - smoothstep(0.6, 1.6, blur));
  float edge = smoothstep(12.0 + fwidth(distance), 1.5, distance);
  float foam = clamp(edge * 0.9 + lines * 0.5, 0.0, 1.0);
  tint = mix(tint, vec3(1.0), foam);

  vec3 night = mix(seaNightShallow, seaNightDeep, smoothstep(6.0, 900.0, distance));
  night = mix(night, vec3(0.35, 0.45, 0.65), foam * 0.5);
  return mix(tint, night, uNight);
}
`;
