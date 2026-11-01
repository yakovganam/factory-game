/**
 * Building blocks for sound-effect recipes (see src/audio/sfx-catalog.ts).
 * All helpers schedule nodes on the kit's context and return the time they end.
 */
import { Kit, NoiseColor, SILENT, clamp } from './kit';

type OscKind = OscillatorType | 'softsaw' | 'softsquare' | 'organ';

export interface FilterSpec {
  type: BiquadFilterType;
  f: number;
  q?: number;
  /** optional sweep target (exponential over `sweep` seconds or the sound's duration) */
  f2?: number;
  sweep?: number;
  gain?: number;
}

function applyFilter(k: Kit, input: AudioNode, spec: FilterSpec | undefined, t: number, dur: number): AudioNode {
  if (!spec) return input;
  const f = k.filter(spec.type, spec.f, spec.q ?? 0.707, spec.gain ?? 0);
  f.frequency.setValueAtTime(clamp(spec.f, 10, k.sr * 0.49), t);
  if (spec.f2) f.frequency.exponentialRampToValueAtTime(clamp(spec.f2, 10, k.sr * 0.49), t + (spec.sweep ?? dur));
  input.connect(f);
  return f;
}

function finish(k: Kit, node: AudioNode, pan: number | undefined, dest: AudioNode | undefined): void {
  if (pan) node.connect(k.pan(pan)).connect(dest ?? k.out);
  else node.connect(dest ?? k.out);
}

export interface ToneOpts {
  t?: number;
  type?: OscKind;
  f: number;
  /** pitch target for a glide */
  f2?: number;
  /** glide time (default: whole duration) */
  glide?: number;
  glideLin?: boolean;
  dur: number;
  /** attack seconds */
  a?: number;
  amp?: number;
  /** if set, sustain at full level until `hold`, then fade linearly to 0 at `dur` */
  hold?: number;
  filter?: FilterSpec;
  pan?: number;
  dest?: AudioNode;
  detune?: number;
  vib?: { rate: number; depth: number };
}

export function tone(k: Kit, o: ToneOpts): number {
  const t = o.t ?? 0;
  const end = t + o.dur + 0.005;
  const os = k.osc(o.type ?? 'sine', o.f, t, end, o.detune ?? 0);
  if (o.f2) {
    const tg = t + (o.glide ?? o.dur);
    if (o.glideLin) os.frequency.linearRampToValueAtTime(o.f2, tg);
    else os.frequency.exponentialRampToValueAtTime(o.f2, tg);
  }
  if (o.vib) k.lfo(os.detune, o.vib.rate, o.vib.depth, t, end);
  const g = k.gain(0);
  const amp = o.amp ?? 0.3;
  const a = o.a ?? 0.002;
  if (o.hold !== undefined) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + a);
    g.gain.setValueAtTime(amp, t + Math.max(a, o.hold));
    g.gain.linearRampToValueAtTime(0, t + o.dur);
  } else {
    k.perc(g.gain, t, amp, a, o.dur);
  }
  const n = applyFilter(k, os, o.filter, t, o.dur);
  n.connect(g);
  finish(k, g, o.pan, o.dest);
  return end;
}

export interface NoiseOpts {
  t?: number;
  dur: number;
  a?: number;
  amp?: number;
  color?: NoiseColor;
  seed?: number;
  filter?: FilterSpec;
  filter2?: FilterSpec;
  hold?: number;
  /** playback rate of the noise buffer (lower = grainier/darker) */
  rate?: number;
  pan?: number;
  dest?: AudioNode;
  /** 'perc' (default) exponential decay, 'swell' slow rise then fall, 'flat' sustained */
  shape?: 'perc' | 'swell' | 'flat';
}

export function noiseHit(k: Kit, o: NoiseOpts): number {
  const t = o.t ?? 0;
  const end = t + o.dur + 0.005;
  const len = 2;
  const buf = k.noise(o.color ?? 'white', len, o.seed ?? 1);
  const maxOff = Math.max(0, len - o.dur * (o.rate ?? 1) - 0.05);
  const s = k.src(buf, t, { offset: k.rng.range(0, maxOff), dur: o.dur + 0.005, rate: o.rate, loop: o.dur * (o.rate ?? 1) > len - 0.1 });
  const g = k.gain(0);
  const amp = o.amp ?? 0.3;
  const a = o.a ?? 0.002;
  const shape = o.shape ?? (o.hold !== undefined ? 'flat' : 'perc');
  if (shape === 'perc') k.perc(g.gain, t, amp, a, o.dur);
  else if (shape === 'swell') {
    g.gain.setValueAtTime(SILENT, t);
    g.gain.exponentialRampToValueAtTime(amp, t + Math.max(a, o.dur * 0.6));
    g.gain.exponentialRampToValueAtTime(SILENT, t + o.dur);
    g.gain.setValueAtTime(0, t + o.dur);
  } else {
    const hold = o.hold ?? o.dur * 0.7;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + a);
    g.gain.setValueAtTime(amp, t + Math.max(a, hold));
    g.gain.linearRampToValueAtTime(0, t + o.dur);
  }
  let n: AudioNode = applyFilter(k, s, o.filter, t, o.dur);
  n = applyFilter(k, n, o.filter2, t, o.dur);
  n.connect(g);
  finish(k, g, o.pan, o.dest);
  return end;
}

export interface RingOpts {
  t?: number;
  f: number;
  /** [ratio, relative amp, decay seconds] */
  partials: Array<[number, number, number]>;
  amp?: number;
  a?: number;
  pan?: number;
  dest?: AudioNode;
  detune?: number;
}

