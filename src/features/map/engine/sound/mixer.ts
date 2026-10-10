import { Channel } from "./channel.ts";

/** Background that fades with what's in view. */
export const BEDS = [
  "sea",
  "surf",
  "wind",
  "forest",
  "fields",
  "night",
  "town",
  "nighttown",
  "harbor",
  "stream",
] as const;
/** Sounds of things on the map, each from its side. */
export const LOOPS = ["traffic", "jet", "ship", "gondola"] as const;
/** One-off sounds. */
export const SHOTS = ["horn"] as const;

export type Bed = (typeof BEDS)[number];
export type Loop = (typeof LOOPS)[number];
export type Shot = (typeof SHOTS)[number];
type Sound = Bed | Loop | Shot;

/** The recordings, mono and equally loud; see `sounds/CREDITS.md`. */
const FILES: Record<Sound, URL> = {
  fields: new URL("sounds/fields.mp3", import.meta.url),
  forest: new URL("sounds/forest.mp3", import.meta.url),
  gondola: new URL("sounds/gondola.mp3", import.meta.url),
  harbor: new URL("sounds/harbor.mp3", import.meta.url),
  horn: new URL("sounds/horn.mp3", import.meta.url),
  jet: new URL("sounds/jet.mp3", import.meta.url),
  night: new URL("sounds/night.mp3", import.meta.url),
  nighttown: new URL("sounds/nighttown.mp3", import.meta.url),
  sea: new URL("sounds/sea.mp3", import.meta.url),
  ship: new URL("sounds/ship.mp3", import.meta.url),
  stream: new URL("sounds/stream.mp3", import.meta.url),
  surf: new URL("sounds/surf.mp3", import.meta.url),
  town: new URL("sounds/town.mp3", import.meta.url),
  traffic: new URL("sounds/traffic.mp3", import.meta.url),
  wind: new URL("sounds/wind.mp3", import.meta.url),
};

/** How loud each plays at level 1. */
const TRIM: Record<Sound, number> = {
  fields: 0.55,
  forest: 0.6,
  gondola: 0.7,
  harbor: 0.55,
  horn: 0.8,
  jet: 0.9,
  night: 0.5,
  nighttown: 0.55,
  sea: 0.7,
  ship: 0.7,
  stream: 0.5,
  surf: 0.8,
  town: 0.55,
  traffic: 0.6,
  wind: 0.55,
};

/** Seconds a level takes to settle, about: slow for beds, quick for things that move. */
const SETTLE = { bed: 1.2, loop: 0.25 };
/** Seconds the whole mix takes to come in, and to go. */
const FADE_IN = 1.5;
const FADE_OUT = 0.35;

export interface Mix {
  level: number;
  /** -1 left to 1 right. */
  pan?: number;
  /** 0 muffled to 1 clear. */
  tone?: number;
}

function isShot(name: Sound): name is Shot {
  return (SHOTS as readonly Sound[]).includes(name);
}

function isBed(name: Sound): name is Bed {
  return (BEDS as readonly Sound[]).includes(name);
}

/** The map's audio graph and its recordings. Make it from a click. */
export class Mixer {
  readonly context: AudioContext;
  private readonly master: GainNode;
  private readonly channels = new Map<Bed | Loop, Channel>();
  private readonly shots = new Map<Shot, AudioBuffer>();
  private loading?: Promise<void>;
  private on = false;
  private readonly wake = () => {
    if (document.hidden) {
      this.context.suspend();
    } else if (this.on && this.context.state !== "running") {
      // Some browsers stop sound on their own, as iOS does for a call, and
      // only let it go on from a tap.
      this.context.resume();
    }
  };

  constructor() {
    let context: AudioContext;
    try {
      // Ambience needs no more, and its decoded recordings take a third less.
      context = new AudioContext({
        latencyHint: "playback",
        sampleRate: 32_000,
      });
    } catch {
      context = new AudioContext({ latencyHint: "playback" });
    }
    this.context = context;
    const compressor = new DynamicsCompressorNode(context, {
      attack: 0.05,
      knee: 12,
      ratio: 3,
      release: 0.4,
      threshold: -18,
    });
    this.master = new GainNode(context, { gain: 0 });
    this.master.connect(compressor).connect(context.destination);
    document.addEventListener("visibilitychange", this.wake);
    window.addEventListener("pointerdown", this.wake, true);
  }

  /**
   * Fetches and decodes the recordings; each plays as soon as it's in. One
   * that fails stays quiet, and the next load tries it again; it rejects only
   * when none came in.
   */
  load(): Promise<void> {
    this.loading ??= this.loadAll();
    return this.loading;
  }

  private async loadAll() {
    const results = await Promise.allSettled(
      (Object.keys(FILES) as Sound[]).map((name) => this.loadOne(name))
    );
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length > 0) {
      this.loading = undefined;
    }
    if (failed.length === results.length) {
      throw failed[0]?.reason;
    }
  }

  private async loadOne(name: Sound) {
    if (this.channels.has(name as Bed | Loop) || this.shots.has(name as Shot)) {
      return;
    }
    const url = FILES[name];
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${url.pathname}: HTTP ${response.status}`);
    }
    const buffer = await this.context.decodeAudioData(
      await response.arrayBuffer()
    );
    if (isShot(name)) {
      this.shots.set(name, buffer);
      return;
    }
    const bed = isBed(name);
    this.channels.set(
      name,
      new Channel(this.context, buffer, this.master, {
        settle: bed ? SETTLE.bed : SETTLE.loop,
        trim: TRIM[name],
        wide: bed,
      })
    );
  }

  /** Fades the mix in; from a click, so the browser lets it play. */
  async start(): Promise<void> {
    this.on = true;
    await this.context.resume();
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(1, now, FADE_IN / 3);
  }

  /** Fades the mix out, then lets the audio device rest. */
  stop(): void {
    this.on = false;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, FADE_OUT / 3);
    setTimeout(
      () => {
        if (!this.on && this.context.state === "running") {
          this.context.suspend();
        }
      },
      FADE_OUT * 1000 + 100
    );
  }

  get playing(): boolean {
    return this.on;
  }

  set(name: Bed | Loop, mix: Mix): void {
    this.channels.get(name)?.set(mix.level, mix.pan ?? 0, mix.tone ?? 1);
  }

  /** Plays a one-off sound now, at `level`, from `pan`. */
  play(name: Shot, level: number, pan: number): void {
    const buffer = this.shots.get(name);
    if (!buffer || !this.on) {
      return;
    }
    const source = new AudioBufferSourceNode(this.context, { buffer });
    const gain = new GainNode(this.context, { gain: level * TRIM[name] });
    const side = new StereoPannerNode(this.context, { pan });
    source.connect(gain).connect(side).connect(this.master);
    source.addEventListener("ended", () => side.disconnect());
    source.start();
  }

  /** Levels last asked for, by sound. */
  levels(): Partial<Record<Bed | Loop, number>> {
    return Object.fromEntries(
      [...this.channels].map(([name, channel]) => [name, channel.level])
    );
  }

  dispose(): void {
    document.removeEventListener("visibilitychange", this.wake);
    window.removeEventListener("pointerdown", this.wake, true);
    this.on = false;
    this.context.close();
  }
}
