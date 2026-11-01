/**
 * Kit: a thin, tracked wrapper around a BaseAudioContext used by every instrument, drum and SFX
 * recipe. Nodes created through the kit are recorded per voice so long offline renders can
 * disconnect finished voices (see sequencer.ts) — that keeps Chromium's offline graph small and
 * makes a 2-minute stem render ~15x faster than scheduling everything up front.
 */
import { Rng } from './rng';

export type NoiseColor = 'white' | 'pink' | 'brown';

export interface VoiceRec {
  end: number;
  nodes: AudioNode[];
}

export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => (g <= 1e-9 ? -180 : 20 * Math.log10(g));
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Exponential ramps cannot target 0; this is the floor we use for "silent". */
export const SILENT = 0.0001;

export class Kit {
  readonly ctx: BaseAudioContext;
  readonly sr: number;
  rng: Rng;
  /** Final destination for recipes that don't specify one. */
  out: AudioNode;
  /** For loop recipes: the loop length in seconds (used to quantize periodic content). */
  loopLen = 0;
  /** Total offline render length in seconds (loop recipes fill this, it includes the wrap crossfade). */
  renderLen = 0;
  private cur: AudioNode[] | null = null;
  readonly live: VoiceRec[] = [];
  private noiseCache = new Map<string, AudioBuffer>();
  private waveCache = new Map<string, PeriodicWave>();

  constructor(ctx: BaseAudioContext, out: AudioNode, seed: number) {
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    this.out = out;
    this.rng = new Rng(seed);
  }

  /** Group nodes created inside fn into one voice that ends at `end` (seconds, context time). */
  voice(end: number, fn: () => void): number {
    const prev = this.cur;
    const nodes: AudioNode[] = [];
    this.cur = nodes;
    try {
      fn();
      return end;
    } finally {
      this.cur = prev;
      if (prev) prev.push(...nodes);
      else this.live.push({ end, nodes });
    }
  }

