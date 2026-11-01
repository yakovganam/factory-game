// Score data model + small music-theory helpers used by the theme scores (the "editable source").
//
// Time is in beats (quarter notes). A Score is rendered per stem by perform.ts.

import type { InstrOpts } from '../../../src/audio/synth/instruments';
import type { ReverbOpts } from '../../../src/audio/synth/fx';

export interface NoteEv {
  /** start, beats from the start of the piece */
  t: number;
  /** duration in beats */
  d: number;
  /** MIDI pitch (for drum tracks: the drum variant index) */
  p: number;
  /** velocity 0..1 */
  v: number;
  /** drum kind (drum tracks only) */
  k?: string;
}

export interface Track {
  name: string;
  stem: string;
  /** key of INSTRUMENTS, or 'drums' */
  instrument: string;
  gain: number;
  pan?: number;
  reverb?: number;
  delay?: number;
  opts?: InstrOpts;
  /** optional per-track filters (Hz) */
  lowpass?: number;
  highpass?: number;
  /** humanize: timing jitter (s) and velocity jitter (0..1) */
  humanize?: { time: number; vel: number };
  notes: NoteEv[];
}

export interface StemDef {
  id: string;
  channels: 1 | 2;
  gain: number;
  /**
   * Target integrated loudness of this stem on its own (LUFS) before the full-mix normalization.
   * Sets the balance between stems (e.g. base -20, lead -21, rhythm -24); render-music.mjs trims
   * each stem to it, then scales all stems together so the full mix hits the theme target.
   */
  lufs: number;
  description: string;
}

export interface Score {
  id: string;
  title: string;
  description: string;
  bpm: number;
  beatsPerBar: number;
  bars: number;
  key: string;
  /** 8th-note swing amount in beats (0 = straight; 0.06 = light lilt) */
  swing?: number;
  /** high-shelf gain above 3.2 kHz on every stem (default +3 dB) */
  presenceDb?: number;
  sections: Array<{ name: string; bar: number }>;
  stems: StemDef[];
  reverb: ReverbOpts;
  delay?: { beats: number; feedback: number; tone: number };
  tracks: Track[];
}

