/**
 * Melodic instruments. Each function schedules one note on `dest` and returns its end time.
 * Signature: (kit, dest, startTime, midiNote, durationSeconds, velocity0to1, options) => endTime.
 * Every node is created inside kit.voice() so windowed offline renders can free it.
 */
import { Kit, midiToFreq, clamp } from './kit';

export interface InstrOpts {
  /** -1..1 extra brightness/timbre tweak, instrument specific. */
  bright?: number;
  /** Release time override (s). */
  release?: number;
  /** Attack time override (s). */
  attack?: number;
  /** Lowpass cutoff override (Hz) for filtered instruments. */
  cutoff?: number;
  /** Detune spread (cents) for ensemble instruments. */
  spread?: number;
  /** Vibrato depth in cents. */
  vibrato?: number;
}

export type InstrumentFn = (k: Kit, dest: AudioNode, t: number, midi: number, dur: number, vel: number, o?: InstrOpts) => number;

const velGain = (vel: number, floor = 0.3): number => floor + (1 - floor) * clamp(vel, 0, 1);

/** Warm FM electric piano (Rhodes-like): ratio-1 FM with decaying index plus a soft tine partial. */
export const epiano: InstrumentFn = (k, dest, t, midi, dur, vel, o = {}) => {
  const f = midiToFreq(midi);
  const rel = o.release ?? 0.32;
  const decay = clamp(3.2 - (midi - 48) * 0.05, 0.7, 3.6);
  const end = t + Math.min(dur + rel * 2.2, dur + 2.5);
  return k.voice(end, () => {
    const amp = k.gain(0);
    const peak = 0.2 * velGain(vel);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.004);
    amp.gain.setTargetAtTime(peak * 0.18, t + 0.004, decay * 0.45);
    amp.gain.setTargetAtTime(0, t + dur, rel / 3.5);
    const car = k.osc('sine', f, t, end);
    const mod = k.osc('sine', f, t, end);
    const idx = k.gain(0);
    const bright = 1 + (o.bright ?? 0) * 0.6;
    const i0 = f * (0.9 + 1.9 * vel) * bright;
    idx.gain.setValueAtTime(i0, t);
    idx.gain.setTargetAtTime(f * 0.22 * bright, t, 0.18 + decay * 0.05);
    mod.connect(idx).connect(car.frequency);
    // tine: short high partial gives the "bell" in the attack
    const tine = k.osc('sine', f * 4.0, t, Math.min(end, t + 0.5));
    const tg = k.gain(0);
    k.perc(tg.gain, t, 0.035 * velGain(vel, 0.1) * bright, 0.001, 0.22);
    // body: a quiet sub-octave-free second harmonic for warmth on small speakers
    const h2 = k.osc('sine', f * 2, t, end);
    const h2g = k.gain(0.05);
    car.connect(amp);
    h2.connect(h2g).connect(amp);
    tine.connect(tg).connect(amp);
    amp.connect(dest);
  });
};

/** Marimba: bar partials 1 : 3.93 : 9.2 with a soft mallet click. */
export const marimba: InstrumentFn = (k, dest, t, midi, _dur, vel, o = {}) => {
  const f = midiToFreq(midi);
  const dec = clamp(0.62 - (midi - 60) * 0.014, 0.16, 0.95);
  const end = t + dec * 1.6 + 0.02;
  return k.voice(end, () => {
    const out = k.gain(0.32 * velGain(vel));
    const p = [
      [1, 1, 1],
      [3.93, 0.22 + 0.15 * (o.bright ?? 0), 0.28],
      [9.2, 0.05, 0.08],
    ];
    for (const [ratio, a, dm] of p) {
      if (f * ratio > k.sr * 0.45) continue;
      const os = k.osc('sine', f * ratio, t, end);
      const g = k.gain(0);
      k.perc(g.gain, t, a, 0.002, dec * dm * 1.6);
      os.connect(g).connect(out);
    }
    const click = k.src(k.noise('white', 0.3, 5), t, { offset: k.rng.range(0, 0.25), dur: 0.02 });
    const bp = k.filter('bandpass', Math.min(f * 3, 6000), 1.2);
    const cg = k.gain(0);
    k.perc(cg.gain, t, 0.12, 0.0005, 0.012);
    click.connect(bp).connect(cg).connect(out);
    out.connect(dest);
  });
};