  /** Disconnect voices that ended before `now` (offline windowed rendering). */
  collect(now: number): number {
    let n = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i];
      if (v.end < now) {
        for (const node of v.nodes) {
          try {
            node.disconnect();
          } catch {
            /* already disconnected */
          }
        }
        this.live.splice(i, 1);
        n++;
      }
    }
    return n;
  }

  private track<T extends AudioNode>(n: T): T {
    if (this.cur) this.cur.push(n);
    return n;
  }

  // ---------------------------------------------------------------- node factories
  gain(v = 1): GainNode {
    const g = this.track(this.ctx.createGain());
    g.gain.value = v;
    return g;
  }

  osc(type: OscillatorType | 'softsaw' | 'softsquare' | 'organ', freq: number, t0: number, t1: number, detune = 0): OscillatorNode {
    const o = this.track(this.ctx.createOscillator());
    if (type === 'softsaw' || type === 'softsquare' || type === 'organ') o.setPeriodicWave(this.wave(type));
    else o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (detune) o.detune.setValueAtTime(detune, t0);
    o.start(t0);
    o.stop(t1);
    return o;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0): BiquadFilterNode {
    const f = this.track(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = clamp(freq, 10, this.sr * 0.49);
    f.Q.value = q;
    f.gain.value = gainDb;
    return f;
  }

  /** Stereo panner (falls back to a unity gain if StereoPannerNode is unavailable). */
  pan(p: number): AudioNode {
    const c = this.ctx as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode };
    if (typeof c.createStereoPanner === 'function') {
      const n = this.track(c.createStereoPanner());
      n.pan.value = clamp(p, -1, 1);
      return n;
    }
    return this.gain(1);
  }

  delay(time: number, max = 2): DelayNode {
    const d = this.track(this.ctx.createDelay(max));
    d.delayTime.value = time;
    return d;
  }

  shaper(curve: Float32Array): WaveShaperNode {
    const s = this.track(this.ctx.createWaveShaper());
    s.curve = curve as Float32Array<ArrayBuffer>;
    return s;
  }

  src(buffer: AudioBuffer, t0: number, opts: { rate?: number; offset?: number; dur?: number; loop?: boolean } = {}): AudioBufferSourceNode {
    const s = this.track(this.ctx.createBufferSource());
    s.buffer = buffer;
    if (opts.rate) s.playbackRate.setValueAtTime(opts.rate, t0);
    s.loop = !!opts.loop;
    const off = opts.offset ?? 0;
    // opts.dur is real (context) time; start()'s duration argument is buffer-content time
    if (opts.dur !== undefined && !opts.loop) s.start(t0, off, opts.dur * (opts.rate ?? 1));
    else s.start(t0, off);
    if (opts.loop && opts.dur !== undefined) s.stop(t0 + opts.dur);
    return s;
  }

  constant(value: number, t0: number, t1: number): ConstantSourceNode | null {
    const c = this.ctx as BaseAudioContext & { createConstantSource?: () => ConstantSourceNode };
    if (typeof c.createConstantSource !== 'function') return null;
    const n = this.track(c.createConstantSource());
    n.offset.value = value;
    n.start(t0);
    n.stop(t1);
    return n;
  }

  /** Low-frequency oscillator modulating `param` by +-depth around its current value. */
  lfo(param: AudioParam, rate: number, depth: number, t0: number, t1: number, type: OscillatorType = 'sine'): void {
    const o = this.osc(type, rate, t0, t1);
    const g = this.gain(depth);
    o.connect(g).connect(param);
  }

  // ---------------------------------------------------------------- envelopes
  /** Attack to peak, exponential decay to silence at t+dur. Returns the end time. */
  perc(param: AudioParam, t: number, peak: number, attack: number, dur: number): number {
    param.setValueAtTime(SILENT, t);
    param.linearRampToValueAtTime(peak, t + Math.max(0.0008, attack));
    param.exponentialRampToValueAtTime(SILENT, t + Math.max(attack + 0.002, dur));
    param.setValueAtTime(0, t + Math.max(attack + 0.003, dur));
    return t + dur;
  }

  /**
   * Classic ADSR with a time-constant decay; release begins at t+hold.
   * Returns the end time (t + hold + release*5).
   */
  adsr(param: AudioParam, t: number, peak: number, a: number, d: number, s: number, hold: number, r: number): number {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setTargetAtTime(peak * s, t + a, Math.max(0.001, d / 3));
    const rel = t + Math.max(hold, a + 0.001);
    param.setTargetAtTime(0, rel, Math.max(0.001, r / 4));
    return rel + r * 1.6;
  }

  /** Piecewise envelope: [timeOffset, value, 'lin'|'exp'|'set'] points relative to t. */
  env(param: AudioParam, t: number, pts: Array<[number, number, ('lin' | 'exp' | 'set')?]>): void {
    for (const [dt, v, kind] of pts) {
      const tt = t + dt;
      if (kind === 'set') param.setValueAtTime(v, tt);
      else if (kind === 'exp') param.exponentialRampToValueAtTime(Math.max(SILENT, v), tt);
      else param.linearRampToValueAtTime(v, tt);
    }
  }

  // ---------------------------------------------------------------- buffers & waves
  /** Seeded noise buffer, cached per (color, seed, length). */
  noise(color: NoiseColor = 'white', seconds = 2, seed = 1): AudioBuffer {
    const key = `${color}:${seed}:${seconds}`;
    const hit = this.noiseCache.get(key);
    if (hit) return hit;
    const len = Math.max(1, Math.floor(seconds * this.sr));
    const buf = this.ctx.createBuffer(1, len, this.sr);
    const d = buf.getChannelData(0);
    const r = new Rng(seed * 7919 + (color === 'pink' ? 13 : color === 'brown' ? 29 : 3));
    if (color === 'white') {
      for (let i = 0; i < len; i++) d[i] = r.next() * 2 - 1;
    } else if (color === 'pink') {
      // Paul Kellet's economy pink filter
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = r.next() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
    } else {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = r.next() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    this.noiseCache.set(key, buf);
    return buf;
  }

  wave(kind: 'softsaw' | 'softsquare' | 'organ'): PeriodicWave {
    const hit = this.waveCache.get(kind);
    if (hit) return hit;
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let h = 1; h < n; h++) {
      if (kind === 'softsaw') imag[h] = 1 / Math.pow(h, 1.35);
      else if (kind === 'softsquare') imag[h] = h % 2 ? 1 / Math.pow(h, 1.25) : 0.04 / h;
      else imag[h] = [0, 1, 0.6, 0.35, 0.25, 0, 0.12, 0, 0.08][h] ?? 0;
    }
    const w = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this.waveCache.set(kind, w);
    return w;
  }

  /** Round `f` so it completes an integer number of cycles in the loop (seamless tonal loops). */
  loopFreq(f: number): number {
    if (!this.loopLen) return f;
    return Math.max(1, Math.round(f * this.loopLen)) / this.loopLen;
  }

  /** Soft-clip curve for gentle saturation. */
  static softClip(amount = 1.5, n = 1024): Float32Array {
    const c = new Float32Array(n);
    const norm = Math.tanh(amount);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * amount) / norm;
    }
    return c;
  }
}
