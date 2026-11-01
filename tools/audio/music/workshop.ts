// "Workshop" — the main theme of Tiny Factory: Tycoon City.
// F major, 100 BPM, 4/4, 52 bars (124.8 s), seamless loop (coda leads back into the intro).
//
// Main motif (bar 1 of A): C5 F5 A5 G5-F5 G5 — "sol-do-mi re-do re": a rising arpeggio that
// stops on the 2nd like a curious question; bar 3 answers it a step higher. The same head is
// used by the `milestone` SFX and (augmented, in Bb) by the evening theme.
//
// Form: intro(4) A(8) A2(8) B(8) bridge(8, a curious C-major/lydian detour) A3(8) coda(8).
// Stems: base = e-piano + pad + round bass (+ bridge nylon pluck), rhythm = light kit + woodblock
// "workshop clock", lead = melody & counter-lines (marimba, kalimba, glock, flute, celesta).
import { Score, Track, mel, grid, bars, thirdsBelow, shift, NoteEv } from './theory';
import { Chart, comp, sustain, bassLine, arp } from './parts';

const BPB = 4;
const S = { intro: 0, A: 4, A2: 12, B: 20, bridge: 28, A3: 36, coda: 44 } as const;
const BARS = 52;
const at = (bar: number): number => bar * BPB;

const chart = new Chart(BPB, [
  // intro
  'Fmaj7', 'Bbmaj7/F', 'Fmaj7', 'C7sus4 C7',
  // A
  'F', 'Dm7', 'Bbmaj7', 'C', 'F', 'Am7', 'Bbmaj7 C7', 'F',
  // A2
  'F', 'Dm7', 'Bbmaj7', 'C', 'F', 'Am7', 'Bbmaj7 C7', 'Gm7 C7',
  // B
  'Bbmaj7', 'C/Bb', 'Am7', 'Dm7', 'Gm7', 'C', 'Ebmaj7', 'C7sus4 C7',
  // bridge (curious detour towards C major / F lydian)
  'F', 'G/F', 'Em7', 'Am7', 'Dm7', 'G7', 'Gm7', 'C7sus4 C7',
  // A3
  'F', 'Dm7', 'Bbmaj7', 'C', 'F', 'Am7', 'Bbmaj7 C7', 'F',
  // coda -> loops into the intro
  'Bbmaj7', 'Am7', 'Gm7', 'C7', 'Fmaj7', 'Dm7', 'Gm7', 'C7sus4',
]);

// ------------------------------------------------------------------ melodies
const A1 = [
  'C5:.5 F5:.5 A5:.5! G5:.25 F5:.25 G5:1 -:.5 C5:.5',
  'A5:.5 G5:.5 F5:.5 D5:.5 F5:1.5 -:.5',
  'D5:.5 G5:.5 Bb5:.5! A5:.25 G5:.25 A5:1 -:.5 F5:.5',
  'G5:.5 F5:.5 E5:.5 C5:.5 D5:.5 E5:1 -:.5',
  'C5:.5 F5:.5 A5:.5! G5:.25 F5:.25 G5:1 -:.5 C6:.5',
  'C6:.5 A5:.5 G5:.5 E5:.5 G5:1 -:.5 A5:.25 G5:.25',
  'F5:.5 Bb5:.5 A5:.5 G5:.5 E5:.5 G5:.5 C6:.5! Bb5:.5',
];
const A_END = 'A5:1 G5:.5 F5:.5 E5:.5 F5:1.5';
const A2_END = 'Bb5:1 A5:.5 G5:.5 E5:1 C5:.5 D5:.5';
const B_MEL = [
  'D5:1.5 C5:.5 D5:1 F5:1',
  'E5:2 -:.5 C5:.5 D5:.5 E5:.5',
  'G5:1.5 F5:.5 E5:1 C5:1',
  'D5:3 -:.5 A4:.5',
  'Bb4:.5 D5:.5 F5:1 G5:.5 F5:.5 D5:1',
  'E5:.5 G5:.5 C6:1.5! Bb5:.5 G5:1',
  'G5:1.5 F5:.5 Eb5:1 D5:1',
  'C5:1 F5:1 E5:1.5 -:.5',
];
const BRIDGE = [
  'C5:.5 F5:.5 A5:.5 B5:.5 C6:1 A5:1',
  'B5:.5 A5:.5 G5:.5 D5:.5 G5:1.5 -:.5',
  'E5:.5 G5:.5 B5:.5! A5:.25 G5:.25 A5:1 -:.5 G5:.5',
  'C6:.5 B5:.5 A5:.5 E5:.5 A5:1.5 -:.5',
  'F5:.5 A5:.5 C6:.5! B5:.25 A5:.25 B5:1 -:.5 A5:.5',
  'B5:.5 A5:.5 G5:.5 F5:.5 D5:1 B4:1',
  'Bb4:.5 D5:.5 F5:.5 A5:.5 G5:1 F5:1',
  'G5:.5 F5:.5 E5:.5 D5:.5 C5:1 -:1',
];
const CODA = [
  'D5:.5 F5:.5 A5:1 G5:.5 F5:.5 D5:1',
  'C5:.5 E5:.5 G5:1 F5:.5 E5:.5 C5:1',
  'Bb4:.5 D5:.5 F5:1 E5:.5 D5:.5 Bb4:1',
  'C5:1.5 E5:.5 G5:1 Bb5:1',
  'A5:1.5 G5:.25 F5:.25 G5:2',
  'F5:1 E5:.5 D5:.5 C5:2',
  'D5:4',
];
const COUNTER_A3 = 'A4:2 C5:2 D5:2 A4:2 Bb4:2 D5:2 E5:2 G4:2 A4:2 C5:2 E5:2 C5:2 D5:2 E5:2 F5:2 C5:2';