/** Kalimba / thumb piano: fundamental with slight pitch drop, inharmonic tine partial. */
export const kalimba: InstrumentFn = (k, dest, t, midi, _dur, vel, o = {}) => {
  const f = midiToFreq(midi);
  const dec = clamp(1.3 - (midi - 60) * 0.02, 0.45, 1.6);
  const end = t + dec * 1.5;
  return k.voice(end, () => {
    const out = k.gain(0.3 * velGain(vel));
    const os = k.osc('sine', f * 1.012, t, end);
    os.frequency.exponentialRampToValueAtTime(f, t + 0.025);
    const g = k.gain(0);
    k.perc(g.gain, t, 1, 0.0015, dec * 1.5);
    os.connect(g).connect(out);
    const parts: Array<[number, number, number]> = [
      [5.4, 0.12 + 0.06 * (o.bright ?? 0), 0.1],
      [2.0, 0.07, 0.35],
      [8.9, 0.03, 0.04],
    ];
    for (const [r, a, dm] of parts) {
      if (f * r > k.sr * 0.45) continue;
      const po = k.osc('sine', f * r, t, end);
      const pg = k.gain(0);
      k.perc(pg.gain, t, a, 0.001, dec * dm * 1.5);
      po.connect(pg).connect(out);
    }
    out.connect(dest);
  });
};

/** Glockenspiel: bright steel bar partials, long ring. */
export const glock: InstrumentFn = (k, dest, t, midi, _dur, vel, o = {}) => {
  const f = midiToFreq(midi);
  const dec = clamp(1.9 - (midi - 72) * 0.03, 0.6, 2.2);
  const end = t + dec * 1.4;
  return k.voice(end, () => {
    const out = k.gain(0.17 * velGain(vel));
    const parts: Array<[number, number, number]> = [
      [1, 1, 1],
      [2.756, 0.38 + 0.2 * (o.bright ?? 0), 0.42],
      [5.404, 0.16, 0.18],
      [8.933, 0.07, 0.08],
    ];
    for (const [r, a, dm] of parts) {
      if (f * r > k.sr * 0.45) continue;
      const po = k.osc('sine', f * r, t, end);
      const pg = k.gain(0);
      k.perc(pg.gain, t, a, 0.0008, dec * dm * 1.4);
      po.connect(pg).connect(out);
    }
    out.connect(dest);
  });
};

/** Celesta: felt-hammer bell, rounder and softer than glock. */
export const celesta: InstrumentFn = (k, dest, t, midi, dur, vel) => {
  const f = midiToFreq(midi);
  const dec = clamp(1.6 - (midi - 72) * 0.03, 0.5, 1.9);
  const end = t + Math.max(dur, 0.2) + dec;
  return k.voice(end, () => {
    const out = k.gain(0.2 * velGain(vel));
    const parts: Array<[number, number, number]> = [
      [1, 1, 1],
      [2, 0.18, 0.4],
      [3.01, 0.06, 0.2],
      [4.2, 0.03, 0.08],
    ];
    for (const [r, a, dm] of parts) {
      if (f * r > k.sr * 0.45) continue;
      const po = k.osc('sine', f * r, t, end);
      const pg = k.gain(0);
      k.perc(pg.gain, t, a, 0.003, (end - t) * dm);
      po.connect(pg).connect(out);
    }
    out.connect(dest);
  });
};

/** FM bell (UI chimes, music box sparkle). bright: -1..1 changes the modulator ratio. */
export const bell: InstrumentFn = (k, dest, t, midi, dur, vel, o = {}) => {
  const f = midiToFreq(midi);
  const dec = Math.max(0.3, dur);
  const end = t + dec + 0.05;
  return k.voice(end, () => {
    const out = k.gain(0);
    k.perc(out.gain, t, 0.2 * velGain(vel), 0.0015, dec);
    const car = k.osc('sine', f, t, end);
    const ratio = (o.bright ?? 0) > 0.3 ? 3.5 : 1.4;
    const mod = k.osc('sine', f * ratio, t, end);
    const idx = k.gain(0);
    idx.gain.setValueAtTime(f * (1.6 + (o.bright ?? 0)), t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05, t + dec * 0.7);
    mod.connect(idx).connect(car.frequency);
    car.connect(out).connect(dest);
  });
};

