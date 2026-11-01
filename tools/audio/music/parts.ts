// Accompaniment generators (comping, pads, bass lines, arpeggios) driven by a whole-song chord
// chart, so voice leading and bass approach notes also wrap seamlessly from the last bar to bar 0.
import { NoteEv, Chord, barChords, voice, bassNote } from './theory';

export interface Seg {
  /** absolute start beat */
  t: number;
  len: number;
  c: Chord;
  bar: number;
  index: number;
}

export class Chart {
  readonly segs: Seg[] = [];
  constructor(
    readonly bpb: number,
    readonly specs: string[],
  ) {
    specs.forEach((spec, bar) => {
      for (const [off, len, c] of barChords(spec, bpb)) this.segs.push({ t: bar * bpb + off, len, c, bar, index: this.segs.length });
    });
  }
  get bars(): number {
    return this.specs.length;
  }
  in(fromBar: number, toBar: number): Seg[] {
    return this.segs.filter((s) => s.bar >= fromBar && s.bar <= toBar);
  }
  next(s: Seg): Seg {
    return this.segs[(s.index + 1) % this.segs.length];
  }
  at(beat: number): Seg {
    let hit = this.segs[0];
    for (const s of this.segs) if (s.t <= beat + 1e-6) hit = s;
    return hit;
  }
}

/** Rhythmic comping: pattern of [beatInBar, dur, vel]; each hit voices the chord sounding then. */
export function comp(ch: Chart, from: number, to: number, pattern: Array<[number, number, number]>, centre: number, max = 4, velScale = 1): NoteEv[] {
  const out: NoteEv[] = [];
  let prev: number[] | undefined;
  for (let bar = from; bar <= to; bar++) {
    for (const [b, d, v] of pattern) {
      const t = bar * ch.bpb + b;
      const s = ch.at(t);
      const notes = voice(s.c.pcs, centre, max, prev);
      prev = notes;
      // don't ring past the chord change
      const dur = Math.min(d, s.t + s.len - t);
      for (const p of notes) out.push({ t, d: Math.max(0.1, dur), p, v: v * velScale });
    }
  }
  return out;
}

/** Sustained chords, one voicing per chord segment. */
export function sustain(ch: Chart, from: number, to: number, centre: number, max = 4, vel = 0.6, legato = 0.98): NoteEv[] {
  const out: NoteEv[] = [];
  let prev: number[] | undefined;
  for (const s of ch.in(from, to)) {
    const notes = voice(s.c.pcs, centre, max, prev);
    prev = notes;
    for (const p of notes) out.push({ t: s.t, d: s.len * legato, p, v: vel });
  }
  return out;
}

export type BassStyle = 'pedal' | 'half' | 'bounce' | 'walk' | 'octaves' | 'sparse';

/** Bass line. Approach notes lead chromatically into the next chord's bass (wrapping at the end). */
export function bassLine(ch: Chart, from: number, to: number, style: BassStyle, vel = 0.75, lo = 40, hi = 51): NoteEv[] {
  const out: NoteEv[] = [];
  for (const s of ch.in(from, to)) {
    const root = bassNote(s.c.bass, lo, hi);
    const nxt = ch.next(s);
    const nroot = bassNote(nxt.c.bass, lo, hi);
    const fifthPc = (s.c.root + 7) % 12;
    let fifth = bassNote(fifthPc, lo, hi + 5);
    if (fifth < root) fifth += 12;
    const third = bassNote(s.c.pcs[1], lo, hi + 5);
    const approach = nroot === root ? root + 7 - 12 * (root + 7 > hi + 5 ? 1 : 0) : nroot + (nroot > root ? -1 : 1);
    const n = (t: number, d: number, p: number, v = vel): void => {
      out.push({ t: s.t + t, d, p, v });
    };
    const L = s.len;
    switch (style) {
      case 'pedal':
        n(0, L * 0.95, root);
        break;
      case 'half':
        n(0, Math.min(L, 2) * 0.92, root);
        if (L >= 4) n(2, 1.85, fifth, vel * 0.9);
        break;
      case 'sparse':
        n(0, 1.5, root);
        if (L >= 4) n(2.5, 0.45, fifth, vel * 0.8);
        break;
      case 'bounce':
        if (L >= 4) {
          n(0, 0.9, root);
          n(1.5, 0.42, fifth, vel * 0.8);
          n(2, 0.9, root, vel * 0.9);
          n(3, 0.42, root + 12, vel * 0.75);
          n(3.5, 0.42, approach, vel * 0.8);
        } else {
          n(0, 1.4, root);
          n(1.5, 0.42, approach, vel * 0.8);
        }
        break;
      case 'walk':
        if (L >= 4) {
          n(0, 0.95, root);
          n(1, 0.9, third, vel * 0.85);
          n(2, 0.9, fifth, vel * 0.85);
          n(3, 0.9, approach, vel * 0.8);
        } else {
          n(0, 0.95, root);
          n(1, 0.9, approach, vel * 0.8);
        }
        break;
      case 'octaves':
        for (let b = 0; b < L; b += 0.5) {
          const up = (b * 2) % 2 === 1;
          const last = b >= L - 0.5;
          n(b, 0.4, last ? approach : up ? root + 12 : root, (b % 1 === 0 ? 1 : 0.7) * vel);
        }
        break;
    }
  }
  return out;
}

/** Arpeggio over each chord: `order` indexes into the voicing (cycled), one note per step. */
export function arp(ch: Chart, from: number, to: number, order: number[], stepBeats: number, centre: number, vel = 0.55, max = 4, noteLen = 1.5): NoteEv[] {
  const out: NoteEv[] = [];
  let prev: number[] | undefined;
  let k = 0;
  for (const s of ch.in(from, to)) {
    const notes = voice(s.c.pcs, centre, max, prev);
    prev = notes;
    for (let b = 0; b < s.len - 1e-6; b += stepBeats) {
      const idx = order[k % order.length];
      k++;
      const p = notes[idx % notes.length] + 12 * Math.floor(idx / notes.length);
      const accent = b % 1 === 0 ? 1 : 0.82;
      out.push({ t: s.t + b, d: stepBeats * noteLen, p, v: vel * accent });
    }
  }
  return out;
}
