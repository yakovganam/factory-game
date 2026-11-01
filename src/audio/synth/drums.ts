/**
 * Light synthesized drum kit. Each hit: (kit, dest, time, velocity, variant) => endTime.
 * `variant` is a small integer that changes the noise seed/offset and minor tuning so repeated
 * hits are never bit-identical (a cheap form of round-robin sampling).
 */
import { Kit, clamp } from './kit';

export type DrumFn = (k: Kit, dest: AudioNode, t: number, vel: number, variant?: number) => number;

function noiseSrc(k: Kit, t: number, dur: number, seed: number, color: 'white' | 'pink' = 'white'): AudioBufferSourceNode {
  const d = Math.min(dur + 0.01, 0.95);
  return k.src(k.noise(color, 1, seed), t, { offset: k.rng.range(0, 0.97 - d), dur: d });
}

export const kick: DrumFn = (k, dest, t, vel) => {
  const end = t + 0.5;
  return k.voice(end, () => {
    const o = k.osc('sine', 150, t, end);
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(54, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.4);
    const g = k.gain(0);
    k.perc(g.gain, t, 0.85 * vel, 0.002, 0.42);
    // 2nd harmonic layer so the kick reads on small speakers
    const o2 = k.osc('sine', 300, t, t + 0.15);
    o2.frequency.exponentialRampToValueAtTime(108, t + 0.06);
    const g2 = k.gain(0);
    k.perc(g2.gain, t, 0.16 * vel, 0.002, 0.12);
    const n = noiseSrc(k, t, 0.02, 21);
    const hp = k.filter('highpass', 2500, 0.7);
    const ng = k.gain(0);
    k.perc(ng.gain, t, 0.07 * vel, 0.0005, 0.008);
    o.connect(g).connect(dest);
    o2.connect(g2).connect(dest);
    n.connect(hp).connect(ng).connect(dest);
  });
};

export const snare: DrumFn = (k, dest, t, vel, v = 0) => {
  const end = t + 0.3;
  return k.voice(end, () => {
    const n = noiseSrc(k, t, 0.3, 31 + v);
    const bp = k.filter('bandpass', 2100 + v * 90, 0.7);
    const g = k.gain(0);
    k.perc(g.gain, t, 0.3 * vel, 0.001, 0.17);
    n.connect(bp).connect(g).connect(dest);
    const hp = k.filter('highpass', 5200, 0.7);
    const g2 = k.gain(0);
    k.perc(g2.gain, t, 0.12 * vel, 0.001, 0.09);
    n.connect(hp).connect(g2).connect(dest);
    const body = k.osc('triangle', 195, t, t + 0.12);
    body.frequency.exponentialRampToValueAtTime(165, t + 0.08);
    const bg = k.gain(0);
    k.perc(bg.gain, t, 0.28 * vel, 0.001, 0.09);
    body.connect(bg).connect(dest);
  });
};

/** Brush tap (variant 0) or sweep (variant 1). */
export const brush: DrumFn = (k, dest, t, vel, v = 0) => {
  const sweep = v % 2 === 1;
  const end = t + (sweep ? 0.45 : 0.3);
  return k.voice(end, () => {
    const n = noiseSrc(k, t, 0.5, 41 + v, 'pink');
    const bp = k.filter('bandpass', sweep ? 2400 : 3000, 0.55);
    const hp = k.filter('highpass', 900, 0.7);
    const g = k.gain(0);
    const a = sweep ? 0.14 : 0.02;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32 * vel, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    n.connect(hp).connect(bp).connect(g).connect(dest);
  });
};

export const hat: DrumFn = (k, dest, t, vel, v = 0) => {
  const open = v >= 10;
  const dur = open ? 0.32 : 0.05;
  const end = t + dur + 0.02;
  return k.voice(end, () => {
    const n = noiseSrc(k, t, dur, 51 + (v % 10));
    const hp = k.filter('highpass', 7200, 0.7);
    const bp = k.filter('bandpass', 10500, 0.6);
    const g = k.gain(0);
    k.perc(g.gain, t, (open ? 0.12 : 0.15) * vel, 0.0008, dur);
    n.connect(hp).connect(bp).connect(g).connect(dest);
  });
};

export const shaker: DrumFn = (k, dest, t, vel, v = 0) => {
  const end = t + 0.11;
  return k.voice(end, () => {
    const n = noiseSrc(k, t, 0.11, 61 + v);
    const bp = k.filter('bandpass', 5600 + (v % 3) * 300, 1.1);
    const hp = k.filter('highpass', 3000, 0.7);
    const g = k.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    n.connect(hp).connect(bp).connect(g).connect(dest);
  });
};

export const clap: DrumFn = (k, dest, t, vel, v = 0) => {
  const end = t + 0.25;
  return k.voice(end, () => {
    const n = noiseSrc(k, t, 0.25, 71 + v);
    const bp = k.filter('bandpass', 1250, 1.0);
    const hp = k.filter('highpass', 600, 0.7);
    const g = k.gain(0);
    const p = 0.36 * vel;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.0105;
      g.gain.setValueAtTime(p, tt);
      g.gain.exponentialRampToValueAtTime(p * 0.12, tt + 0.009);
    }
    g.gain.setValueAtTime(p * 0.9, t + 0.032);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(hp).connect(bp).connect(g).connect(dest);
  });
};