/** Soft pad: detuned soft saws (L/R) + sine body through a gentle lowpass, slow attack. */
export const pad: InstrumentFn = (k, dest, t, midi, dur, vel, o = {}) => {
  const f = midiToFreq(midi);
  const atk = o.attack ?? 0.7;
  const rel = o.release ?? 1.4;
  const end = t + dur + rel * 1.3;
  const spread = o.spread ?? 9;
  return k.voice(end, () => {
    const lp = k.filter('lowpass', o.cutoff ?? 1500 + 900 * (o.bright ?? 0), 0.5);
    const amp = k.gain(0);
    const peak = 0.09 * velGain(vel, 0.5);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + atk);
    amp.gain.setValueAtTime(peak, t + Math.max(atk, dur));
    amp.gain.linearRampToValueAtTime(0, t + Math.max(atk, dur) + rel);
    const sides: Array<[number, number]> = [
      [-spread, -0.6],
      [spread, 0.6],
    ];
    for (const [det, p] of sides) {
      const os = k.osc('softsaw', f, t, end, det);
      const pn = k.pan(p);
      os.connect(pn).connect(lp);
    }
    const body = k.osc('sine', f, t, end);
    const bg = k.gain(0.6);
    body.connect(bg).connect(lp);
    k.lfo(lp.frequency, 0.13 + k.rng.next() * 0.07, 220, t, end);
    lp.connect(amp).connect(dest);
  });
};

/** String-ish ensemble: three detuned soft saws, faster attack and vibrato. */
export const strings: InstrumentFn = (k, dest, t, midi, dur, vel, o = {}) => {
  const f = midiToFreq(midi);
  const atk = o.attack ?? 0.22;
  const rel = o.release ?? 0.6;
  const end = t + dur + rel * 1.3;
  return k.voice(end, () => {
    const lp = k.filter('lowpass', o.cutoff ?? 2600, 0.6);
    const amp = k.gain(0);
    const peak = 0.075 * velGain(vel, 0.4);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + atk);
    amp.gain.setValueAtTime(peak, t + Math.max(atk, dur));
    amp.gain.linearRampToValueAtTime(0, t + Math.max(atk, dur) + rel);
    const dets: Array<[number, number]> = [
      [-11, -0.7],
      [0, 0],
      [11, 0.7],
    ];
    for (const [det, p] of dets) {
      const os = k.osc('softsaw', f, t, end, det);
      k.lfo(os.detune, 5.1 + k.rng.next() * 0.6, o.vibrato ?? 7, t, end);
      const pn = k.pan(p);
      os.connect(pn).connect(lp);
    }
    lp.connect(amp).connect(dest);
  });
};

/** Round bass: sine + triangle + 2nd harmonic (audible on phone speakers), filtered pluck. */
export const bass: InstrumentFn = (k, dest, t, midi, dur, vel, o = {}) => {
  const f = midiToFreq(midi);
  const rel = o.release ?? 0.09;
  const end = t + dur + rel * 2;
  return k.voice(end, () => {
    const lp = k.filter('lowpass', 900, 0.8);
    const c0 = (o.cutoff ?? 650) + 900 * vel;
    lp.frequency.setValueAtTime(c0, t);
    lp.frequency.setTargetAtTime(Math.max(260, c0 * 0.45), t + 0.005, 0.12);
    const amp = k.gain(0);
    const peak = 0.36 * velGain(vel, 0.5);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.006);
    amp.gain.setTargetAtTime(peak * 0.72, t + 0.006, 0.12);
    amp.gain.setTargetAtTime(0, t + dur, rel / 3);
    const s = k.osc('sine', f, t, end);
    const tri = k.osc('triangle', f, t, end);
    const tg = k.gain(0.35);
    const h2 = k.osc('sine', f * 2, t, end);
    const h2g = k.gain(0.16);
    s.connect(lp);
    tri.connect(tg).connect(lp);
    h2.connect(h2g).connect(lp);
    lp.connect(amp).connect(dest);
  });
};

/** Plucked nylon-ish string: soft saw through a fast-closing lowpass. */
export const pluck: InstrumentFn = (k, dest, t, midi, _dur, vel, o = {}) => {
  const f = midiToFreq(midi);
  const dec = clamp(1.1 - (midi - 55) * 0.012, 0.35, 1.3);
  const end = t + dec * 1.5;
  return k.voice(end, () => {
    const lp = k.filter('lowpass', f * 8, 0.9);
    lp.frequency.setValueAtTime(Math.min(f * (6 + 6 * vel) * (1 + (o.bright ?? 0) * 0.5), 9000), t);
    lp.frequency.setTargetAtTime(f * 1.6, t + 0.002, 0.09);
    const amp = k.gain(0);
    k.perc(amp.gain, t, 0.22 * velGain(vel), 0.002, dec * 1.5);
    const a = k.osc('softsaw', f, t, end);
    const b = k.osc('triangle', f, t, end, 4);
    const bg = k.gain(0.5);
    a.connect(lp);
    b.connect(bg).connect(lp);
    lp.connect(amp).connect(dest);
  });
};

