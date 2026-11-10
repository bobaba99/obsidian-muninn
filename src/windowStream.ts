export interface AudioWindow {
  readonly startSec: number;
  readonly samples: Float32Array;
}

const MIN_TAIL_SEC = 1;

/**
 * Converts audio at any sample rate to `targetRate`, a chunk at a time.
 * Each output sample is the average of the input samples it spans, which also filters
 * out the high frequencies that would otherwise fold back when the rate drops.
 */
export class Resampler {
  private readonly step: number;
  private position = 0; // input samples consumed, relative to the start of `carry`
  private carry: Float32Array = new Float32Array(0);

  constructor(sourceRate: number, targetRate: number) {
    this.step = sourceRate / targetRate;
  }

  push(chunk: Float32Array): Float32Array {
    const input = new Float32Array(this.carry.length + chunk.length);
    input.set(this.carry);
    input.set(chunk, this.carry.length);
    const count = Math.max(0, Math.floor((input.length - this.position) / this.step));
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const from = this.position + i * this.step;
      const first = Math.floor(from);
      const last = Math.max(first + 1, Math.floor(from + this.step));
      let sum = 0;
      for (let j = first; j < last; j++) sum += input[j] ?? 0;
      out[i] = sum / (last - first);
    }
    const consumed = Math.floor(this.position + count * this.step);
    this.position = this.position + count * this.step - consumed;
    this.carry = input.slice(consumed);
    return out;
  }
}

/** Cuts a stream of samples into overlapping windows, holding only one window of audio in memory. */
export class WindowCutter {
  private buffer: Float32Array = new Float32Array(0);
  private emitted = 0;
  private readonly windowSamples: number;
  private readonly stepSamples: number;

  constructor(private readonly sampleRate: number, windowSec: number, stepSec: number) {
    this.windowSamples = Math.round(windowSec * sampleRate);
    this.stepSamples = Math.round(stepSec * sampleRate);
  }

  push(chunk: Float32Array): AudioWindow[] {
    const joined = new Float32Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;
    const windows: AudioWindow[] = [];
    while (this.buffer.length >= this.windowSamples) {
      windows.push(this.cut(this.windowSamples));
      this.buffer = this.buffer.slice(this.stepSamples);
      this.emitted++;
    }
    return windows;
  }

  /** Call once at the end: returns what is left if it is long enough to be worth indexing. */
  finish(): AudioWindow[] {
    const overlap = this.emitted > 0 ? this.windowSamples - this.stepSamples : 0;
    const fresh = this.buffer.length - overlap; // audio no earlier window has covered
    const worthIt = this.emitted === 0 ? this.buffer.length > 0 : fresh >= MIN_TAIL_SEC * this.sampleRate;
    return worthIt ? [this.cut(this.buffer.length)] : [];
  }

  private cut(length: number): AudioWindow {
    return { startSec: (this.emitted * this.stepSamples) / this.sampleRate, samples: this.buffer.slice(0, length) };
  }
}