export const rim: DrumFn = (k, dest, t, vel) => {
  const end = t + 0.08;
  return k.voice(end, () => {
    const a = k.osc('sine', 1650, t, end);
    const ag = k.gain(0);
    k.perc(ag.gain, t, 0.18 * vel, 0.0005, 0.018);
    const b = k.osc('triangle', 460, t, end);
    const bg = k.gain(0);
    k.perc(bg.gain, t, 0.22 * vel, 0.0005, 0.035);
    a.connect(ag).connect(dest);
    b.connect(bg).connect(dest);
  });
};

/** Woodblock "tick" (variant 0, high) / "tock" (variant 1, low) — the workshop clock. */
export const woodblock: DrumFn = (k, dest, t, vel, v = 0) => {
  const f = v % 2 === 0 ? 1240 : 830;
  const end = t + 0.1;
  return k.voice(end, () => {
    const o = k.osc('sine', f * 1.04, t, end);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.01);
    const g = k.gain(0);
    k.perc(g.gain, t, 0.26 * vel, 0.0006, 0.07);
    const o2 = k.osc('sine', f * 2.7, t, end);
    const g2 = k.gain(0);
    k.perc(g2.gain, t, 0.05 * vel, 0.0004, 0.02);
    o.connect(g).connect(dest);
    o2.connect(g2).connect(dest);
  });
};

/** Hand drum: variant 0 high bongo, 1 low bongo, 2 high tom, 3 low tom. */
export const bongo: DrumFn = (k, dest, t, vel, v = 0) => {
  const table: Array<[number, number]> = [
    [395, 0.13],
    [290, 0.16],
    [170, 0.28],
    [125, 0.34],
  ];
  const [f, dec] = table[clamp(v, 0, 3)];
  const end = t + dec + 0.03;
  return k.voice(end, () => {
    const o = k.osc('sine', f * 1.45, t, end);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const g = k.gain(0);
    k.perc(g.gain, t, 0.42 * vel, 0.001, dec);
    o.connect(g).connect(dest);
    const n = noiseSrc(k, t, 0.02, 81 + v);
    const bp = k.filter('bandpass', f * 4, 1.5);
    const ng = k.gain(0);
    k.perc(ng.gain, t, 0.06 * vel, 0.0005, 0.012);
    n.connect(bp).connect(ng).connect(dest);
  });
};

export const tambourine: DrumFn = (k, dest, t, vel, v = 0) => {
  const end = t + 0.2;
  return k.voice(end, () => {
    const n = noiseSrc(k, t, 0.2, 91 + v);
    const bp = k.filter('bandpass', 8600, 2.2);
    const g = k.gain(0);
    k.perc(g.gain, t, 0.13 * vel, 0.002, 0.16);
    n.connect(bp).connect(g).connect(dest);
    for (const fr of [5900, 7300, 9400]) {
      const o = k.osc('sine', fr + v * 37, t, end);
      const og = k.gain(0);
      k.perc(og.gain, t, 0.012 * vel, 0.001, 0.12);
      o.connect(og).connect(dest);
    }
  });
};

export const snap: DrumFn = (k, dest, t, vel, v = 0) => {
  const end = t + 0.06;
  return k.voice(end, () => {
    const n = noiseSrc(k, t, 0.06, 101 + v);
    const bp = k.filter('bandpass', 2000, 2.5);
    const g = k.gain(0);
    k.perc(g.gain, t, 0.35 * vel, 0.0005, 0.035);
    n.connect(bp).connect(g).connect(dest);
  });
};

/** Soft crash / cymbal swell. variant 1 = reverse-ish swell into the downbeat. */
export const crash: DrumFn = (k, dest, t, vel, v = 0) => {
  const swell = v === 1;
  const dur = swell ? 1.2 : 1.8;
  const end = t + dur + 0.05;
  return k.voice(end, () => {
    const n = k.src(k.noise('white', 2.5, 111), t, { offset: k.rng.range(0, 0.4), dur: dur + 0.05 });
    const hp = k.filter('highpass', 4200, 0.7);
    const bp = k.filter('bandpass', 8000, 0.5);
    const g = k.gain(0);
    if (swell) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09 * vel, t + dur - 0.02);
      g.gain.linearRampToValueAtTime(0, t + dur);
    } else {
      k.perc(g.gain, t, 0.1 * vel, 0.004, dur);
    }
    n.connect(hp).connect(bp).connect(g).connect(dest);
  });
};

export const DRUMS: Record<string, DrumFn> = {
  kick,
  snare,
  brush,
  hat,
  shaker,
  clap,
  rim,
  woodblock,
  bongo,
  tambourine,
  snap,
  crash,
};