/** Soft flute/whistle lead: sine with light harmonics, delayed vibrato and breath noise. */
export const flute: InstrumentFn = (k, dest, t, midi, dur, vel, o = {}) => {
  const f = midiToFreq(midi);
  const atk = o.attack ?? 0.055;
  const rel = o.release ?? 0.16;
  const end = t + dur + rel * 2;
  return k.voice(end, () => {
    const amp = k.gain(0);
    const peak = 0.16 * velGain(vel, 0.45);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + atk);
    amp.gain.setTargetAtTime(peak * 0.82, t + atk, 0.12);
    amp.gain.setTargetAtTime(0, t + dur, rel / 3);
    const vib = k.gain(0);
    const depth = o.vibrato ?? 14;
    vib.gain.setValueAtTime(0, t);
    vib.gain.linearRampToValueAtTime(0, t + 0.18);
    vib.gain.linearRampToValueAtTime(depth, t + 0.55);
    const lfo = k.osc('sine', 5.2, t, end);
    lfo.connect(vib);
    const harm: Array<[number, number]> = [
      [1, 1],
      [2, 0.12],
      [3, 0.04],
    ];
    for (const [r, a] of harm) {
      const os = k.osc('sine', f * r, t, end);
      vib.connect(os.detune);
      const g = k.gain(a);
      os.connect(g).connect(amp);
    }
    const br = k.src(k.noise('pink', 1.5, 9), t, { offset: k.rng.range(0, 0.5), dur: end - t, loop: true });
    const bp = k.filter('bandpass', Math.min(f * 2, 7000), 1.6);
    const bg = k.gain(0.06);
    br.connect(bp).connect(bg).connect(amp);
    amp.connect(dest);
  });
};

/** Soft synth brass: two detuned soft saws, filter swell on attack ("bwah"). */
export const brass: InstrumentFn = (k, dest, t, midi, dur, vel, o = {}) => {
  const f = midiToFreq(midi);
  const rel = o.release ?? 0.18;
  const end = t + dur + rel * 2;
  return k.voice(end, () => {
    const lp = k.filter('lowpass', f * 1.5, 1.2);
    const top = Math.min(f * (3.5 + 2.5 * vel), 7000);
    lp.frequency.setValueAtTime(f * 1.3, t);
    lp.frequency.linearRampToValueAtTime(top, t + 0.07);
    lp.frequency.setTargetAtTime(top * 0.6, t + 0.07, 0.2);
    const amp = k.gain(0);
    const peak = 0.11 * velGain(vel, 0.45);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.04);
    amp.gain.setTargetAtTime(peak * 0.8, t + 0.04, 0.15);
    amp.gain.setTargetAtTime(0, t + dur, rel / 3);
    for (const det of [-6, 6]) {
      const os = k.osc('softsaw', f, t, end, det);
      os.connect(lp);
    }
    lp.connect(amp).connect(dest);
  });
};

/** Music-box tine: tiny, high, very short sparkle (city/hightech flourishes). */
export const musicbox: InstrumentFn = (k, dest, t, midi, _dur, vel) => {
  const f = midiToFreq(midi);
  const end = t + 0.9;
  return k.voice(end, () => {
    const out = k.gain(0.14 * velGain(vel));
    for (const [r, a, d] of [
      [1, 1, 0.8],
      [3.01, 0.2, 0.25],
      [6.1, 0.06, 0.08],
    ] as Array<[number, number, number]>) {
      if (f * r > k.sr * 0.45) continue;
      const os = k.osc('sine', f * r, t, end);
      const g = k.gain(0);
      k.perc(g.gain, t, a, 0.0006, d);
      os.connect(g).connect(out);
    }
    out.connect(dest);
  });
};

export const INSTRUMENTS: Record<string, InstrumentFn> = {
  epiano,
  marimba,
  kalimba,
  glock,
  celesta,
  bell,
  pad,
  strings,
  bass,
  pluck,
  flute,
  brass,
  musicbox,
};

