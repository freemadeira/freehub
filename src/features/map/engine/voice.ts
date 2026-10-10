import { Vector3 } from "three";

/**
 * Something on the map heard where it is, like a plane or a ferry. `level`
 * is how loud it is up close, 0 when silent; `cue` counts the moments that
 * call for a one-off sound, like a ferry's horn as it leaves port.
 */
export interface Voice {
  readonly position: Vector3;
  level: number;
  cue: number;
}

export function createVoices(count: number): Voice[] {
  return Array.from({ length: count }, () => ({
    cue: 0,
    level: 0,
    position: new Vector3(),
  }));
}
