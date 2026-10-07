import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";

import type { LngLat } from "./format.ts";
import type { Frame } from "./geo.ts";
import { toLocal } from "./geo.ts";

export interface MarkerOptions {
  /** Meters above the ground. */
  lift?: number;
  /** Labels collide and the lower priority hides; markers without one always show. */
  priority?: number;
  /** Hidden when the camera is farther than this, in meters. */
  maxDistance?: number;
}

export interface Marker {
  readonly element: HTMLElement;
  setPosition: (position: LngLat) => void;
  /** Meters above the ground, for things that turn out taller or shorter. */
  setLift: (lift: number) => void;
  remove: () => void;
}

interface Entry {
  wrapper: HTMLDivElement;
  element: HTMLElement;
  world: Vector3;
  options: MarkerOptions;
  shown: boolean;
  size?: { width: number; height: number };
}

const MARGIN = 80;

function show(entry: Entry, shown: boolean) {
  if (entry.shown === shown) {
    return;
  }
  entry.shown = shown;
  entry.wrapper.style.visibility = shown ? "visible" : "hidden";
}

/** DOM elements pinned to places on the map, moved every frame. */
export class Overlay {
  readonly element: HTMLDivElement;
  private readonly entries = new Set<Entry>();
  private readonly frame: Frame;
  private readonly ground: (x: number, z: number) => number;
  private readonly projected = new Vector3();

  constructor(frame: Frame, ground: (x: number, z: number) => number) {
    this.frame = frame;
    this.ground = ground;
    this.element = document.createElement("div");
    this.element.className = "fhm-overlay";
    Object.assign(this.element.style, {
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      position: "absolute",
    });
  }

  private place(entry: Entry, position: LngLat) {
    const { x, z } = toLocal(this.frame, position);
    entry.world.set(
      x,
      Math.max(0, this.ground(x, z)) + (entry.options.lift ?? 0),
      z
    );
  }

  add(
    element: HTMLElement,
    position: LngLat,
    options: MarkerOptions = {}
  ): Marker {
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      left: "0",
      position: "absolute",
      top: "0",
      visibility: "hidden",
      willChange: "transform",
    });
    wrapper.append(element);
    this.element.append(wrapper);
    const entry: Entry = {
      element,
      options,
      shown: false,
      world: new Vector3(),
      wrapper,
    };
    this.place(entry, position);
    this.entries.add(entry);
    return {
      element,
      remove: () => {
        wrapper.remove();
        this.entries.delete(entry);
      },
      setLift: (lift) => {
        entry.world.y += lift - (entry.options.lift ?? 0);
        entry.options = { ...entry.options, lift };
      },
      setPosition: (next) => this.place(entry, next),
    };
  }

  update(camera: PerspectiveCamera, width: number, height: number): void {
    const placed: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }[] = [];
    const visible: { entry: Entry; x: number; y: number }[] = [];
    for (const entry of this.entries) {
      const far =
        entry.options.maxDistance !== undefined &&
        camera.position.distanceTo(entry.world) > entry.options.maxDistance;
      this.projected.copy(entry.world).project(camera);
      const x = ((this.projected.x + 1) / 2) * width;
      const y = ((1 - this.projected.y) / 2) * height;
      const onScreen =
        this.projected.z < 1 &&
        x > -MARGIN &&
        y > -MARGIN &&
        x < width + MARGIN &&
        y < height + MARGIN;
      if (far || !onScreen) {
        show(entry, false);
        continue;
      }
      visible.push({ entry, x, y });
    }
    // Labels with higher priority claim their space first.
    visible.sort(
      (a, b) =>
        (b.entry.options.priority ?? Number.POSITIVE_INFINITY) -
        (a.entry.options.priority ?? Number.POSITIVE_INFINITY)
    );
    for (const { entry, x, y } of visible) {
      entry.wrapper.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      if (entry.options.priority === undefined) {
        show(entry, true);
        continue;
      }
      entry.size ??= {
        height: entry.element.offsetHeight,
        width: entry.element.offsetWidth,
      };
      const rect = {
        bottom: y + 4,
        left: x - entry.size.width / 2 - 4,
        right: x + entry.size.width / 2 + 4,
        top: y - entry.size.height - 4,
      };
      const clash = placed.some(
        (other) =>
          rect.left < other.right &&
          rect.right > other.left &&
          rect.top < other.bottom &&
          rect.bottom > other.top
      );
      show(entry, !clash);
      if (!clash) {
        placed.push(rect);
      }
    }
  }

  dispose(): void {
    this.entries.clear();
    this.element.remove();
  }
}
