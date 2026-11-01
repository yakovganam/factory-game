/**
 * Effects: generated-impulse-response reverb and a filtered feedback delay.
 * The IR is synthesized (decaying stereo noise whose high frequencies die faster), so no
 * recorded impulse responses are needed.
 */
import { Kit } from './kit';
import { Rng } from './rng';

export interface ReverbOpts {
  /** IR length in seconds. */
  seconds?: number;
  /** Time (s) for the tail to fall by 60 dB. */
  rt60?: number;
  /** Pre-delay in seconds. */
  predelay?: number;
  /** Lowpass at the start of the tail (Hz); it drops further over time (damping). */
  brightness?: number;
  /** Ratio of how much darker the tail end is vs. the start (0..1, 1 = no damping). */
  damping?: number;
  /** 0 = mono, 1 = fully decorrelated stereo. */
  width?: number;
  seed?: number;
  /** Optional discrete early reflections density (0..1). */
  early?: number;
}

const irCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

export function makeImpulse(ctx: BaseAudioContext, o: ReverbOpts = {}): AudioBuffer {
  const seconds = o.seconds ?? 2.2;
  const rt60 = o.rt60 ?? 1.6;
  const pre = o.predelay ?? 0.012;
  const bright = o.brightness ?? 7000;
  const damping = o.damping ?? 0.35;
  const width = o.width ?? 0.85;
  const seed = o.seed ?? 11;
  const early = o.early ?? 0.5;
  const key = JSON.stringify([seconds, rt60, pre, bright, damping, width, seed, early, ctx.sampleRate]);
  let m = irCache.get(ctx);
  if (!m) irCache.set(ctx, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;

  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const rng = new Rng(seed);
  const common = new Float32Array(len);
  for (let i = 0; i < len; i++) common[i] = rng.next() * 2 - 1;
  const preN = Math.floor(pre * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = new Rng(seed * 31 + ch * 977);
    let lp = 0;
    for (let i = preN; i < len; i++) {
      const tt = (i - preN) / sr;
      const env = Math.pow(10, (-3 * tt) / rt60); // -60 dB at rt60
      // cutoff falls exponentially from bright to bright*damping over rt60
      const fc = bright * Math.pow(damping, Math.min(1, tt / rt60));
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      const n = common[i] * (1 - width) + (r.next() * 2 - 1) * width;
      lp += a * (n - lp);
      // fade-in over the first 8 ms avoids a hard attack in the tail
      const fadeIn = Math.min(1, tt / 0.008);
      d[i] = lp * env * fadeIn;
    }
    // sparse early reflections
    if (early > 0) {
      const count = Math.floor(6 + early * 10);
      for (let k = 0; k < count; k++) {
        const t = pre + 0.004 + r.next() * 0.07;
        const idx = Math.floor(t * sr);
        if (idx < len) d[idx] += (r.next() < 0.5 ? -1 : 1) * (0.5 - (t - pre) * 4) * early;
      }
    }
    // final fade-out to avoid a truncation click
    const fo = Math.floor(0.05 * sr);
    for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
  }
  m.set(key, buf);
  return buf;
}

export interface FxSend {
  input: GainNode;
  output: GainNode;
}

/** Reverb send: input -> convolver -> output (100% wet). Connect output to the stem/master. */
export function createReverb(k: Kit, o: ReverbOpts = {}): FxSend {
  const input = k.ctx.createGain();
  const output = k.ctx.createGain();
  const conv = k.ctx.createConvolver();
  conv.normalize = true;
  conv.buffer = makeImpulse(k.ctx, o);
  // gentle low cut on the reverb input keeps the tail from getting muddy
  const hp = k.ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 180;
  input.connect(hp).connect(conv).connect(output);
  return { input, output };
}

export interface DelayOpts {
  time: number;
  feedback?: number;
  /** lowpass in the feedback path */
  tone?: number;
  /** ping-pong between channels (requires stereo destination) */
  pingpong?: boolean;
}

/** Filtered feedback delay (100% wet). */
export function createDelay(k: Kit, o: DelayOpts): FxSend {
  const ctx = k.ctx;
  const input = ctx.createGain();
  const output = ctx.createGain();
  const fb = ctx.createGain();
  fb.gain.value = o.feedback ?? 0.35;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = o.tone ?? 3200;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 250;
  if (o.pingpong) {
    const dl = ctx.createDelay(4);
    const dr = ctx.createDelay(4);
    dl.delayTime.value = o.time;
    dr.delayTime.value = o.time;
    const merger = ctx.createChannelMerger(2);
    input.connect(hp).connect(dl);
    dl.connect(dr);
    dr.connect(lp).connect(fb).connect(dl);
    dl.connect(merger, 0, 0);
    dr.connect(merger, 0, 1);
    merger.connect(output);
  } else {
    const d = ctx.createDelay(4);
    d.delayTime.value = o.time;
    input.connect(hp).connect(d);
    d.connect(lp).connect(fb).connect(d);
    d.connect(output);
  }
  return { input, output };
}