const seq = (barsSrc: string[], startBar: number, vel = 0.75): NoteEv[] => barsSrc.flatMap((src, i) => mel(src, at(startBar + i), vel));
const onBeats = (ns: NoteEv[]): NoteEv[] => ns.filter((n) => Math.abs(n.t - Math.round(n.t)) < 1e-6 && n.d >= 0.5);

const melA = seq([...A1, A_END], S.A, 0.78);
const melA2 = seq([...A1, A2_END], S.A2, 0.74);
const melA3 = seq([...A1, A_END], S.A3, 0.8);
const melB = seq(B_MEL, S.B, 0.72);
const melBridge = seq(BRIDGE, S.bridge, 0.7);
const melCoda = seq(CODA, S.coda, 0.62).map((n, i, arr) => ({ ...n, v: n.v * (1 - (0.35 * i) / arr.length) }));
const introHint = mel('-:2 C5:.5 F5:.5 A5:.5 G5:.25 F5:.25 G5:2 -:2', at(2), 0.55);

// ------------------------------------------------------------------ base stem
const compA: Array<[number, number, number]> = [[0, 0.8, 0.7], [1.5, 0.4, 0.5], [2.5, 0.4, 0.55], [3, 0.9, 0.6]];
const compA2: Array<[number, number, number]> = [[0, 0.8, 0.68], [1, 0.35, 0.42], [1.5, 0.4, 0.5], [2.5, 0.4, 0.52], [3, 0.4, 0.5], [3.5, 0.4, 0.45]];
const compB: Array<[number, number, number]> = [[0, 1.9, 0.55], [2, 1.9, 0.5]];
const compWhole: Array<[number, number, number]> = [[0, 3.9, 0.5]];

