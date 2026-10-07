/* oxlint-disable no-bitwise -- hashing works on 32-bit integers */

function mix(h: number, word: number): number {
  let value = Math.imul(h ^ word, 0x01_00_01_93);
  value ^= value >>> 15;
  value = Math.imul(value, 0x2c_1b_3c_6d);
  return value ^ (value >>> 12);
}

/**
 * A number in [0, 1) that depends only on its inputs. Fractions count too:
 * each input is hashed at 1/65536 resolution, in two 32-bit halves.
 */
export function hash(...values: number[]): number {
  let h = 0x81_1c_9d_c5;
  for (const value of values) {
    const scaled = Math.round(value * 65_536);
    h = mix(h, scaled >>> 0);
    h = mix(h, Math.floor(scaled / 4_294_967_296) >>> 0);
  }
  return (h >>> 0) / 4_294_967_296;
}

/** Mulberry32: a small, fast generator for stable scatter patterns. */
export function generator(seed: number): () => number {
  let state = Math.floor(seed * 4_294_967_296) >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function pick<T>(list: readonly T[], value: number): T {
  return list[Math.min(list.length - 1, Math.floor(value * list.length))] as T;
}
