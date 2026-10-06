/**
 * Swings a dragged card with the pointer: sideways speed tilts it, and it
 * rights itself when the pointer rests or the card drops. It only touches the
 * standalone `rotate` property, which dnd-kit leaves alone when it positions
 * the card with `translate` and measures it through `transform` and `scale`.
 */

/** Degrees at full speed. */
const MAX_TILT = 6;
/** Degrees per pixel per millisecond of sideways speed. */
const TILT_PER_SPEED = 4;
const SPEED_SMOOTHING = 0.3;
/** Pointer events stop while the pointer rests, so speed fades each frame. */
const SPEED_DECAY = 0.9;
const TILT_SMOOTHING = 0.15;
const SETTLE: KeyframeAnimationOptions = {
  duration: 200,
  easing: "cubic-bezier(0.23, 1, 0.32, 1)",
};

interface Point {
  x: number;
  y: number;
}

export interface DragTilt {
  /** Starts swinging the card from where the pointer grabbed it. */
  start: (element: Element | null | undefined, point: Point) => void;
  /** Follows the pointer; the element can change as the card moves lists. */
  move: (element: Element | null | undefined, point: Point) => void;
  /** Lets the card settle upright. */
  stop: () => void;
}

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

export function createDragTilt(): DragTilt {
  let element: HTMLElement | undefined;
  let origin = "";
  let frame = 0;
  let speed = 0;
  let tilt = 0;
  let last: { x: number; time: number } | undefined;

  const step = () => {
    speed *= SPEED_DECAY;
    tilt += (clamp(speed * TILT_PER_SPEED, MAX_TILT) - tilt) * TILT_SMOOTHING;
    if (element) {
      element.style.rotate = `${tilt}deg`;
    }
    frame = requestAnimationFrame(step);
  };

  // A card moved to another list is a new element; carry the tilt over.
  const follow = (next: HTMLElement) => {
    if (next === element) {
      return;
    }
    element?.style.removeProperty("rotate");
    element?.style.removeProperty("transform-origin");
    element = next;
    element.style.transformOrigin = origin;
    element.style.rotate = `${tilt}deg`;
  };

  const settle = () => {
    cancelAnimationFrame(frame);
    last = undefined;
    const target = element;
    element = undefined;
    if (!target) {
      return;
    }
    target.style.removeProperty("rotate");
    const animation = target.animate(
      [{ rotate: `${tilt}deg` }, { rotate: "0deg" }],
      SETTLE
    );
    const reset = () => target.style.removeProperty("transform-origin");
    animation.addEventListener("finish", reset);
    animation.addEventListener("cancel", reset);
  };

  return {
    move(target, point) {
      if (!last) {
        return;
      }
      if (target instanceof HTMLElement) {
        follow(target);
      }
      const now = performance.now();
      const elapsed = now - last.time;
      if (elapsed > 0) {
        speed += ((point.x - last.x) / elapsed - speed) * SPEED_SMOOTHING;
      }
      last = { time: now, x: point.x };
    },
    start(target, point) {
      settle();
      if (
        !(target instanceof HTMLElement) ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
      const rect = target.getBoundingClientRect();
      origin = `${point.x - rect.left}px ${point.y - rect.top}px`;
      speed = 0;
      tilt = 0;
      last = { time: performance.now(), x: point.x };
      follow(target);
      frame = requestAnimationFrame(step);
    },
    stop: settle,
  };
}