const epiano: Track = {
  name: 'epiano', stem: 'base', instrument: 'epiano', gain: 0.6, pan: -0.12, reverb: 0.28, opts: { bright: 0.4 }, humanize: { time: 0.006, vel: 0.05 },
  notes: [
    ...comp(chart, S.intro, S.intro + 3, compWhole, 62, 4, 0.9),
    ...comp(chart, S.A, S.A + 7, compA, 62, 4),
    ...comp(chart, S.A2, S.A2 + 7, compA2, 62, 4),
    ...comp(chart, S.B, S.B + 7, compB, 62, 4),
    ...comp(chart, S.bridge, S.bridge + 7, compWhole, 60, 3, 0.75),
    ...comp(chart, S.A3, S.A3 + 7, compA2, 63, 4),
    ...comp(chart, S.coda, S.coda + 5, compB, 62, 4, 0.95),
    ...comp(chart, S.coda + 6, S.coda + 7, compWhole, 62, 4, 0.8),
  ],
};
const padT: Track = {
  name: 'pad', stem: 'base', instrument: 'pad', gain: 0.5, reverb: 0.4, opts: { attack: 0.9, release: 1.6, cutoff: 2100 },
  notes: [
    ...sustain(chart, S.intro, S.intro + 3, 66, 3, 0.45),
    ...sustain(chart, S.B, S.B + 7, 67, 4, 0.6),
    ...sustain(chart, S.bridge, S.bridge + 7, 67, 3, 0.5),
    ...sustain(chart, S.A3, S.A3 + 7, 69, 3, 0.45),
    ...sustain(chart, S.coda, S.coda + 7, 66, 4, 0.5),
  ],
};
const bassT: Track = {
  name: 'bass', stem: 'base', instrument: 'bass', gain: 0.5, reverb: 0.03, humanize: { time: 0.004, vel: 0.05 },
  notes: [
    ...bassLine(chart, S.intro, S.intro + 3, 'pedal', 0.55),
    ...bassLine(chart, S.A, S.A + 7, 'bounce', 0.72),
    ...bassLine(chart, S.A2, S.A2 + 7, 'bounce', 0.75),
    ...bassLine(chart, S.B, S.B + 7, 'half', 0.7),
    ...bassLine(chart, S.bridge, S.bridge + 7, 'sparse', 0.68),
    ...bassLine(chart, S.A3, S.A3 + 7, 'bounce', 0.78),
    ...bassLine(chart, S.coda, S.coda + 5, 'walk', 0.68),
    ...bassLine(chart, S.coda + 6, S.coda + 7, 'pedal', 0.55),
  ],
};
const pluckArp: Track = {
  name: 'pluck-arp', stem: 'base', instrument: 'pluck', gain: 0.45, pan: 0.25, reverb: 0.3, delay: 0.12, humanize: { time: 0.005, vel: 0.06 },
  notes: [...arp(chart, S.bridge, S.bridge + 7, [0, 1, 2, 3, 2, 1, 2, 3], 0.5, 64, 0.5)],
};

// ------------------------------------------------------------------ lead stem
const lead: Track[] = [
  { name: 'intro-kalimba', stem: 'lead', instrument: 'kalimba', gain: 0.75, reverb: 0.35, delay: 0.15, notes: introHint },
  { name: 'A-marimba', stem: 'lead', instrument: 'marimba', gain: 0.85, reverb: 0.25, humanize: { time: 0.004, vel: 0.05 }, notes: melA },
  { name: 'A2-kalimba', stem: 'lead', instrument: 'kalimba', gain: 0.8, reverb: 0.28, delay: 0.1, humanize: { time: 0.004, vel: 0.05 }, notes: melA2 },
  { name: 'A2-marimba-thirds', stem: 'lead', instrument: 'marimba', gain: 0.55, reverb: 0.25, humanize: { time: 0.004, vel: 0.05 }, notes: thirdsBelow(melA2, 5, 0.75) },
  { name: 'A2-glock', stem: 'lead', instrument: 'glock', gain: 0.32, reverb: 0.35, notes: shift(onBeats(melA2), 12, 0.7) },
  { name: 'B-flute', stem: 'lead', instrument: 'flute', gain: 0.75, reverb: 0.35, delay: 0.08, notes: melB },
  { name: 'B-celesta', stem: 'lead', instrument: 'celesta', gain: 0.35, reverb: 0.4, notes: shift(onBeats(melB), 12, 0.6) },
  { name: 'bridge-pluck', stem: 'lead', instrument: 'pluck', gain: 0.55, reverb: 0.3, delay: 0.12, humanize: { time: 0.004, vel: 0.05 }, notes: melBridge },
  { name: 'bridge-glock', stem: 'lead', instrument: 'glock', gain: 0.3, reverb: 0.4, notes: shift(onBeats(melBridge), 12, 0.7) },
  { name: 'A3-marimba', stem: 'lead', instrument: 'marimba', gain: 0.85, reverb: 0.25, humanize: { time: 0.004, vel: 0.05 }, notes: melA3 },
  { name: 'A3-glock', stem: 'lead', instrument: 'glock', gain: 0.4, reverb: 0.35, notes: shift(melA3, 12, 0.55) },
  { name: 'A3-flute-counter', stem: 'lead', instrument: 'flute', gain: 0.55, reverb: 0.35, notes: mel(COUNTER_A3, at(S.A3), 0.55) },
  { name: 'coda-kalimba', stem: 'lead', instrument: 'kalimba', gain: 0.75, reverb: 0.35, delay: 0.12, notes: melCoda },
  { name: 'sparkles', stem: 'lead', instrument: 'glock', gain: 0.25, reverb: 0.5, notes: [at(S.A), at(S.A2), at(S.A3)].map((t) => ({ t, d: 1, p: 89, v: 0.5 })) },
];