/** Inharmonic struck ring (coins, bells, metal parts). */
export function ring(k: Kit, o: RingOpts): number {
  const t = o.t ?? 0;
  let end = t;
  const bus = k.gain(o.amp ?? 0.25);
  for (const [r, a, d] of o.partials) {
    const f = o.f * r;
    if (f > k.sr * 0.46) continue;
    const e = t + d + 0.01;
    const os = k.osc('sine', f, t, e, o.detune ?? 0);
    const g = k.gain(0);
    k.perc(g.gain, t, a, o.a ?? 0.0008, d);
    os.connect(g).connect(bus);
    end = Math.max(end, e);
  }
  finish(k, bus, o.pan, o.dest);
  return end;
}

export interface GrainOpts {
  t?: number;
  dur: number;
  /** grains per second at start */
  density: number;
  /** grains per second at end (linear interpolation) */
  densityEnd?: number;
  amp: number;
  ampJitter?: number;
  grainDur?: number;
  grainJitter?: number;
  filter?: FilterSpec;
  /** per-grain random bandpass centre range [lo, hi] */
  bandRange?: [number, number];
  bandQ?: number;
  color?: NoiseColor;
  seed?: number;
  pan?: number;
  panJitter?: number;
  dest?: AudioNode;
  /** overall amplitude contour */
  shape?: 'flat' | 'decay' | 'rise' | 'swell';
  /** exactly periodic grains (for seamless loops): density must divide the loop length */
  periodic?: boolean;
}

/** Granular noise bursts: crackle, rattle, gravel, confetti, sparkle. */
export function grains(k: Kit, o: GrainOpts): number {
  const t0 = o.t ?? 0;
  const buf = k.noise(o.color ?? 'white', 1, o.seed ?? 7);
  const gd = o.grainDur ?? 0.006;
  let tt = 0;
  let end = t0;
  const shapeAt = (x: number): number => {
    switch (o.shape) {
      case 'decay':
        return Math.pow(1 - x, 1.6);
      case 'rise':
        return 0.15 + 0.85 * x;
      case 'swell':
        return Math.sin(Math.PI * x);
      default:
        return 1;
    }
  };
  const sum = k.gain(1);
  const out = applyFilter(k, sum, o.filter, t0, o.dur);
  let i = 0;
  while (tt < o.dur && i < 4000) {
    const x = tt / o.dur;
    const dens = o.density + ((o.densityEnd ?? o.density) - o.density) * x;
    const gdur = gd * (1 + (o.grainJitter ?? 0.5) * (k.rng.next() * 2 - 1));
    const a = o.amp * shapeAt(x) * (1 - (o.ampJitter ?? 0.5) * k.rng.next());
    const ts = t0 + tt;
    const s = k.src(buf, ts, { offset: k.rng.range(0, 0.95), dur: gdur + 0.002 });
    const g = k.gain(0);
    k.perc(g.gain, ts, a, 0.0004, gdur);
    let n: AudioNode = s;
    if (o.bandRange) {
      const bp = k.filter('bandpass', k.rng.range(o.bandRange[0], o.bandRange[1]), o.bandQ ?? 2);
      n.connect(bp);
      n = bp;
    }
    n.connect(g);
    if (o.panJitter) g.connect(k.pan((o.pan ?? 0) + (k.rng.next() * 2 - 1) * o.panJitter)).connect(sum);
    else g.connect(sum);
    end = Math.max(end, ts + gdur + 0.003);
    const step = o.periodic ? 1 / dens : (-Math.log(1 - k.rng.next() * 0.999) / dens);
    tt += step;
    i++;
  }
  finish(k, out, o.pan && !o.panJitter ? o.pan : undefined, o.dest);
  return end;
}

/** Bird-like chirp: sine sweeping through `pts` ([dt, freq] pairs) with a smooth envelope. */
export function chirp(k: Kit, t: number, pts: Array<[number, number]>, amp: number, dest?: AudioNode, pan?: number): number {
  const dur = pts[pts.length - 1][0];
  const end = t + dur + 0.01;
  const os = k.osc('sine', pts[0][1], t, end);
  for (let i = 1; i < pts.length; i++) os.frequency.exponentialRampToValueAtTime(pts[i][1], t + pts[i][0]);
  const g = k.gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp, t + Math.min(0.012, dur * 0.25));
  g.gain.setValueAtTime(amp, t + dur * 0.6);
  g.gain.linearRampToValueAtTime(0, t + dur);
  // a little harmonic sheen
  const h = k.osc('sine', pts[0][1] * 2, t, end);
  for (let i = 1; i < pts.length; i++) h.frequency.exponentialRampToValueAtTime(pts[i][1] * 2, t + pts[i][0]);
  const hg = k.gain(0.08);
  os.connect(g);
  h.connect(hg).connect(g);
  finish(k, g, pan, dest);
  return end;
}

/** A short "room" reverb send for one-shots: returns a node to connect dry signal into (dry+wet out). */
export function roomSend(k: Kit, wet: number, dest?: AudioNode, rt60 = 0.6): AudioNode {
  const input = k.gain(1);
  const conv = k.ctx.createConvolver();
  conv.normalize = true;
  // lazy import avoided: small IR generated inline
  const len = Math.floor(k.sr * Math.min(1.5, rt60 * 1.5));
  const ir = k.ctx.createBuffer(2, len, k.sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / k.sr;
      lp += 0.35 * ((k.rng.next() * 2 - 1) - lp);
      d[i] = lp * Math.pow(10, (-3 * x) / rt60) * Math.min(1, x / 0.004);
    }
  }
  conv.buffer = ir;
  const wg = k.gain(wet);
  input.connect(dest ?? k.out);
  input.connect(conv).connect(wg).connect(dest ?? k.out);
  return input;
}
