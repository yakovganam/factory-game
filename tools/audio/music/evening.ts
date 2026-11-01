// "Evening" — the night/evening variation of the main theme.
// Bb major (the subdominant of the workshop's F), 76 BPM, 4/4, 40 bars (126.3 s), seamless loop.
//
// The workshop motif C-F-A-G-F-G becomes F-Bb-D-C-Bb (+ C), in augmented, breathing rhythm
// (quarter notes instead of eighths), with long rests answered by a soft kalimba.
// Form: intro(4) A(8, celesta) B(8, flute) C(8, G-minor interlude on kalimba) A2(8, flute +
// celesta) outro(4, motif fragment) -> intro. Stems: base (e-piano/pad/bass/pluck, very soft
// brushes) and lead. No rhythm stem: evenings are deliberately calmer.
import { Score, Track, mel, grid, bars, shift, NoteEv } from './theory';
import { Chart, comp, sustain, bassLine, arp } from './parts';

const BPB = 4;
const S = { intro: 0, A: 4, B: 12, C: 20, A2: 28, outro: 36 } as const;
const BARS = 40;
const at = (bar: number): number => bar * BPB;

const chart = new Chart(BPB, [
  'Bbmaj9', 'Gm9', 'Ebmaj9', 'F7sus4',
  'Bbmaj7', 'Gm7', 'Ebmaj7', 'F7sus4 F7', 'Bbmaj7', 'Dm7', 'Ebmaj7 Cm7', 'F7sus4',
  'Ebmaj7', 'Dm7', 'Cm7', 'Bbmaj7', 'Ebmaj7', 'Dm7 G7', 'Cm7', 'F7sus4 F7',
  'Gm9', 'Ebmaj7', 'Cm9', 'Dm7', 'Gm9', 'Ebmaj7', 'Cm7', 'F7sus4',
  'Bbmaj7', 'Gm7', 'Ebmaj7', 'F7sus4 F7', 'Bbmaj7', 'Dm7', 'Ebmaj7 Cm7', 'F7sus4',
  'Bbmaj9', 'Gm9', 'Ebmaj9', 'F7sus4',
]);

const MEL_A = [
  'F4:1 Bb4:1 D5:1! C5:.5 Bb4:.5',
  'C5:3 -:1',
  'G4:1 C5:1 Eb5:1! D5:.5 C5:.5',
  'Eb5:1.5 D5:.5 C5:1 -:.5 F4:.5',
  'F4:1 Bb4:1 D5:1! C5:.5 Bb4:.5',
  'A4:.5 C5:.5 F5:2 E5:1',
  'Eb5:1 D5:1 C5:1 Bb4:1',
  'C5:2 -:2',
];
const MEL_B = [
  'G5:1.5 F5:.5 Eb5:1 D5:1',
  'F5:2 -:.5 D5:.5 E5:.5 F5:.5',
  'G5:1.5 F5:.5 Eb5:1 C5:1',
  'D5:3 -:1',
  'Bb4:.5 Eb5:.5 G5:1 F5:.5 Eb5:.5 G5:1',
  'F5:1 A5:1 B5:1 G5:1',
  'C6:2! Bb5:1 G5:1',
  'Bb5:2 A5:1 -:1',
];
const MEL_C = [
  'D5:1.5 C5:.5 Bb4:1 A4:1',
  'G4:2 Bb4:1 D5:1',
  'Eb5:1.5 D5:.5 C5:1 Bb4:1',
  'A4:3 -:1',
  'G4:.5 Bb4:.5 D5:1 F5:1.5 Eb5:.5',
  'D5:2 G5:1 F5:1',
  'Eb5:1 D5:1 C5:1 Bb4:1',
  'C5:2 -:2',
];
const ANSWERS_A = ['-:4', '-:3 Bb5:.5 C6:.5', '-:4', '-:4', '-:4', '-:3 G5:.5 A5:.5', '-:4', '-:2 F5:.5 G5:.5 C6:1'];
const ANSWERS_A2 = ['-:4', '-:2.5 D6:.5 C6:.5 Bb5:.5', '-:4', '-:4', '-:4', '-:3 A5:.5 C6:.5', '-:4', '-:2 C6:.5 D6:.5 F6:1'];
const OUTRO = 'F5:1 Bb5:1 D6:2 C6:4 -:4 -:4';