// ------------------------------------------------------------------ rhythm stem
const D = (kind: string, notes: NoteEv[]): NoteEv[] => notes.map((n) => ({ ...n, k: kind }));
const drums: NoteEv[] = [
  // intro: the workshop clock (tick on 1 & 3, tock on 2 & 4) + soft shaker from bar 2
  ...bars(0, 3, (b) => [...grid('x.......x.......', 'woodblock', b, { variant: 0, vel: 0.55 }), ...grid('....x.......x...', 'woodblock', b, { variant: 1, vel: 0.5 })]),
  ...bars(2, 3, (b) => grid('..-...-...-...o.', 'shaker', b, { vel: 0.8 })),
  // A: light groove
  ...bars(S.A, S.A + 7, (b) => [
    ...grid('x.....x.x.......', 'kick', b, { vel: 0.8 }),
    ...grid('....x.......x...', 'brush', b, { vel: 0.85 }),
    ...grid('-.o.-.o.-.o.-.o.', 'shaker', b),
  ]),
  ...grid('............xoxo', 'bongo', S.A + 7, { variant: 0, vel: 0.6 }),
  ...grid('.............x.x', 'bongo', S.A + 7, { variant: 1, vel: 0.55 }),
  // A2: add hats, light snare
  ...bars(S.A2, S.A2 + 7, (b) => [
    ...grid('x.....x.x.......', 'kick', b, { vel: 0.85 }),
    ...grid('....x.......x...', 'snare', b, { vel: 0.6 }),
    ...grid('..x...x...x...x.', 'hat', b, { vel: 0.6 }),
    ...grid('-.o.-.o.-.o.-.o.', 'shaker', b, { vel: 0.9 }),
    ...(b % 2 === 1 ? grid('............o...', 'tambourine', b, { vel: 0.7 }) : []),
  ]),
  ...grid('........-.-.o.x.', 'snare', S.A2 + 7, { variant: 1, vel: 0.6 }),
  // B: half-time, rim + brush sweeps
  ...bars(S.B, S.B + 7, (b) => [
    ...grid('x.........x.....', 'kick', b, { vel: 0.7 }),
    ...grid('........x.......', 'rim', b, { vel: 0.7 }),
    ...grid('x.o.x.o.x.o.x.o.', 'shaker', b, { vel: 0.6 }),
    ...(b % 2 === 0 ? grid('x...............', 'brush', b, { variant: 1, vel: 0.6 }) : []),
  ]),
  // bridge: breakdown — clock + bongos, then a gentle build
  ...bars(S.bridge, S.bridge + 7, (b) => [
    ...grid('x.......x.......', 'woodblock', b, { variant: 0, vel: 0.5 }),
    ...grid('....x.......x...', 'woodblock', b, { variant: 1, vel: 0.45 }),
    ...grid('x...............', 'kick', b, { vel: 0.6 }),
    ...grid('x.....x...x.....', 'bongo', b, { variant: 0, vel: 0.45 }),
    ...grid('...x....x.....x.', 'bongo', b, { variant: 1, vel: 0.4 }),
  ]),
  ...bars(S.bridge + 6, S.bridge + 7, (b) => grid('-.o.-.o.-.o.-.o.', 'shaker', b, { vel: 0.8 })),
  ...grid('x.x.x.x.x.x.x.x.', 'snare', S.bridge + 7, { variant: 2, vel: 0.35 }).map((n, i) => ({ ...n, v: n.v * (0.5 + i * 0.09) })),
  // 1.2 s swell = 2 beats at 100 BPM: starts on beat 3 so it peaks on the A3 downbeat
  ...grid('x...............', 'crash', S.bridge + 7, { variant: 1, vel: 0.6 }).map((n) => ({ ...n, t: n.t + 2 })),
  // A3: full groove
  ...grid('x...............', 'crash', S.A3, { vel: 0.6 }),
  ...bars(S.A3, S.A3 + 7, (b) => [
    ...grid('x.....x.x.......', 'kick', b, { vel: 0.9 }),
    ...grid('....x.......x...', 'snare', b, { vel: 0.65 }),
    ...grid('............x...', 'clap', b, { vel: 0.5 }),
    ...grid('..x...x...x...x.', 'hat', b, { vel: 0.65 }),
    ...grid('-.o.-.o.-.o.-.o.', 'shaker', b, { vel: 0.9 }),
    ...grid('....o.......o...', 'tambourine', b, { vel: 0.6 }),
  ]),
  ...grid('........x.o.x.oo', 'bongo', S.A3 + 7, { variant: 2, vel: 0.6 }),
  ...grid('.........x.x...x', 'bongo', S.A3 + 7, { variant: 3, vel: 0.55 }),
  // coda: relax, then only shaker + clock leading back to the intro
  ...bars(S.coda, S.coda + 5, (b) => [
    ...grid('x.......x.......', 'kick', b, { vel: 0.7 }),
    ...grid('....x.......x...', 'brush', b, { vel: 0.75 }),
    ...grid('-.o.-.o.-.o.-.o.', 'shaker', b, { vel: 0.75 }),
  ]),
  ...bars(S.coda + 6, S.coda + 7, (b) => [
    ...grid('-.o.-.o.-.o.-.o.', 'shaker', b, { vel: 0.55 }),
    ...grid('x.......x.......', 'woodblock', b, { variant: 0, vel: 0.5 }),
    ...grid('....x.......x...', 'woodblock', b, { variant: 1, vel: 0.45 }),
  ]),
];

