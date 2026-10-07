import type { PerspectiveCamera } from "three";
import { Plane, Ray, Vector2, Vector3 } from "three";

/** Where the camera looks and from how far; angles in radians. */
export interface View {
  x: number;
  z: number;
  distance: number;
  /** Above the horizon. */
  pitch: number;
  /** Clockwise from north. */
  heading: number;
}

export interface Limits {
  minDistance: number;
  maxDistance: number;
  maxPitch: number;
  /** Local-frame rectangle the target stays in. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Flight {
  from: View;
  to: View;
  start: number;
  duration: number;
}

const CLICK_SLOP = 5;
const CLICK_TIME = 500;

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Low angles only close up; from far away the camera looks down more. */
function minPitch(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - 4000) / 36_000));
  return 0.2 + t * 0.55;
}

function shortest(from: number, to: number): number {
  const turn = Math.PI * 2;
  let delta = (to - from) % turn;
  if (delta > Math.PI) {
    delta -= turn;
  } else if (delta < -Math.PI) {
    delta += turn;
  }
  return from + delta;
}

/**
 * Map-style camera: drag to pan, right-drag or two fingers to turn and tilt,
 * scroll or pinch to zoom toward the pointer, arrows and +/- from the keyboard.
 */
export class MapControls {
  readonly view: View;
  /** Ground height under the target, eased so the camera doesn't jolt. */
  private groundY = 0;
  private readonly element: HTMLElement;
  private readonly camera: PerspectiveCamera;
  private readonly ground: (x: number, z: number) => number;
  private readonly limits: Limits;
  private readonly pointers = new Map<number, Vector2>();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly ray = new Ray();
  private mode: "pan" | "turn" | undefined;
  private grabbed: Vector3 | undefined;
  private velocity = { x: 0, z: 0 };
  private lastMove = 0;
  private press: { x: number; y: number; time: number } | undefined;
  private pinch:
    | { distance: number; angle: number; middle: Vector2 }
    | undefined;
  private flight: Flight | undefined;
  private changed = true;
  private readonly abort = new AbortController();
  onClick?: (clientX: number, clientY: number) => void;
  /** User input started moving the camera. */
  onInteract?: () => void;

  constructor(
    element: HTMLElement,
    camera: PerspectiveCamera,
    ground: (x: number, z: number) => number,
    limits: Limits,
    view: View
  ) {
    this.element = element;
    this.camera = camera;
    this.ground = ground;
    this.limits = limits;
    this.view = { ...view };
    this.groundY = Math.max(0, ground(view.x, view.z));
    const options = { signal: this.abort.signal };
    element.addEventListener(
      "pointerdown",
      (event) => this.down(event),
      options
    );
    element.addEventListener(
      "pointermove",
      (event) => this.move(event),
      options
    );
    element.addEventListener("pointerup", (event) => this.up(event), options);
    element.addEventListener(
      "pointercancel",
      (event) => this.up(event),
      options
    );
    element.addEventListener("wheel", (event) => this.wheel(event), {
      passive: false,
      signal: this.abort.signal,
    });
    element.addEventListener("keydown", (event) => this.key(event), options);
    element.addEventListener(
      "dblclick",
      (event) => this.doubleClick(event),
      options
    );
    element.addEventListener(
      "contextmenu",
      (event) => event.preventDefault(),
      options
    );
  }

  /** The point on the ground's level under a screen position. */
  private groundPoint(clientX: number, clientY: number): Vector3 | undefined {
    const rect = this.element.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.ray.origin.setFromMatrixPosition(this.camera.matrixWorld);
    this.ray.direction
      .set(ndc.x, ndc.y, 0.5)
      .unproject(this.camera)
      .sub(this.ray.origin)
      .normalize();
    // Near the horizon a small move would throw the map miles away.
    if (this.ray.direction.y > -0.035) {
      return undefined;
    }
    this.plane.constant = -this.groundY;
    return this.ray.intersectPlane(this.plane, new Vector3()) ?? undefined;
  }

  private interrupt() {
    this.flight = undefined;
    this.onInteract?.();
  }