const seq = (src: string[], startBar: number, vel: number): NoteEv[] => src.flatMap((b, i) => mel(b, at(startBar + i), vel));
const onBeats = (ns: NoteEv[]): NoteEv[] => ns.filter((n) => Math.abs(n.t - Math.round(n.t)) < 1e-6 && n.d >= 1);

const melA = seq(MEL_A, S.A, 0.68);
const melB = seq(MEL_B, S.B, 0.66);
const melC = seq(MEL_C, S.C, 0.66);
const melA2 = seq(MEL_A, S.A2, 0.68);

// ------------------------------------------------------------------ base
const ARP = [0, 1, 2, 3, 1, 2, 3, 2];
const epiano: Track = {
  name: 'epiano', stem: 'base', instrument: 'epiano', gain: 0.55, pan: -0.1, reverb: 0.4, opts: { bright: 0.1, release: 0.6 }, humanize: { time: 0.008, vel: 0.06 },
  notes: [
    ...comp(chart, S.intro, S.intro + 3, [[0, 3.9, 0.48]], 62, 4),
    ...arp(chart, S.A, S.A + 7, ARP, 0.5, 63, 0.42, 4, 1.8),
    ...comp(chart, S.B, S.B + 7, [[0, 1.9, 0.5], [2, 1.9, 0.44]], 62, 4),
    ...comp(chart, S.C, S.C + 7, [[0, 3.9, 0.4]], 60, 3),
    ...arp(chart, S.A2, S.A2 + 7, ARP, 0.5, 63, 0.44, 4, 1.8),
    ...comp(chart, S.outro, S.outro + 3, [[0, 3.9, 0.45]], 62, 4),
  ],
};
const padT: Track = {
  name: 'pad', stem: 'base', instrument: 'pad', gain: 0.55, reverb: 0.5, opts: { attack: 1.4, release: 2.2, cutoff: 2200 },
  notes: [...sustain(chart, S.intro, S.outro + 3, 65, 4, 0.5)],
};
const bassT: Track = {
  name: 'bass', stem: 'base', instrument: 'bass', gain: 0.45, reverb: 0.05, opts: { cutoff: 450, release: 0.25 }, humanize: { time: 0.006, vel: 0.05 },
  notes: [
    ...bassLine(chart, S.intro, S.intro + 3, 'pedal', 0.55, 38, 50),
    ...bassLine(chart, S.A, S.A + 7, 'half', 0.6, 38, 50),
    ...bassLine(chart, S.B, S.B + 7, 'half', 0.62, 38, 50),
    ...bassLine(chart, S.C, S.C + 7, 'walk', 0.55, 38, 50),
    ...bassLine(chart, S.A2, S.A2 + 7, 'half', 0.62, 38, 50),
    ...bassLine(chart, S.outro, S.outro + 3, 'pedal', 0.5, 38, 50),
  ],
};
const pluckT: Track = {
  name: 'nylon-arp', stem: 'base', instrument: 'pluck', gain: 0.45, pan: 0.3, reverb: 0.4, delay: 0.12, humanize: { time: 0.008, vel: 0.06 },
  notes: arp(chart, S.C, S.C + 7, [0, 1, 2, 3, 2, 1, 2, 1], 0.5, 60, 0.46),
};
const softKit: NoteEv[] = [
  ...bars(S.B, S.B + 7, (b) => [...grid('....x.......x...', 'brush', b, { vel: 0.35 }), ...grid('..-...-...-...-.', 'shaker', b, { vel: 0.7 })]),
  ...bars(S.A2, S.A2 + 7, (b) => [...grid('....x.......x...', 'brush', b, { vel: 0.38 }), ...grid('-.o.-.o.-.o.-.o.', 'shaker', b, { vel: 0.6 }), ...(b % 2 === 0 ? grid('x...............', 'brush', b, { variant: 1, vel: 0.4 }) : [])]),
];
const kitTracks: Track[] = ['brush', 'shaker'].map((k) => ({
  name: `soft-${k}`, stem: 'base', instrument: 'drums', gain: k === 'brush' ? 0.9 : 0.8, pan: k === 'shaker' ? 0.3 : -0.1, reverb: 0.25, humanize: { time: 0.008, vel: 0.08 },
  notes: softKit.filter((n) => n.k === k),
}));