const DRUM_GAIN: Record<string, number> = { kick: 0.42, snare: 0.75, brush: 1.1, hat: 1.0, shaker: 1.2, clap: 0.65, rim: 0.7, woodblock: 0.6, bongo: 0.6, tambourine: 0.9, crash: 0.7 };
const DRUM_PAN: Record<string, number> = { hat: 0.3, shaker: -0.25, tambourine: 0.35, bongo: -0.3, woodblock: 0.15, rim: 0.1 };
const kinds = [...new Set(drums.map((n) => n.k as string))];
const rhythm: Track[] = kinds.map((k) => ({
  name: `drum-${k}`, stem: 'rhythm', instrument: 'drums', gain: DRUM_GAIN[k] ?? 0.4, pan: DRUM_PAN[k] ?? 0,
  reverb: k === 'woodblock' || k === 'bongo' ? 0.2 : 0.1, humanize: { time: 0.005, vel: 0.07 }, notes: D(k, drums.filter((n) => n.k === k)),
}));

export const workshop: Score = {
  id: 'workshop',
  title: 'Workshop (main theme)',
  description: 'Warm, playful, curious main theme. Plays in the workshop and as the default daytime theme.',
  bpm: 100,
  beatsPerBar: BPB,
  bars: BARS,
  key: 'F major',
  swing: 0.05,
  sections: Object.entries(S).map(([name, bar]) => ({ name, bar })),
  stems: [
    { id: 'base', channels: 2, gain: 1, lufs: -20, description: 'e-piano comping, soft pad, round bass, bridge nylon arpeggio' },
    { id: 'rhythm', channels: 2, gain: 1, lufs: -24.5, description: 'light synthesized kit, shaker, bongos and the woodblock "workshop clock"' },
    { id: 'lead', channels: 1, gain: 1, lufs: -20.5, description: 'main motif and counter-melodies (marimba, kalimba, glockenspiel, flute, celesta, pluck)' },
  ],
  reverb: { seconds: 2.4, rt60: 1.5, predelay: 0.016, brightness: 6500, damping: 0.35, width: 0.9, seed: 3 },
  delay: { beats: 0.75, feedback: 0.3, tone: 3000 },
  tracks: [epiano, padT, bassT, pluckArp, ...lead, ...rhythm],
};
