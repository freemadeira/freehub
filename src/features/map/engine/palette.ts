import type { Cover, LanduseKind, RoadKind } from "./format.ts";
import { COVER } from "./format.ts";

/**
 * Pastel colors, in sRGB. Walls, roofs and trees pick from these lists by each
 * object's seed, so the same building keeps its color between visits.
 */
export const PALETTE = {
  cabin: [0xf2_6d_5b, 0xf7_c5_48, 0x5a_a9_e6],
  cover: {
    [COVER.bare]: 0xe6_d0_b4,
    [COVER.built]: 0xd7_ea_b2,
    [COVER.crop]: 0xcf_e5_9b,
    [COVER.forest]: 0x86_c9_6d,
    [COVER.grass]: 0xb4_df_82,
    [COVER.sea]: 0x9a_d8_ec,
    [COVER.shrub]: 0xa9_d4_7e,
    [COVER.water]: 0x8f_d0_ee,
    [COVER.wetland]: 0xa6_dc_c4,
  } satisfies Record<Cover, number>,
  landuse: {
    airport: 0xe8_e6_de,
    apron: 0xda_dc_e3,
    beach: 0xf7_e5_b9,
    cemetery: 0xc5_dc_b2,
    commercial: 0xe8_ec_cd,
    farmland: 0xcd_e6_9b,
    forest: 0x7f_c5_6a,
    golf: 0xb1_e3_8b,
    grass: 0xb5_df_84,
    industrial: 0xe2_e4_e8,
    institution: 0xd5_ea_b3,
    marina: 0xe9_e6_e0,
    orchard: 0xbd_e2_8a,
    park: 0x9f_da_70,
    parking: 0xdd_de_e4,
    pedestrian: 0xf5_dc_cf,
    pitch: 0x9f_d7_7b,
    playground: 0xf5_d9_a8,
    residential: 0xd1_e8_ab,
    rock: 0xe4_cb_ae,
    scrub: 0xa5_d0_7b,
    vineyard: 0xc8_dd_8f,
    wetland: 0xa6_dc_c4,
  } satisfies Record<LanduseKind, number>,
  pier: 0xe7_e4_de,
  pillar: 0xd9_db_e2,
  road: {
    footway: 0xf2_b8_a5,
    motorway: 0x9b_a3_b5,
    pedestrian: 0xf3_dc_cd,
    primary: 0xa3_aa_b9,
    residential: 0xb3_b7_c2,
    runway: 0x8f_97_a7,
    secondary: 0xa7_ad_bc,
    service: 0xbc_c0_c9,
    steps: 0xea_a8_92,
    taxiway: 0x9d_a4_b1,
    tertiary: 0xad_b2_be,
    track: 0xdc_c6_a4,
    trunk: 0x9f_a6_b7,
  } satisfies Record<RoadKind, number>,
  roadEdge: 0xfa_fa_fa,
  roadLine: 0xf7_cf_55,
  roofFlat: 0xe1_e4_ec,
  roofProp: 0xf3_f4_f8,
  roofTile: [0xee_9b_7d, 0xe9_8f_72, 0xf0_a8_88],
  sidewalk: 0xf1_dc_d2,
  tree: {
    blossom: [0xca_a9_ec, 0xf3_b7_cc],
    broad: [0xa8_d8_5d, 0x7f_c8_52, 0x5e_ae_4f, 0x93_d0_57],
    cone: [0x3f_8e_59, 0x4b_9a_5f],
    palm: [0x72_c1_58, 0x63_b5_53],
    trunk: 0xa4_7c_61,
  },
  trim: 0xff_fd_f8,
  walls: [
    0xf8_cb_c5, 0xfa_d9_b2, 0xf8_e8_a9, 0xd0_e6_f6, 0xd4_ed_da, 0xe7_db_f3,
    0xfc_f4_e8, 0xf4_cf_b4, 0xfd_fb_f6, 0xfc_f4_e8, 0xfd_fb_f6,
  ],
  water: 0x8e_d0_ee,
} as const;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** An sRGB hex color as linear floats, the space three.js lights in. */
export function linear(hex: number): [number, number, number] {
  return [
    channel(Math.floor(hex / 65_536) % 256),
    channel(Math.floor(hex / 256) % 256),
    channel(hex % 256),
  ];
}

export function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}