// ------------------------------------------------------------------ lead
const lead: Track[] = [
  { name: 'A-celesta', stem: 'lead', instrument: 'celesta', gain: 0.85, reverb: 0.45, delay: 0.12, humanize: { time: 0.006, vel: 0.05 }, notes: melA },
  { name: 'A-answers', stem: 'lead', instrument: 'kalimba', gain: 0.55, reverb: 0.5, delay: 0.2, notes: seq(ANSWERS_A, S.A, 0.5) },
  { name: 'B-flute', stem: 'lead', instrument: 'flute', gain: 0.8, reverb: 0.45, delay: 0.1, opts: { vibrato: 16 }, notes: melB },
  { name: 'B-celesta', stem: 'lead', instrument: 'celesta', gain: 0.3, reverb: 0.5, notes: shift(onBeats(melB), 12, 0.6) },
  { name: 'C-kalimba', stem: 'lead', instrument: 'kalimba', gain: 0.8, reverb: 0.45, delay: 0.18, humanize: { time: 0.006, vel: 0.05 }, notes: melC },
  { name: 'C-flute-low', stem: 'lead', instrument: 'flute', gain: 0.35, reverb: 0.45, notes: shift(onBeats(melC), -12, 0.6) },
  { name: 'A2-flute', stem: 'lead', instrument: 'flute', gain: 0.8, reverb: 0.45, delay: 0.1, opts: { vibrato: 16 }, notes: melA2 },
  { name: 'A2-celesta', stem: 'lead', instrument: 'celesta', gain: 0.4, reverb: 0.5, notes: shift(onBeats(melA2), 12, 0.6) },
  { name: 'A2-answers', stem: 'lead', instrument: 'kalimba', gain: 0.55, reverb: 0.5, delay: 0.2, notes: seq(ANSWERS_A2, S.A2, 0.5) },
  { name: 'outro-celesta', stem: 'lead', instrument: 'celesta', gain: 0.7, reverb: 0.55, delay: 0.2, notes: mel(OUTRO, at(S.outro), 0.55) },
];

export const evening: Score = {
  id: 'evening',
  title: 'Evening (night variation)',
  description: 'Gentle evening/night variation on the main motif; replaces the daytime theme as night falls.',
  bpm: 76,
  beatsPerBar: BPB,
  bars: BARS,
  key: 'Bb major',
  swing: 0.08,
  presenceDb: 3,
  sections: Object.entries(S).map(([name, bar]) => ({ name, bar })),
  stems: [
    { id: 'base', channels: 2, gain: 1, lufs: -19.5, description: 'arpeggiated e-piano, warm pad, soft bass, nylon arpeggio, whisper-quiet brushes' },
    { id: 'lead', channels: 1, gain: 1, lufs: -20.5, description: 'augmented motif and answers (celesta, flute, kalimba)' },
  ],
  reverb: { seconds: 3.2, rt60: 2.3, predelay: 0.025, brightness: 5200, damping: 0.3, width: 1, seed: 5 },
  delay: { beats: 0.75, feedback: 0.35, tone: 2600 },
  tracks: [epiano, padT, bassT, pluckT, ...kitTracks, ...lead],
};
