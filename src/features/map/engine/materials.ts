import type { Texture, WebGLProgramParametersWithUniforms } from "three";
import {
  Color,
  DataTexture,
  LinearFilter,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RedFormat,
  SRGBColorSpace,
} from "three";

import { PALETTE } from "./palette.ts";
import type { CoastMap } from "./protocol.ts";
import type { SeaUniforms } from "./sea.ts";
import { SEA_COLOR } from "./sea.ts";

/** Uniforms every map material reads, so one change reaches them all. */
export interface SharedUniforms {
  /** 0 by day, 1 at night. */
  uNight: { value: number };
  uTime: { value: number };
  /** Seconds of life on the map; it stands still for reduced motion. */
  uLife: { value: number };
}

const GRADE = `
uniform float uNight;
vec3 nightGrade(vec3 color) {
  float light = dot(color, vec3(0.299, 0.587, 0.114));
  vec3 night = vec3(0.008, 0.013, 0.036) + light * vec3(0.03, 0.046, 0.105);
  return mix(color, night, uNight);
}
`;

type Shader = WebGLProgramParametersWithUniforms;

/** Darkens a material at night; `glow` adds light that shines through. */
export function graded(
  shader: Shader,
  shared: SharedUniforms,
  options: { glow?: string; before?: string; after?: string } = {}
) {
  shader.uniforms.uNight = shared.uNight;
  shader.uniforms.uTime = shared.uTime;
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>\n${GRADE}\n${options.before ?? ""}`
    )
    .replace(
      "#include <opaque_fragment>",
      `outgoingLight = nightGrade(outgoingLight)${options.glow ? ` + uNight * (${options.glow})` : ""};\n#include <opaque_fragment>`
    );
  if (options.after) {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>\n${options.after}`
    );
  }
}

function srgb(hex: number): string {
  const color = new Color().setHex(hex, SRGBColorSpace);
  return `vec3(${color.r.toFixed(4)}, ${color.g.toFixed(4)}, ${color.b.toFixed(4)})`;
}

/**
 * The sea painted over the terrain up to the coast its coast map draws, so the
 * shore doesn't move with the mesh's detail. It matches the water exactly,
 * which takes over wherever the ground dips under it.
 */
const WET = `
float coastDistance = (texture2D(coastMap, vMapUv).r - 128.0 / 255.0) * coastScale;
float coastChange = fwidth(coastDistance);
// Only near the coast. The margin takes in every pixel next to a wet one, so
// whole 2×2 blocks agree and the sea's own derivatives hold.
if (coastDistance < coastChange * 2.5 + 0.01) {
  float coastBlur = max(coastChange * 0.7, 1e-3);
  float wet = smoothstep(coastBlur, -coastBlur, coastDistance);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, seaColor(vSeaXZ), wet);
}
`;

/** A coast map's texture, sampled smoothly between its texels. */
export function coastTexture(coast: CoastMap): DataTexture {
  const texture = new DataTexture(
    coast.data,
    coast.size,
    coast.size,
    RedFormat
  );
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Steep ground turns to bare rock, like the island's cliffs. */
const ROCK = `
float steep = smoothstep(0.42, 0.78, vSlope);
diffuseColor.rgb = mix(diffuseColor.rgb, ${srgb(0xe2_c4_a6)} * (0.92 + 0.08 * sin(vRockBand)), steep * 0.85);
`;

/**
 * Windows drawn on the walls rather than modeled: columns spread along each
 * wall, a storey apart, faded out once they'd shimmer. Some light up at night.
 */
const WINDOWS = `
vWindowLight = 0.0;
if (vFacade.z > 0.5) {
  float spacing = mix(2.7, 3.5, fract(vSeed * 13.7));
  float columns = max(1.0, floor((vFacade.z - 0.8) / spacing));
  float start = (vFacade.z - columns * spacing) * 0.5;
  float cu = (vFacade.x - start) / spacing;
  float cv = (vFacade.y - 1.1) / 3.1;
  float storeys = floor((vFacade.w - 1.9) / 3.1) + 1.0;
  float inside = step(0.0, cu) * step(cu, columns) * step(0.0, cv) * step(cv, storeys);
  vec2 cell = vec2(fract(cu), fract(cv));
  vec2 size = vec2(mix(0.36, 0.52, fract(vSeed * 7.1)), 0.44);
  vec2 blur = fwidth(vec2(cu, cv)) * 1.5;
  vec2 glassEdge = abs(cell - vec2(0.5, 0.47)) - size * 0.5;
  vec2 frameEdge = glassEdge - vec2(0.07, 0.06);
  float glass = (1.0 - smoothstep(-blur.x, blur.x, glassEdge.x)) * (1.0 - smoothstep(-blur.y, blur.y, glassEdge.y));
  float frame = (1.0 - smoothstep(-blur.x, blur.x, frameEdge.x)) * (1.0 - smoothstep(-blur.y, blur.y, frameEdge.y));
  float fade = (1.0 - smoothstep(0.22, 0.55, max(blur.x, blur.y))) * inside;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), frame * fade);
  diffuseColor.rgb = mix(diffuseColor.rgb, ${srgb(0x78_98_b8)} * (0.85 + 0.3 * fract(vSeed * 3.3)), glass * fade);
  vec2 id = floor(vec2(cu, cv));
  float on = step(0.5, fract(sin(dot(id + vSeed * 91.7, vec2(12.9898, 78.233))) * 43758.5453));
  float far = smoothstep(0.3, 0.9, max(blur.x, blur.y));
  vWindowLight = mix(glass * on, 0.07, far) * inside;
}
`;

export interface Materials {
  shared: SharedUniforms;
  sea: SeaUniforms;
  /** Ground for one tile; without a coast map, it's all land. */
  terrain: (
    map: Texture,
    coast?: { texture: Texture; scale: number }
  ) => MeshLambertMaterial;
  /** Painted street names, dimmed at night. */
  label: (map: Texture) => MeshBasicMaterial;
  buildings: MeshLambertMaterial;
  roads: MeshLambertMaterial;
  solid: MeshLambertMaterial;
  canopy: MeshLambertMaterial;
  trunk: MeshLambertMaterial;
  pole: MeshLambertMaterial;
  bulb: MeshBasicMaterial;
  landmark: MeshLambertMaterial;
  dispose: () => void;
}

export function createMaterials(sea: SeaUniforms): Materials {
  const shared: SharedUniforms = {
    uLife: { value: 0 },
    uNight: { value: 0 },
    uTime: { value: 0 },
  };
  const land = coastTexture({ data: Uint8Array.of(255), scale: 1, size: 1 });

  const buildings = new MeshLambertMaterial({ vertexColors: true });
  buildings.onBeforeCompile = (shader) => {
    graded(shader, shared, {
      after: WINDOWS,
      before:
        "varying vec4 vFacade;\nvarying float vSeed;\nfloat vWindowLight;",
      glow: "vWindowLight * vec3(1.0, 0.72, 0.38) * 1.7",
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec4 facade;\nattribute float seed;\nvarying vec4 vFacade;\nvarying float vSeed;"
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFacade = facade * 0.1;\nvSeed = seed;"
      );
  };
  buildings.customProgramCacheKey = () => "map-buildings";

  const allLand: { scale: number; texture: Texture } = {
    scale: 1,
    texture: land,
  };
  const terrain = (map: Texture, coast = allLand) => {
    const material = new MeshLambertMaterial({ map });
    material.onBeforeCompile = (shader) => {
      graded(shader, shared, {
        after: ROCK,
        before: `varying float vSlope;\nvarying float vRockBand;\nvarying vec2 vSeaXZ;\nuniform float uTime;\nuniform sampler2D coastMap;\nuniform float coastScale;\n${SEA_COLOR}`,
      });
      Object.assign(shader.uniforms, sea, {
        coastMap: { value: coast.texture },
        coastScale: { value: coast.scale },
      });
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <tonemapping_fragment>",
        `${WET}\n#include <tonemapping_fragment>`
      );
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vSlope;\nvarying float vRockBand;\nvarying vec2 vSeaXZ;"
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvSlope = 1.0 - normalize(objectNormal).y;\nvRockBand = position.y * 0.35;\nvSeaXZ = (modelMatrix * vec4(transformed, 1.0)).xz;"
        );
    };
    material.customProgramCacheKey = () => "map-terrain";
    return material;
  };

  const label = (map: Texture) => {
    const material = new MeshBasicMaterial({
      depthWrite: false,
      map,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -10,
      transparent: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = shared.uNight;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uNight;"
        )
        .replace(
          "#include <opaque_fragment>",
          "outgoingLight *= mix(1.0, 0.32, uNight);\n#include <opaque_fragment>"
        );
    };
    material.customProgramCacheKey = () => "map-label";
    return material;
  };

  const gradedLambert = (
    parameters: ConstructorParameters<typeof MeshLambertMaterial>[0],
    key: string,
    glow?: string
  ) => {
    const material = new MeshLambertMaterial(parameters);
    material.onBeforeCompile = (shader) => graded(shader, shared, { glow });
    material.customProgramCacheKey = () => key;
    return material;
  };

  const roads = gradedLambert(
    {
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      vertexColors: true,
    },
    "map-roads",
    "vec3(1.0, 0.72, 0.42) * 0.07"
  );
  const solid = gradedLambert({ vertexColors: true }, "map-solid");
  const canopy = gradedLambert({ vertexColors: true }, "map-canopy");
  const trunk = gradedLambert(
    { color: new Color(PALETTE.tree.trunk) },
    "map-trunk"
  );
  const pole = gradedLambert({ color: new Color(0x4b_54_68) }, "map-pole");
  const landmark = gradedLambert({ vertexColors: true }, "map-landmark");
  const bulb = new MeshBasicMaterial({ color: new Color(0xff_f1_d6) });

  return {
    buildings,
    bulb,
    canopy,
    dispose() {
      for (const material of [
        buildings,
        roads,
        solid,
        canopy,
        trunk,
        pole,
        landmark,
        bulb,
      ]) {
        material.dispose();
      }
      land.dispose();
    },
    label,
    landmark,
    pole,
    roads,
    sea,
    shared,
    solid,
    terrain,
    trunk,
  };
}
