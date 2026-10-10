import { Stream } from "./stream.ts";

export interface ChannelOptions {
  /** Two streams, one a side, so a mono recording sounds wide. */
  wide: boolean;
  /** Seconds a level takes to settle, about. */
  settle: number;
  /** How loud it plays at level 1. */
  trim: number;
}

/** A recording's way to the speakers: its level, side and tone. */
export class Channel {
  private readonly context: AudioContext;
  private readonly gain: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly tone: BiquadFilterNode;
  private readonly streams: Stream[];
  private readonly options: ChannelOptions;
  /** The level asked for, and about where the fade to it has got. */
  private goal = 0;
  private heard = 0;
  private time: number;

  constructor(
    context: AudioContext,
    buffer: AudioBuffer,
    output: AudioNode,
    options: ChannelOptions
  ) {
    this.context = context;
    this.options = options;
    this.tone = new BiquadFilterNode(context, {
      frequency: context.sampleRate / 2,
      type: "lowpass",
    });
    this.pan = new StereoPannerNode(context);
    this.gain = new GainNode(context, { gain: 0 });
    this.tone.connect(this.pan).connect(this.gain).connect(output);
    this.streams = options.wide
      ? [-0.6, 0.6].map((side) => {
          const panner = new StereoPannerNode(context, { pan: side });
          panner.connect(this.tone);
          return new Stream(context, buffer, panner);
        })
      : [new Stream(context, buffer, this.tone)];
    this.time = context.currentTime;
  }

  /** `pan` -1 left to 1 right; `tone` 0 muffled, as from afar, to 1 clear. */
  set(level: number, pan: number, tone: number): void {
    const { settle, trim } = this.options;
    const now = this.context.currentTime;
    this.heard +=
      (this.goal - this.heard) * (1 - Math.exp(-(now - this.time) / settle));
    this.time = now;
    this.goal = level;
    this.gain.gain.setTargetAtTime(level * trim, now, settle);
    this.pan.pan.setTargetAtTime(pan, now, 0.15);
    const top = this.context.sampleRate / 2;
    this.tone.frequency.setTargetAtTime(300 * (top / 300) ** tone, now, settle);
    // Silent ones stop playing; their last stretch fades out on its own.
    const on = this.goal > 0.002 || this.heard > 0.004;
    for (const stream of this.streams) {
      stream.pump(on);
    }
  }

  /** What `set` last asked for. */
  get level(): number {
    return this.goal;
  }
}
