import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";

import type { Grid } from "../format.ts";
import type { Voice } from "../voice.ts";
import { GROUND, GROUNDS, Land } from "./land.ts";
import type { Bed, Mix } from "./mixer.ts";
import { BEDS, Mixer } from "./mixer.ts";

/** Seconds between mixes: levels glide between them anyway. */
const EVERY = 0.1;

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(from: number, to: number, value: number): number {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
}

/** Louder close by, 1/2 at `reach`, fading as the inverse square past it. */
function falloff(distance: number, reach: number): number {
  return 1 / (1 + (distance / reach) ** 2);
}

/** What the soundscape listens to. */
export interface Sources {
  /** The land cover raster, and its absolute URL. */
  cover: Grid & { href: string };
  height: (x: number, z: number) => number;
  /** Cars drawn around a point; see `TileManager.carsNear`. */
  cars: (x: number, z: number, radius: number) => number;
  planes: readonly Voice[];
  ferries: readonly Voice[];
  cabins: readonly Voice[];
}

export interface Ear {
  camera: PerspectiveCamera;
  /** The ground the camera looks at, and how far away it is. */
  target: Vector3;
  distance: number;
  /** 0 day to 1 night. */
  night: number;
}

/**
 * What the map sounds like where it's looked at: the sea, the surf, wind on
 * the heights, birds or crickets, a town; and things nearby, from their
 * side: planes, ferries, cable cars and traffic.
 */
export class Soundscape {
  private readonly sources: Sources;
  private readonly mixer = new Mixer();
  private land?: Land;
  private landing?: Promise<Land>;
  private last = Number.NEGATIVE_INFINITY;
  private readonly shares = new Float32Array(GROUNDS);
  private readonly right = new Vector3();
  private readonly offset = new Vector3();
  /** Each ferry's departures last heard, so a new one sounds its horn. */
  private readonly horns: number[] = [];

  /** Make it from a click or key press: browsers only let sound start from one. */
  constructor(sources: Sources) {
    this.sources = sources;
  }

  /** Fades in, loading the recordings and the land the first time. */
  async start(): Promise<void> {
    const started = this.mixer.start();
    // Departures while it was off have passed: no horns for them.
    this.horns.length = 0;
    try {
      await Promise.all([started, this.mixer.load(), this.loadLand()]);
    } catch (error) {
      // Quiet again; the next start tries again.
      this.mixer.stop();
      throw error;
    }
  }

  private async loadLand() {
    const { cover } = this.sources;
    this.landing ??= Land.load(cover.href, cover);
    try {
      this.land = await this.landing;
    } catch (error) {
      this.landing = undefined;
      throw error;
    }
  }

  stop(): void {
    this.mixer.stop();
  }

  update(ear: Ear): void {
    const now = this.mixer.context.currentTime;
    if (!this.mixer.playing || now - this.last < EVERY) {
      return;
    }
    this.last = now;
    this.right.setFromMatrixColumn(ear.camera.matrixWorld, 0);
    this.right.y = 0;
    this.right.normalize();
    this.mixBeds(ear);
    this.mixVoices(ear);
  }

