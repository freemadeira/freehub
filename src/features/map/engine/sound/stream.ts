/** Seconds of sound kept scheduled ahead. */
const AHEAD = 1.5;
/** Seconds each stretch crossfades with the next. */
const FADE = 2;

function curve(rising: boolean): Float32Array {
  const steps = 32;
  return Float32Array.from({ length: steps }, (_, index) => {
    const angle = (index / (steps - 1)) * (Math.PI / 2);
    // Equal power: two stretches overlapping keep the loudness.
    return rising ? Math.sin(angle) : Math.cos(angle);
  });
}

const RISE = curve(true);
const FALL = curve(false);

/**
 * One recording played without end: overlapping stretches from random
 * places, crossfaded, so it never repeats in a way an ear would catch.
 */
export class Stream {
  private readonly context: AudioContext;
  private readonly buffer: AudioBuffer;
  private readonly output: AudioNode;
  private next = 0;
  private playing = false;

  constructor(context: AudioContext, buffer: AudioBuffer, output: AudioNode) {
    this.context = context;
    this.buffer = buffer;
    this.output = output;
  }

  /** Keeps stretches scheduled while `on`; off, the last one plays out. */
  pump(on: boolean): void {
    const now = this.context.currentTime;
    if (!on) {
      this.playing = false;
      return;
    }
    if (!this.playing || this.next < now) {
      this.next = now + 0.05;
      this.playing = true;
    }
    while (this.next < now + AHEAD) {
      this.next = this.schedule(this.next);
    }
  }

  /** Plays a stretch from `at`; returns when the next one starts. */
  private schedule(at: number): number {
    const { duration } = this.buffer;
    const longest = Math.max(2 * FADE + 0.5, duration - 0.4);
    const length = Math.min(longest, 2 * FADE + 4 + Math.random() * 8);
    const offset = 0.2 + Math.random() * Math.max(0, duration - length - 0.4);
    const source = new AudioBufferSourceNode(this.context, {
      buffer: this.buffer,
    });
    const envelope = new GainNode(this.context, { gain: 0 });
    envelope.gain.setValueCurveAtTime(RISE, at, FADE);
    envelope.gain.setValueCurveAtTime(FALL, at + length - FADE, FADE);
    source.connect(envelope).connect(this.output);
    source.addEventListener("ended", () => envelope.disconnect());
    source.start(at, offset, length);
    return at + length - FADE;
  }
}
