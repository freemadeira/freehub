/**
 * The shape of a cable between two supports, shared with the bake, which
 * raises pylons until the cabins clear what's under them.
 */

/** How far a cable sags at the middle of a span, as a share of its length. */
const SAG = 0.035;

/** Meters a cable drops below the straight line `t` of the way along a span. */
export function sagAt(span: number, t: number): number {
  return Math.sin(t * Math.PI) * span * SAG;
}

/** Meters between a cable and the floor of a cabin hanging from it. */
export const CABIN_DROP = 5;

/** Meters either side of the middle where a gondola's two ropes run. */
export const ROPE_GAP = 3;