  private mixBeds(ear: Ear) {
    const { land, mixer, shares } = this;
    if (!land) {
      return;
    }
    const { distance, night, target } = ear;
    const day = 1 - night;
    const radius = Math.min(9000, Math.max(150, distance * 0.6));
    land.around(target.x, target.z, radius, shares);
    const share = (ground: number) => shares[ground] ?? 0;
    // The ground fades as the camera rises: whole up to 2.5 km, gone by 40.
    const near = 1 - smoothstep(2500, 40_000, distance);
    // Small things only carry so far.
    const close = 1 - smoothstep(400, 4000, distance);
    const coast = falloff(
      land.coast(target.x, target.z),
      Math.max(120, radius * 0.35)
    );
    const heights = smoothstep(
      400,
      1600,
      this.sources.height(target.x, target.z)
    );
    const rock = share(GROUND.rock);
    const town = share(GROUND.town);
    const green = share(GROUND.forest) + share(GROUND.fields);
    // Fewer birds up on the bare heights, where the wind takes over.
    const life = near * (1 - 0.6 * heights);

    const beds: Record<Bed, Mix> = {
      fields: { level: share(GROUND.fields) * life * day },
      forest: { level: share(GROUND.forest) * life * day },
      harbor: {
        level: coast * clamp(town * 3) * close * (1 - 0.6 * night),
      },
      night: { level: clamp(green + 0.3 * town) * life * night },
      nighttown: { level: town * near * night },
      sea: {
        level: share(GROUND.sea) * (0.35 + 0.65 * near) * (1 - 0.5 * coast),
        // From high up the sea is a distant hush.
        tone: 0.55 + 0.45 * near,
      },
      stream: { level: clamp(share(GROUND.water) * 4) * close },
      surf: { level: coast * near },
      town: { level: town * near * day },
      wind: {
        level: clamp(0.08 + 0.7 * rock + 0.6 * heights + 0.5 * (1 - near)),
        // Up close on a peak it whistles; from high up it's a low rush.
        tone: 0.35 + 0.65 * near * clamp(0.3 + rock + heights),
      },
    };
    for (const name of BEDS) {
      mixer.set(name, beds[name]);
    }
  }

  private mixVoices(ear: Ear) {
    const { mixer, sources } = this;
    const { distance, night, target } = ear;
    // Things on the map quiet down from high up, where they're specks;
    // small ones are only heard up close.
    const shown = 1 - smoothstep(8000, 30_000, distance);
    const close = 1 - smoothstep(600, 3500, distance);
    const pick = (voices: readonly Voice[], reach: number) => {
      let best: Voice | undefined;
      let loudest = 0;
      for (const voice of voices) {
        const level =
          voice.level * falloff(voice.position.distanceTo(target), reach);
        if (level > loudest) {
          loudest = level;
          best = voice;
        }
      }
      return { level: loudest * shown, voice: best };
    };
    const voice = (
      name: "gondola" | "jet" | "ship",
      voices: readonly Voice[],
      reach: number,
      scale = 1
    ) => {
      const { level, voice: heard } = pick(voices, reach);
      mixer.set(name, {
        level: level * scale,
        pan: heard ? this.panOf(heard.position, ear) : 0,
        tone: clamp(0.45 + level * 0.8),
      });
    };
    voice("jet", sources.planes, distance * 0.4 + 800);
    voice("ship", sources.ferries, distance * 0.3 + 300);
    voice("gondola", sources.cabins, distance * 0.12 + 60, close);

    // `cars` weighs each from 1 in the middle to 0 at the edge, which comes
    // to half of those in the circle.
    const radius = Math.max(60, distance * 0.35);
    const density =
      (2 * sources.cars(target.x, target.z, radius)) /
      (Math.PI * radius * radius);
    // A busy street has a car in every 2,500 m² around it, or about.
    mixer.set("traffic", {
      level: clamp(density * 2500) * close * (1 - 0.5 * night),
    });

    for (const [index, ferry] of sources.ferries.entries()) {
      const heard = this.horns[index];
      this.horns[index] = ferry.cue;
      if (heard === undefined || heard === ferry.cue) {
        continue;
      }
      const level =
        falloff(ferry.position.distanceTo(target), distance * 0.5 + 1500) *
        shown;
      if (level > 0.03) {
        mixer.play("horn", level, this.panOf(ferry.position, ear));
      }
    }
  }

  /** -1 to 1: how far left or right of the middle of the view. */
  private panOf(position: Vector3, ear: Ear): number {
    this.offset.subVectors(position, ear.target);
    const side = this.offset.dot(this.right) / (ear.distance * 0.5 + 200);
    return Math.max(-1, Math.min(1, side)) * 0.8;
  }

  /** Levels last asked for, by sound: for tests and tuning. */
  levels(): Partial<Record<string, number>> {
    return this.mixer.levels();
  }

  dispose(): void {
    this.mixer.dispose();
  }
}