  private down(event: PointerEvent) {
    this.element.setPointerCapture(event.pointerId);
    this.pointers.set(
      event.pointerId,
      new Vector2(event.clientX, event.clientY)
    );
    this.interrupt();
    this.velocity = { x: 0, z: 0 };
    if (this.pointers.size === 1) {
      this.press = {
        time: performance.now(),
        x: event.clientX,
        y: event.clientY,
      };
      const turn =
        event.button === 2 || event.ctrlKey || event.metaKey || event.shiftKey;
      this.mode = turn ? "turn" : "pan";
      this.grabbed = turn
        ? undefined
        : this.groundPoint(event.clientX, event.clientY);
    } else {
      this.press = undefined;
      this.mode = undefined;
      this.pinch = this.pinchState();
    }
  }

  private pinchState() {
    const [a, b] = [...this.pointers.values()];
    if (!(a && b)) {
      return;
    }
    return {
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      distance: a.distanceTo(b),
      middle: a.clone().add(b).multiplyScalar(0.5),
    };
  }

  private move(event: PointerEvent) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      return;
    }
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.set(event.clientX, event.clientY);
    if (this.pointers.size >= 2) {
      this.movePinch();
      return;
    }
    if (this.mode === "turn") {
      this.view.heading += dx * 0.006;
      this.view.pitch += dy * 0.005;
      this.clamp();
    } else if (this.mode === "pan" && this.grabbed) {
      const now = this.groundPoint(event.clientX, event.clientY);
      if (now) {
        const shiftX = this.grabbed.x - now.x;
        const shiftZ = this.grabbed.z - now.z;
        this.view.x += shiftX;
        this.view.z += shiftZ;
        const time = performance.now();
        const elapsed = Math.max(1, time - this.lastMove);
        this.velocity = {
          x: (shiftX / elapsed) * 1000,
          z: (shiftZ / elapsed) * 1000,
        };
        this.lastMove = time;
        this.clamp();
      }
    }
    this.changed = true;
  }

  private movePinch() {
    const now = this.pinchState();
    const before = this.pinch;
    if (!(now && before)) {
      return;
    }
    const scale = before.distance / Math.max(1, now.distance);
    const anchor = this.groundPoint(now.middle.x, now.middle.y);
    this.zoomAround(anchor, scale);
    this.view.heading -= now.angle - before.angle;
    this.view.pitch += (now.middle.y - before.middle.y) * 0.004;
    this.pinch = now;
    this.clamp();
    this.changed = true;
  }

  private up(event: PointerEvent) {
    this.pointers.delete(event.pointerId);
    const { press } = this;
    if (
      press &&
      this.pointers.size === 0 &&
      event.button === 0 &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) <
        CLICK_SLOP &&
      performance.now() - press.time < CLICK_TIME
    ) {
      this.velocity = { x: 0, z: 0 };
      this.onClick?.(event.clientX, event.clientY);
    }
    // A pause before letting go means no fling.
    if (performance.now() - this.lastMove > 80) {
      this.velocity = { x: 0, z: 0 };
    }
    this.press = undefined;
    this.pinch = this.pointers.size >= 2 ? this.pinchState() : undefined;
    if (this.pointers.size === 0) {
      this.mode = undefined;
      this.grabbed = undefined;
    }
  }

  private zoomAround(anchor: Vector3 | undefined, scale: number) {
    const before = this.view.distance;
    const after = Math.min(
      this.limits.maxDistance,
      Math.max(this.limits.minDistance, before * scale)
    );
    if (anchor) {
      const f = after / before;
      this.view.x = anchor.x + (this.view.x - anchor.x) * f;
      this.view.z = anchor.z + (this.view.z - anchor.z) * f;
    }
    this.view.distance = after;
  }

  private wheel(event: WheelEvent) {
    event.preventDefault();
    this.interrupt();
    const lines = event.deltaMode === 1 ? 32 : 1;
    const delta = event.deltaY * (event.deltaMode === 2 ? 400 : lines);
    this.zoomAround(
      this.groundPoint(event.clientX, event.clientY),
      Math.exp(delta * 0.0015)
    );
    this.clamp();
    this.changed = true;
  }

  private doubleClick(event: MouseEvent) {
    const anchor = this.groundPoint(event.clientX, event.clientY);
    const target = { ...this.view };
    const f = 0.45;
    if (anchor) {
      target.x = anchor.x + (this.view.x - anchor.x) * f;
      target.z = anchor.z + (this.view.z - anchor.z) * f;
    }
    target.distance = this.view.distance * f;
    this.flyTo(target, 450);
  }

  private key(event: KeyboardEvent) {
    const step = this.view.distance * 0.15;
    const sin = Math.sin(this.view.heading);
    const cos = Math.cos(this.view.heading);
    const pan = (forward: number, right: number) => {
      this.view.x += sin * forward * step + cos * right * step;
      this.view.z += -cos * forward * step + sin * right * step;
    };
    const handled = new Map<string, () => void>([
      [
        "ArrowUp",
        () => (event.shiftKey ? (this.view.pitch += 0.08) : pan(1, 0)),
      ],
      [
        "ArrowDown",
        () => (event.shiftKey ? (this.view.pitch -= 0.08) : pan(-1, 0)),
      ],
      [
        "ArrowLeft",
        () => (event.shiftKey ? (this.view.heading -= 0.12) : pan(0, -1)),
      ],
      [
        "ArrowRight",
        () => (event.shiftKey ? (this.view.heading += 0.12) : pan(0, 1)),
      ],
      ["+", () => this.zoomAround(undefined, 0.7)],
      ["=", () => this.zoomAround(undefined, 0.7)],
      ["-", () => this.zoomAround(undefined, 1 / 0.7)],
    ]).get(event.key);
    if (!handled) {
      return;
    }
    event.preventDefault();
    this.interrupt();
    handled();
    this.clamp();
    this.changed = true;
  }

  private clamp() {
    const { limits, view } = this;
    view.distance = Math.min(
      limits.maxDistance,
      Math.max(limits.minDistance, view.distance)
    );
    view.pitch = Math.min(
      limits.maxPitch,
      Math.max(minPitch(view.distance), view.pitch)
    );
    view.x = Math.min(limits.maxX, Math.max(limits.minX, view.x));
    view.z = Math.min(limits.maxZ, Math.max(limits.minZ, view.z));
  }

  flyTo(target: Partial<View>, duration = 900): void {
    const to = { ...this.view, ...target };
    to.heading = shortest(this.view.heading, to.heading);
    this.flight =
      duration <= 0
        ? undefined
        : { duration, from: { ...this.view }, start: performance.now(), to };
    if (duration <= 0) {
      Object.assign(this.view, to);
      this.clamp();
    }
    this.changed = true;
  }

  /** Advances fling and flights and places the camera; true when it moved. */
  update(delta: number): boolean {
    let moved = this.changed;
    this.changed = false;
    const { flight } = this;
    if (flight) {
      const t = Math.min(
        1,
        (performance.now() - flight.start) / flight.duration
      );
      const k = ease(t);
      const { from, to } = flight;
      this.view.x = from.x + (to.x - from.x) * k;
      this.view.z = from.z + (to.z - from.z) * k;
      this.view.distance = Math.exp(
        Math.log(from.distance) +
          (Math.log(to.distance) - Math.log(from.distance)) * k
      );
      this.view.pitch = from.pitch + (to.pitch - from.pitch) * k;
      this.view.heading = from.heading + (to.heading - from.heading) * k;
      if (t >= 1) {
        this.flight = undefined;
      }
      this.clamp();
      moved = true;
    } else if (
      this.pointers.size === 0 &&
      Math.hypot(this.velocity.x, this.velocity.z) > 0.5
    ) {
      this.view.x += this.velocity.x * delta;
      this.view.z += this.velocity.z * delta;
      const decay = Math.exp(-delta * 4.5);
      this.velocity.x *= decay;
      this.velocity.z *= decay;
      this.clamp();
      moved = true;
    }
    const target = Math.max(0, this.ground(this.view.x, this.view.z));
    if (Math.abs(target - this.groundY) > 0.05) {
      this.groundY += (target - this.groundY) * Math.min(1, delta * 5);
      moved = true;
    }
    if (moved) {
      this.place();
    }
    return moved;
  }

  private place() {
    const { view, camera } = this;
    const horizontal = view.distance * Math.cos(view.pitch);
    let x = view.x - Math.sin(view.heading) * horizontal;
    let z = view.z + Math.cos(view.heading) * horizontal;
    let y = this.groundY + view.distance * Math.sin(view.pitch);
    // Never below the hills between the camera and its target.
    const floor = Math.max(0, this.ground(x, z)) + 30;
    if (y < floor) {
      y = floor;
    }
    x = Number.isFinite(x) ? x : view.x;
    z = Number.isFinite(z) ? z : view.z;
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(view.x, this.groundY, view.z);
    camera.near = Math.max(0.5, view.distance * 0.01);
    camera.far = Math.max(30_000, view.distance * 25);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  /** The ground's height under the target, as the camera last used it. */
  get targetHeight(): number {
    return this.groundY;
  }

  dispose(): void {
    this.abort.abort();
  }
}
