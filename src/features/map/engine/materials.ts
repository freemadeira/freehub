import type { Texture, WebGLProgramParametersWithUniforms } from "three";
import {
  Color,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SRGBColorSpace,
} from "three";

import { PALETTE } from "./palette.ts";

/** Uniforms every map material reads, so one change reaches them all. */
export interface SharedUniforms {
  /** 0 by day, 1 at night. */
  uNight: { value: number };
  uTime: { value: number };
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

function graded(
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
  terrain: (map: Texture) => MeshLambertMaterial;
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

export function createMaterials(): Materials {
  const shared: SharedUniforms = { uNight: { value: 0 }, uTime: { value: 0 } };

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

  const terrainPrograms: MeshLambertMaterial[] = [];
  const terrain = (map: Texture) => {
    const material = new MeshLambertMaterial({ map });
    material.onBeforeCompile = (shader) => {
      graded(shader, shared, {
        after: ROCK,
        before: "varying float vSlope;\nvarying float vRockBand;",
      });
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vSlope;\nvarying float vRockBand;"
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvSlope = 1.0 - normalize(objectNormal).y;\nvRockBand = position.y * 0.35;"
        );
    };
    material.customProgramCacheKey = () => "map-terrain";
    terrainPrograms.push(material);
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
    },
    label,
    landmark,
    pole,
    roads,
    shared,
    solid,
    terrain,
    trunk,
  };
}