// ------------------------------------------------------------------ pitch helpers
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C5' -> 72, 'F#4' -> 66, 'Bb3' -> 58 */
export function nn(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function pcOf(name: string): number {
  const m = /^([A-G])([#b]?)/.exec(name);
  if (!m) throw new Error(`bad root ${name}`);
  return (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

/**
 * Melody string -> notes. Tokens: `<pitch>:<beats>` e.g. "C5:.5 F5:1 -:.5" ('-' = rest,
 * '_' = tie/extend the previous note). Suffix '!' accents (+0.15 vel), '?' ghosts (-0.3 vel).
 */
export function mel(src: string, startBeat: number, vel = 0.75): NoteEv[] {
  const out: NoteEv[] = [];
  let t = startBeat;
  for (const raw of src.trim().split(/\s+/)) {
    if (!raw) continue;
    let tok = raw;
    let v = vel;
    if (tok.endsWith('!')) {
      v = Math.min(1, vel + 0.15);
      tok = tok.slice(0, -1);
    } else if (tok.endsWith('?')) {
      v = Math.max(0.1, vel - 0.3);
      tok = tok.slice(0, -1);
    }
    const [p, d] = tok.split(':');
    const dur = Number(d);
    if (!Number.isFinite(dur)) throw new Error(`bad token ${raw}`);
    if (p === '-') {
      /* rest */
    } else if (p === '_') {
      const last = out[out.length - 1];
      if (last) last.d += dur;
    } else out.push({ t, d: dur, p: nn(p), v });
    t += dur;
  }
  return out;
}

/** Length in beats of a melody string. */
export function melLen(src: string): number {
  return src
    .trim()
    .split(/\s+/)
    .reduce((a, tok) => a + Number(tok.replace(/[!?]$/, '').split(':')[1]), 0);
}

export interface Chord {
  sym: string;
  root: number;
  /** bass pitch class (slash chords) */
  bass: number;
  /** pitch classes, root first */
  pcs: number[];
}

const QUALITIES: Array<[RegExp, number[]]> = [
  [/^maj9$/, [0, 4, 7, 11, 14]],
  [/^maj7$/, [0, 4, 7, 11]],
  [/^m9$/, [0, 3, 7, 10, 14]],
  [/^m7b5$/, [0, 3, 6, 10]],
  [/^m7$/, [0, 3, 7, 10]],
  [/^m6$/, [0, 3, 7, 9]],
  [/^m$/, [0, 3, 7]],
  [/^7sus4$/, [0, 5, 7, 10]],
  [/^sus4$/, [0, 5, 7]],
  [/^sus2$/, [0, 2, 7]],
  [/^add9$/, [0, 4, 7, 14]],
  [/^11$/, [0, 7, 10, 14, 17]],
  [/^9$/, [0, 4, 7, 10, 14]],
  [/^7$/, [0, 4, 7, 10]],
  [/^6$/, [0, 4, 7, 9]],
  [/^dim$/, [0, 3, 6]],
  [/^$/, [0, 4, 7]],
];

export function chord(sym: string): Chord {
  const [main, slash] = sym.split('/');
  const m = /^([A-G][#b]?)(.*)$/.exec(main);
  if (!m) throw new Error(`bad chord ${sym}`);
  const root = pcOf(m[1]);
  const q = QUALITIES.find(([re]) => re.test(m[2]));
  if (!q) throw new Error(`unknown chord quality ${sym}`);
  return { sym, root, bass: slash ? pcOf(slash) : root, pcs: q[1].map((x) => (root + x) % 12) };
}

/**
 * Close voicing of `pcs` around a centre pitch, voice-led from the previous voicing.
 * `max` limits the number of notes (drops the 5th first, then extensions).
 */
export function voice(pcs: number[], centre: number, max = 4, prev?: number[]): number[] {
  let use = pcs.slice();
  if (use.length > max) {
    // drop the fifth (index 2) first, keep colour tones
    const fifth = (pcs[0] + 7) % 12;
    use = use.filter((p) => p !== fifth);
    use = use.slice(0, max);
  }
  const target = prev && prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : centre;
  const notes = use.map((pc) => {
    let n = pc + 12 * Math.round((target - pc) / 12);
    if (n - target > 6) n -= 12;
    if (target - n > 6) n += 12;
    return n;
  });
  notes.sort((a, b) => a - b);
  // avoid minor-second clusters at the bottom (muddy): lift the lower note an octave
  for (let i = 0; i + 1 < notes.length; i++) {
    if (notes[i + 1] - notes[i] === 1 && notes[i] < centre) notes[i] += 12;
  }
  return notes.sort((a, b) => a - b);
}

/** Bass pitch for a pitch class within [lo, hi]. */
export function bassNote(pc: number, lo = 40, hi = 51): number {
  let n = pc + 12 * Math.floor(lo / 12);
  while (n < lo) n += 12;
  while (n > hi) n -= 12;
  return n;
}

/** A bar's chords: "F" or "Bbmaj7 C7" (two halves). Returns [beatOffset, Chord] pairs. */
export function barChords(spec: string, beatsPerBar = 4): Array<[number, number, Chord]> {
  const parts = spec.trim().split(/\s+/);
  const len = beatsPerBar / parts.length;
  return parts.map((p, i) => [i * len, len, chord(p)]);
}

// ------------------------------------------------------------------ drum grids
/**
 * 16-step drum grid for one 4/4 bar: 'X' 1.0, 'x' 0.8, 'o' 0.6, '-' 0.35 (ghost), '.' rest.
 */
export function grid(pattern: string, kind: string, bar: number, opts: { variant?: number; vel?: number; beatsPerBar?: number; steps?: number } = {}): NoteEv[] {
  const out: NoteEv[] = [];
  const bpb = opts.beatsPerBar ?? 4;
  const steps = opts.steps ?? pattern.length;
  const stepBeats = bpb / steps;
  const scale = opts.vel ?? 1;
  const velOf: Record<string, number> = { X: 1, x: 0.8, o: 0.6, '-': 0.35 };
  [...pattern].forEach((c, i) => {
    const v = velOf[c];
    if (v) out.push({ t: bar * bpb + i * stepBeats, d: stepBeats, p: opts.variant ?? 0, v: v * scale, k: kind });
  });
  return out;
}

/** Repeat a per-bar generator over a bar range. */
export function bars(from: number, to: number, fn: (bar: number, i: number) => NoteEv[]): NoteEv[] {
  const out: NoteEv[] = [];
  for (let b = from; b <= to; b++) out.push(...fn(b, b - from));
  return out;
}

/** Diatonic third below each note within a major scale (for "cute" doubled-thirds lines). */
export function thirdsBelow(notes: NoteEv[], tonicPc: number, velScale = 0.7): NoteEv[] {
  const scale = [0, 2, 4, 5, 7, 9, 11].map((x) => (x + tonicPc) % 12);
  return notes.map((n) => {
    const pc = ((n.p % 12) + 12) % 12;
    let idx = scale.indexOf(pc);
    if (idx < 0) return { ...n, p: n.p - 3, v: n.v * velScale };
    idx = (idx + 5) % 7; // two scale steps down
    let p = n.p - 1;
    while (((p % 12) + 12) % 12 !== scale[idx]) p--;
    return { ...n, p, v: n.v * velScale };
  });
}

export function shift(notes: NoteEv[], semis: number, velScale = 1): NoteEv[] {
  return notes.map((n) => ({ ...n, p: n.p + semis, v: n.v * velScale }));
}
