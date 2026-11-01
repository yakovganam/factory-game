/**
 * Sound-event catalog. Every event is synthesized procedurally (no samples) by its `recipe`,
 * rendered once per variation into an AudioBuffer via OfflineAudioContext (see sfx-render.ts).
 *
 * Sonic identity: warm, toy-like, wooden/glassy materials; tonal events use F major (the key of
 * the main "workshop" theme), so achievements and confirmations sound like part of the score.
 * Alerts are soft (muted marimba / hollow wood), never sirens.
 *
 * Variation rule: variations change synthesis parameters, material layers and noise seeds — not
 * only pitch. Some events give the variation index a meaning (documented in `variationNotes`).
 */
import type { MixerBus } from './types';
import { Kit, midiToFreq } from './synth/kit';
import { tone, noiseHit, ring, grains, chirp, roomSend } from './synth/sfx';
import { marimba, kalimba, glock, celesta, bell, pluck, pad, musicbox } from './synth/instruments';
import { crash } from './synth/drums';

export type SfxCategory = 'ui' | 'economy' | 'build' | 'machine' | 'alert' | 'vehicle' | 'retail' | 'ambience' | 'foley';
export type Recipe = (k: Kit, variation: number, out: AudioNode) => void;

export interface SfxDef {
  id: string;
  bus: MixerBus;
  category: SfxCategory;
  description: string;
  /** Default linear playback gain (mix level relative to other events). */
  gain: number;
  /** One-shots: max concurrent voices. Loops: max simultaneous (clustered) loop voices. */
  maxVoices: number;
  /** Minimum seconds between two triggers of this event (one-shots). */
  minInterval: number;
  loop: boolean;
  /** Number of distinct rendered variations. */
  variations: number;
  /** Render length in seconds (loops: exact loop length). */
  duration: number;
  /** Extra render time after `duration` for decays (one-shots, default 0.08). */
  tail?: number;
  /** Render in stereo (ambience beds). Default mono, panned at runtime. */
  stereo?: boolean;
  /** false = never positional (attenuation/pan ignored). Default true. */
  spatial?: boolean;
  /** Outdoor sources get muffled/attenuated while the listener is inside a factory. */
  outdoor?: boolean;
  /** Random playbackRate jitter (+- fraction) applied on top of variations. */
  pitchJitter: number;
  /** Lazy render order: 0 renders first. */
  priority: number;
  /** Normalization target override (loudest 50 ms RMS, dBFS). */
  level?: number;
  /** Duck music while this plays. */
  duck?: { amount: number; seconds: number };
  /** Meaning of variation indices when the caller should choose deliberately. */
  variationNotes?: string;
  recipe: Recipe;
}

// --------------------------------------------------------------------------------------------
// helpers
const N = {
  F3: 53, A3: 57, Bb3: 58, C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, Bb4: 70, B4: 71,
  C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, Bb5: 82, C6: 84, D6: 86, E6: 88, F6: 89,
  G6: 91, A6: 93, C7: 96, D7: 98, E7: 100, F7: 101,
};
const hz = midiToFreq;

function click(k: Kit, t: number, f: number, amp: number, q = 1.5, dur = 0.01, dest?: AudioNode): void {
  noiseHit(k, { t, dur, amp, filter: { type: 'bandpass', f, q }, seed: 3 + Math.floor(f), dest });
}
/**
 * Low impact. Besides the pitched low body it adds a short mid-range "knock" (2.7x partial and
 * band-passed noise around 600-900 Hz) so the impact still reads on phone speakers that cannot
 * reproduce < 200 Hz.
 */
function thud(k: Kit, t: number, f0: number, f1: number, dur: number, amp: number, dest?: AudioNode): void {
  tone(k, { t, f: f0, f2: f1, glide: dur * 0.5, dur, amp, a: 0.0015, dest });
  tone(k, { t, f: f0 * 2.7, f2: f1 * 2.7, glide: dur * 0.3, dur: Math.min(dur, 0.08), amp: amp * 0.35, a: 0.001, dest });
  noiseHit(k, { t, dur: Math.min(0.045, dur * 0.5), amp: amp * 0.5, color: 'pink', filter: { type: 'bandpass', f: Math.min(1000, 650 + f0), q: 1.1 }, seed: 77, dest });
}
function sparkle(k: Kit, t: number, dur: number, amp: number, dest?: AudioNode, density = 45): void {
  grains(k, { t, dur, density, densityEnd: density * 0.4, amp, bandRange: [6500, 11000], bandQ: 6, grainDur: 0.012, shape: 'decay', panJitter: 0.5, dest });
}
/** Periodic grain density so that a loop contains an integer number of grains. */
function loopRate(k: Kit, perSec: number): number {
  return k.loopLen ? Math.max(1, Math.round(perSec * k.loopLen)) / k.loopLen : perSec;
}
const coin = (k: Kit, t: number, f: number, amp: number, spread = 0, dest?: AudioNode): void => {
  ring(k, {
    t,
    f,
    amp,
    dest,
    partials: [
      [1, 1, 0.34],
      [1.48 + spread, 0.55, 0.22],
      [2.63 + spread * 0.5, 0.32, 0.14],
      [3.81, 0.14, 0.07],
    ],
  });
  noiseHit(k, { t, dur: 0.004, amp: amp * 0.5, filter: { type: 'highpass', f: 6000 }, seed: 17, dest });
};

type Def = Omit<SfxDef, 'gain' | 'maxVoices' | 'minInterval' | 'loop' | 'variations' | 'duration' | 'pitchJitter' | 'priority'> &
  Partial<Pick<SfxDef, 'gain' | 'maxVoices' | 'minInterval' | 'loop' | 'variations' | 'duration' | 'pitchJitter' | 'priority'>>;

const PRIORITY: Record<SfxCategory, number> = { ui: 0, economy: 1, build: 2, alert: 2, machine: 3, foley: 3, vehicle: 4, retail: 4, ambience: 5 };

function ev(d: Def): SfxDef {
  return {
    gain: 0.6,
    maxVoices: 4,
    minInterval: 0.05,
    loop: false,
    variations: 1,
    duration: 0.5,
    pitchJitter: 0.02,
    priority: PRIORITY[d.category] + (d.loop ? 1 : 0),
    ...d,
  };
}

// --------------------------------------------------------------------------------------------
export const SFX_CATALOG: SfxDef[] = [
  // ============================================================== UI
  ev({
    id: 'ui_tap', bus: 'ui', category: 'ui', description: 'Generic button tap: soft wooden/plastic tok.',
    gain: 0.5, variations: 3, duration: 0.07, maxVoices: 3, minInterval: 0.03, pitchJitter: 0.03,
    recipe: (k, v) => {
      if (v === 0) {
        tone(k, { f: 1500, f2: 980, glide: 0.025, dur: 0.05, amp: 0.4, a: 0.001 });
        noiseHit(k, { dur: 0.007, amp: 0.1, filter: { type: 'highpass', f: 4000 }, seed: 2 });
      } else if (v === 1) {
        tone(k, { type: 'triangle', f: 1180, f2: 860, glide: 0.03, dur: 0.06, amp: 0.33, filter: { type: 'lowpass', f: 3200 } });
        click(k, 0, 2500, 0.1, 2);
      } else {
        tone(k, { f: 1320, dur: 0.04, amp: 0.3 });
        tone(k, { f: 1320 * 3.9, dur: 0.012, amp: 0.06 });
        click(k, 0, 3400, 0.08, 1.2, 0.006);
      }
    },
  }),
  ev({
    id: 'ui_open', bus: 'ui', category: 'ui', description: 'Panel/dialog opens: rising bloop with an airy lift.',
    gain: 0.5, variations: 2, duration: 0.24, maxVoices: 2, minInterval: 0.08,
    recipe: (k, v) => {
      if (v === 0) {
        tone(k, { f: 520, f2: 1040, glide: 0.09, dur: 0.14, amp: 0.28, a: 0.004 });
        tone(k, { t: 0.02, f: 780, f2: 1560, glide: 0.08, dur: 0.1, amp: 0.08 });
      } else {
        kalimba(k, k.out, 0, N.C5, 0.1, 0.6);
        kalimba(k, k.out, 0.055, N.F5, 0.1, 0.75);
      }
      noiseHit(k, { dur: 0.2, amp: 0.06, color: 'pink', shape: 'swell', filter: { type: 'bandpass', f: 900, f2: 3200, q: 1.2 } });
    },
  }),
  ev({
    id: 'ui_close', bus: 'ui', category: 'ui', description: 'Panel closes: falling bloop with an airy drop (mirror of ui_open).',
    gain: 0.45, variations: 2, duration: 0.24, maxVoices: 2, minInterval: 0.08,
    recipe: (k, v) => {
      if (v === 0) {
        tone(k, { f: 1040, f2: 520, glide: 0.09, dur: 0.14, amp: 0.26, a: 0.004 });
        tone(k, { t: 0.015, f: 1560, f2: 780, glide: 0.08, dur: 0.09, amp: 0.06 });
      } else {
        kalimba(k, k.out, 0, N.F5, 0.1, 0.65);
        kalimba(k, k.out, 0.055, N.C5, 0.1, 0.55);
      }
      noiseHit(k, { dur: 0.18, amp: 0.05, color: 'pink', shape: 'swell', filter: { type: 'bandpass', f: 3000, f2: 900, q: 1.2 } });
    },
  }),
  ev({
    id: 'ui_toggle', bus: 'ui', category: 'ui', description: 'Switch toggled: two-stage mechanical click with a tiny pitch cue.',
    gain: 0.5, variations: 2, duration: 0.07, maxVoices: 2, minInterval: 0.04,
    variationNotes: '0 = switched on (brighter, rising), 1 = switched off (darker).',
    recipe: (k, v) => {
      const on = v === 0;
      click(k, 0, on ? 3200 : 2400, 0.22, 2, 0.006);
      click(k, on ? 0.018 : 0.022, on ? 4200 : 1900, 0.16, 2.2, 0.006);
      tone(k, { t: 0.012, f: on ? hz(N.A6) : hz(N.D6), dur: 0.035, amp: 0.1 });
    },
  }),
  ev({
    id: 'ui_error', bus: 'ui', category: 'ui', description: 'Action not possible: soft muted two-note "nuh-uh" (never a buzzer).',
    gain: 0.5, variations: 2, duration: 0.3, maxVoices: 1, minInterval: 0.25,
    recipe: (k, v) => {
      if (v === 0) {
        const lp = k.filter('lowpass', 1600, 0.6);
        lp.connect(k.out);
        marimba(k, lp, 0, N.G4, 0.1, 0.8);
        marimba(k, lp, 0.11, N.E4, 0.12, 0.7);
      } else {
        tone(k, { type: 'triangle', f: 233, f2: 215, glide: 0.18, dur: 0.22, amp: 0.32, a: 0.006, filter: { type: 'lowpass', f: 900 }, vib: { rate: 14, depth: 25 } });
        tone(k, { f: 420, dur: 0.05, amp: 0.12 });
      }
    },
  }),
  ev({
    id: 'ui_confirm', bus: 'ui', category: 'ui', description: 'Positive confirmation: bright rising chime resolving to F.',
    gain: 0.5, variations: 3, duration: 0.6, maxVoices: 2, minInterval: 0.08,
    recipe: (k, v) => {
      if (v === 0) {
        kalimba(k, k.out, 0, N.C6, 0.1, 0.7);
        kalimba(k, k.out, 0.07, N.F6, 0.2, 0.85);
      } else if (v === 1) {
        glock(k, k.out, 0, N.A5, 0.1, 0.45);
        glock(k, k.out, 0.05, N.C6, 0.1, 0.5);
        glock(k, k.out, 0.1, N.F6, 0.2, 0.6);
      } else {
        bell(k, k.out, 0, N.F6, 0.45, 0.7);
        celesta(k, k.out, 0.01, N.C6, 0.2, 0.5);
      }
    },
  }),
  ev({
    id: 'ui_purchase', bus: 'ui', category: 'ui', description: 'Bought something: coin pings over a warm F-major chime.',
    gain: 0.55, variations: 2, duration: 0.6, maxVoices: 2, minInterval: 0.1,
    recipe: (k, v) => {
      if (v === 0) {
        coin(k, 0, 2650, 0.2);
        coin(k, 0.07, 3150, 0.15, 0.04);
        for (const [i, n] of [N.F5, N.A5, N.C6].entries()) kalimba(k, k.out, 0.02 + i * 0.012, n, 0.2, 0.45);
      } else {
        noiseHit(k, { dur: 0.05, amp: 0.25, color: 'pink', filter: { type: 'lowpass', f: 1300 } });
        thud(k, 0, 150, 95, 0.09, 0.3);
        for (let i = 0; i < 3; i++) coin(k, 0.06 + i * 0.06, [2349, 2793, 3136][i], 0.14 - i * 0.02, i * 0.03);
      }
    },
  }),
  ev({
    id: 'ui_tab', bus: 'ui', category: 'ui', description: 'Tab switch: short blip with a light tick.',
    gain: 0.42, variations: 3, duration: 0.12, maxVoices: 2, minInterval: 0.04,
    recipe: (k, v) => {
      if (v === 0) tone(k, { f: 1400, f2: 1620, glide: 0.03, dur: 0.06, amp: 0.25 });
      else if (v === 1) celesta(k, k.out, 0, N.D6, 0.05, 0.6);
      else pluck(k, k.out, 0, N.F5, 0.05, 0.7);
      click(k, 0, 3800, 0.08, 1.5, 0.005);
    },
  }),
  ev({
    id: 'ui_slider', bus: 'ui', category: 'ui', description: 'Slider/scroll detent tick (very short).',
    gain: 0.3, variations: 3, duration: 0.03, maxVoices: 2, minInterval: 0.035, pitchJitter: 0.04,
    recipe: (k, v) => {
      const f = [5000, 3200, 4200][v];
      click(k, 0, f, 0.3, v === 0 ? 0.8 : 3, 0.006);
      tone(k, { f: [2400, 1900, 2800][v], dur: 0.009, amp: 0.08 });
    },
  }),
  ev({
    id: 'ui_swipe', bus: 'ui', category: 'ui', description: 'Panel slide/swipe: soft air whoosh.',
    gain: 0.35, variations: 2, duration: 0.26, maxVoices: 2, minInterval: 0.08,
    recipe: (k, v) => {
      noiseHit(k, { dur: 0.24, amp: 0.3, color: 'pink', shape: 'swell', filter: { type: 'bandpass', f: v ? 2600 : 500, f2: v ? 600 : 2600, q: 0.9 } });
      noiseHit(k, { dur: 0.2, amp: 0.05, shape: 'swell', filter: { type: 'highpass', f: 5000 }, seed: 5 });
    },
  }),

  // ============================================================== Economy / progression
  ev({
    id: 'sale_coin', bus: 'sfx', category: 'economy', description: 'A product sold: single bright coin ting (frequent; kept small).',
    gain: 0.4, variations: 4, duration: 0.4, maxVoices: 4, minInterval: 0.06, pitchJitter: 0.025,
    recipe: (k, v) => {
      const f = [2093, 2349, 2637, 2794][v];
      coin(k, 0, f, 0.22, v * 0.015);
      if (v === 1 || v === 3) coin(k, 0.045 + v * 0.006, f * 1.12, 0.09, 0.05);
      if (v === 2) tone(k, { f: f / 2, dur: 0.3, amp: 0.05 });
    },
  }),
  ev({
    id: 'sale_big', bus: 'sfx', category: 'economy', description: 'Large sale or payout: cascade of coins with a warm chord.',
    gain: 0.5, variations: 2, duration: 1.0, maxVoices: 2, minInterval: 0.3,
    recipe: (k, v) => {
      const n = v ? 7 : 10;
      let t = 0;
      for (let i = 0; i < n; i++) {
        coin(k, t, k.rng.pick([2093, 2349, 2637, 2794, 3136]), 0.16 * (1 - i / (n * 1.6)), k.rng.range(0, 0.06));
        t += 0.09 * Math.pow(0.86, i) + 0.02;
      }
      for (const [i, m] of [N.F5, N.A5, N.C6].entries()) kalimba(k, k.out, 0.05 + i * 0.02, m, 0.3, 0.5);
      if (v) ring(k, { t: 0.02, f: 1760, amp: 0.1, partials: [[1, 1, 0.8], [2.0, 0.4, 0.4], [2.92, 0.25, 0.25]] });
    },
  }),
  ev({
    id: 'order_complete', bus: 'sfx', category: 'economy', description: 'Order fulfilled: quick rising F-major marimba figure + coin.',
    gain: 0.55, variations: 2, duration: 0.9, maxVoices: 2, minInterval: 0.2, priority: 1,
    recipe: (k, v) => {
      if (v === 0) {
        marimba(k, k.out, 0, N.C5, 0.1, 0.75);
        marimba(k, k.out, 0.08, N.F5, 0.1, 0.8);
        marimba(k, k.out, 0.16, N.A5, 0.2, 0.9);
        glock(k, k.out, 0.16, N.C6, 0.2, 0.35);
        coin(k, 0.2, 2794, 0.08);
      } else {
        for (const [i, m] of [N.C5, N.F5, N.A5, N.C6].entries()) pluck(k, k.out, i * 0.055, m, 0.2, 0.7);
        glock(k, k.out, 0.22, N.F6, 0.3, 0.45);
      }
    },
  }),
  ev({
    id: 'unlock', bus: 'sfx', category: 'economy', description: 'Something new unlocked: glockenspiel arpeggio over a soft F pad, sparkle.',
    gain: 0.6, variations: 2, duration: 1.6, maxVoices: 1, minInterval: 0.5, duck: { amount: 0.35, seconds: 1.4 },
    recipe: (k, v) => {
      const notes = v ? [N.C6, N.F6, N.A6] : [N.F5, N.A5, N.C6, N.F6];
      const inst = v ? celesta : glock;
      notes.forEach((m, i) => inst(k, k.out, i * 0.07, m, 0.3, 0.55 + i * 0.08));
      if (v) bell(k, k.out, 0.25, N.C7, 0.9, 0.4);
      for (const m of [N.F4, N.A4, N.C5]) pad(k, k.out, 0, m, 0.6, 0.6, { attack: 0.12, release: 0.8 });
      sparkle(k, 0.15, 0.9, 0.04);
    },
  }),
  ev({
    id: 'level_up', bus: 'sfx', category: 'economy', description: 'Level up: sweeping F-major arpeggio landing on a bell chord, soft cymbal.',
    gain: 0.62, variations: 2, duration: 2.0, maxVoices: 1, minInterval: 1, duck: { amount: 0.45, seconds: 2.2 },
    recipe: (k, v) => {
      const arp = [N.F4, N.A4, N.C5, N.F5, N.A5, N.C6];
      arp.forEach((m, i) => (v ? pluck : marimba)(k, k.out, i * 0.045, m, 0.2, 0.6 + i * 0.05));
      const t = 0.3;
      for (const m of [N.F5, N.A5, N.C6]) (v ? kalimba : glock)(k, k.out, t, m, 0.6, 0.55);
      if (v) bell(k, k.out, t, N.F6, 1.2, 0.5);
      else glock(k, k.out, t + 0.02, N.F6, 0.6, 0.5);
      for (const m of [N.F4, N.C5, N.A4]) pad(k, k.out, t - 0.05, m, 0.8, 0.7, { attack: 0.08, release: 0.9 });
      crash(k, k.out, t, 0.35, 0);
      sparkle(k, t, 1.1, 0.035);
    },
  }),
  ev({
    id: 'notify', bus: 'ui', category: 'economy', description: 'Gentle notification: two-note kalimba "ding-dong" (falling) or a rising celesta F-A-C.',
    gain: 0.5, variations: 3, duration: 0.9, maxVoices: 1, minInterval: 0.4,
    recipe: (k, v) => {
      const pairs = [
        [N.A5, N.F5],
        [N.C6, N.A5],
        [N.F5, N.C6],
      ][v];
      if (v === 2) {
        celesta(k, k.out, 0, N.F5, 0.1, 0.6);
        celesta(k, k.out, 0.08, N.A5, 0.1, 0.6);
        celesta(k, k.out, 0.16, N.C6, 0.4, 0.7);
        musicbox(k, k.out, 0.17, N.C7, 0.2, 0.25);
      } else {
        kalimba(k, k.out, 0, pairs[0], 0.15, 0.7);
        kalimba(k, k.out, 0.13, pairs[1], 0.4, 0.65);
      }
    },
  }),
  ev({
    id: 'tutorial_step', bus: 'ui', category: 'economy', description: 'Tutorial advanced: one soft celesta note with a music-box sparkle.',
    gain: 0.45, variations: 2, duration: 1.0, maxVoices: 1, minInterval: 0.3,
    recipe: (k, v) => {
      if (v === 0) {
        celesta(k, k.out, 0, N.C6, 0.4, 0.65);
        musicbox(k, k.out, 0.035, N.C7, 0.2, 0.35);
      } else {
        celesta(k, k.out, 0, N.F5, 0.1, 0.5);
        celesta(k, k.out, 0.06, N.A5, 0.4, 0.65);
        musicbox(k, k.out, 0.09, N.F7 - 12, 0.2, 0.3);
      }
    },
  }),
  ev({
    id: 'milestone', bus: 'sfx', category: 'economy', description: 'Milestone reached: the head of the main theme motif (C-F-A-G-F-G) resolving to an F chord.',
    gain: 0.62, variations: 2, duration: 2.2, maxVoices: 1, minInterval: 1.5, duck: { amount: 0.55, seconds: 2.6 },
    recipe: (k, v) => {
      const motif: Array<[number, number]> = [
        [0, N.C5], [0.1, N.F5], [0.2, N.A5], [0.3, N.G5], [0.35, N.F5], [0.4, N.G5],
      ];
      const lead = v ? celesta : glock;
      for (const [t, m] of motif) {
        lead(k, k.out, t, m + (v ? 12 : 0), 0.12, 0.65);
        (v ? pluck : marimba)(k, k.out, t, m - (v ? 0 : 12), 0.1, 0.5);
      }
      const t = 0.62;
      for (const m of [N.F5, N.A5, N.C6]) (v ? bell : glock)(k, k.out, t, m, 1.1, 0.55);
      for (const m of [N.F3 + 12, N.C5, N.A4]) pad(k, k.out, t - 0.04, m, 0.9, 0.7, { attack: 0.06, release: 0.9 });
      crash(k, k.out, t - 0.55, 0.45, 1);
      sparkle(k, t, 1.2, 0.035);
    },
  }),
  ev({
    id: 'combo_tick', bus: 'sfx', category: 'economy', description: 'Sales combo/chain step: pentatonic step that climbs with each variation.',
    gain: 0.4, variations: 4, duration: 0.6, maxVoices: 2, minInterval: 0.07, pitchJitter: 0,
    variationNotes: 'Pass variation = step % 4 (0..3) for a rising chain; higher steps add sparkle layers.',
    recipe: (k, v) => {
      const m = [N.C6, N.D6, N.F6, N.G6][v];
      musicbox(k, k.out, 0, m, 0.2, 0.7);
      glock(k, k.out, 0, m - 12, 0.2, 0.25 + v * 0.06);
      if (v >= 2) sparkle(k, 0.01, 0.3, 0.02 + v * 0.008, k.out, 30 + v * 10);
      if (v === 3) musicbox(k, k.out, 0.03, m + 7, 0.2, 0.45);
    },
  }),
  ev({
    id: 'research_done', bus: 'sfx', category: 'economy', description: 'Research/tech complete: FM-bell arpeggio with digital blips (hightech colour).',
    gain: 0.55, variations: 2, duration: 1.5, maxVoices: 1, minInterval: 0.8, duck: { amount: 0.35, seconds: 1.5 },
    recipe: (k, v) => {
      if (v === 0) {
        [N.F5, N.C6, N.F6, N.A6].forEach((m, i) => bell(k, k.out, i * 0.06, m, 0.9, 0.55, { bright: 0.5 }));
        for (let i = 0; i < 5; i++) tone(k, { t: 0.02 + i * 0.045, type: 'softsquare', f: k.rng.pick([1760, 2093, 2349, 2794]), dur: 0.025, amp: 0.05, filter: { type: 'lowpass', f: 5000 } });
      } else {
        tone(k, { f: 800, f2: 2400, glide: 0.35, dur: 0.4, amp: 0.07, a: 0.05, type: 'triangle' });
        for (const m of [N.F6, N.A6, N.C7]) glock(k, k.out, 0.33, m, 0.6, 0.5);
        sparkle(k, 0.33, 0.9, 0.035);
      }
    },
  }),
  ev({
    id: 'contract_accept', bus: 'sfx', category: 'economy', description: 'Contract/quest accepted: paper stamp (or pen scribble) and a small chime.',
    gain: 0.55, variations: 2, duration: 0.8, maxVoices: 1, minInterval: 0.3,
    recipe: (k, v) => {
      if (v === 0) {
        thud(k, 0, 170, 90, 0.1, 0.45);
        noiseHit(k, { dur: 0.08, amp: 0.18, color: 'pink', filter: { type: 'bandpass', f: 2000, q: 0.8 } });
        kalimba(k, k.out, 0.1, N.C6, 0.2, 0.55);
        kalimba(k, k.out, 0.16, N.F6, 0.3, 0.6);
      } else {
        grains(k, { dur: 0.3, density: 120, amp: 0.12, bandRange: [3000, 5000], bandQ: 3, grainDur: 0.01, shape: 'swell' });
        kalimba(k, k.out, 0.32, N.F5, 0.2, 0.55);
        kalimba(k, k.out, 0.39, N.A5, 0.3, 0.6);
      }
    },
  }),
  ev({
    id: 'star_earned', bus: 'sfx', category: 'economy', description: 'Rating star earned: high glockenspiel twinkle with sparkle.',
    gain: 0.5, variations: 3, duration: 1.0, maxVoices: 3, minInterval: 0.12,
    variationNotes: 'Use 0,1,2 for the 1st/2nd/3rd star of a rating.',
    recipe: (k, v) => {
      const m = [N.C7 - 12, N.E6, N.F6][v] + 12;
      (v === 2 ? celesta : glock)(k, k.out, 0, m, 0.4, 0.6);
      if (v >= 1) musicbox(k, k.out, 0.04, m + (v === 1 ? 7 : 12), 0.2, 0.35);
      tone(k, { f: 1200 + v * 200, f2: 2400 + v * 300, glide: 0.08, dur: 0.1, amp: 0.04, a: 0.01 });
      sparkle(k, 0, 0.5, 0.035 + v * 0.005);
    },
  }),
  ev({
    id: 'confetti_pop', bus: 'sfx', category: 'economy', description: 'Celebration confetti: party-popper pop and paper rustle.',
    gain: 0.5, variations: 2, duration: 0.9, maxVoices: 2, minInterval: 0.2,
    recipe: (k, v) => {
      noiseHit(k, { dur: 0.02, amp: 0.45, filter: { type: 'lowpass', f: 2500 } });
      thud(k, 0, 320, 120, 0.06, 0.3);
      grains(k, { t: 0.02, dur: 0.75, density: 95, densityEnd: 15, amp: 0.12, bandRange: [2000, 6500], bandQ: 2, grainDur: 0.008, shape: 'decay', panJitter: 0.6 });
      if (v) kalimba(k, k.out, 0.05, N.F6, 0.3, 0.5);
    },
  }),

  // ============================================================== Building
  ev({
    id: 'build_place', bus: 'sfx', category: 'build', description: 'Building/machine placed: satisfying thunk plus snap (wood, plastic or metal body).',
    gain: 0.65, variations: 3, duration: 0.35, maxVoices: 3, minInterval: 0.06, priority: 1,
    recipe: (k, v) => {
      const room = roomSend(k, 0.14, k.out, 0.4);
      if (v === 0) {
        thud(k, 0, 170, 95, 0.14, 0.5, room);
        noiseHit(k, { dur: 0.05, amp: 0.3, color: 'pink', filter: { type: 'lowpass', f: 900 }, dest: room });
        click(k, 0.018, 3000, 0.2, 1.5, 0.012, room);
      } else if (v === 1) {
        thud(k, 0, 240, 140, 0.1, 0.42, room);
        click(k, 0, 4000, 0.2, 2, 0.008, room);
        click(k, 0.025, 3600, 0.16, 2, 0.008, room);
        tone(k, { t: 0.025, f: 1800, dur: 0.02, amp: 0.06, dest: room });
      } else {
        thud(k, 0, 150, 90, 0.14, 0.45, room);
        ring(k, { f: 620, amp: 0.1, dest: room, partials: [[1, 0.5, 0.25], [2.38, 0.3, 0.18], [4.1, 0.15, 0.08]] });
        click(k, 0.012, 2600, 0.18, 1.5, 0.01, room);
      }
    },
  }),
  ev({
    id: 'build_belt', bus: 'sfx', category: 'build', description: 'Conveyor segment laid: metallic click-clack with a short roller spin.',
    gain: 0.5, variations: 3, duration: 0.3, maxVoices: 3, minInterval: 0.04, pitchJitter: 0.04,
    recipe: (k, v) => {
      if (v === 0) {
        click(k, 0, 2500, 0.25, 2);
        click(k, 0.045, 1800, 0.2, 2);
        ring(k, { f: 880, amp: 0.05, partials: [[1, 1, 0.08], [2.7, 0.5, 0.05]] });
        grains(k, { t: 0.05, dur: 0.2, density: 60, amp: 0.1, bandRange: [1500, 2500], shape: 'decay', periodic: true });
      } else if (v === 1) {
        [0, 0.03, 0.07].forEach((t, i) => click(k, t, [2200, 2900, 2000][i], 0.2 - i * 0.03, 2.5));
        thud(k, 0, 200, 120, 0.08, 0.25);
      } else {
        thud(k, 0, 180, 110, 0.07, 0.3);
        click(k, 0.005, 3200, 0.2, 1.8);
        grains(k, { t: 0.04, dur: 0.12, density: 90, amp: 0.12, bandRange: [2500, 3500], bandQ: 3, shape: 'flat', periodic: true });
      }
    },
  }),
  ev({
    id: 'build_remove', bus: 'sfx', category: 'build', description: 'Demolish/remove: friendly descending pop with a dust puff.',
    gain: 0.55, variations: 2, duration: 0.45, maxVoices: 2, minInterval: 0.08,
    recipe: (k, v) => {
      if (v === 0) {
        tone(k, { f: 620, f2: 180, glide: 0.16, dur: 0.18, amp: 0.33 });
        noiseHit(k, { t: 0.03, dur: 0.35, a: 0.03, amp: 0.22, color: 'pink', filter: { type: 'lowpass', f: 1400, f2: 500 } });
      } else {
        noiseHit(k, { dur: 0.05, amp: 0.25, filter: { type: 'bandpass', f: 1200, q: 1 } });
        tone(k, { f: 480, f2: 160, glide: 0.14, dur: 0.16, amp: 0.3 });
        grains(k, { t: 0.04, dur: 0.35, density: 200, densityEnd: 20, amp: 0.09, bandRange: [1000, 3000], shape: 'decay' });
      }
    },
  }),
  ev({
    id: 'build_rotate', bus: 'sfx', category: 'build', description: 'Rotate piece: quick ratchet clicks with a small swish.',
    gain: 0.45, variations: 3, duration: 0.2, maxVoices: 2, minInterval: 0.05,
    recipe: (k, v) => {
      if (v === 0) {
        [0, 0.04, 0.08].forEach((t, i) => click(k, t, 2000 + i * 400, 0.2, 2.5, 0.008));
        noiseHit(k, { dur: 0.14, amp: 0.06, color: 'pink', shape: 'swell', filter: { type: 'bandpass', f: 1200, f2: 2400, q: 1 } });
      } else if (v === 1) {
        click(k, 0, 2300, 0.2, 2.5, 0.008);
        click(k, 0.05, 2700, 0.18, 2.5, 0.008);
        tone(k, { f: 900, f2: 1200, glide: 0.08, dur: 0.1, amp: 0.08 });
      } else {
        for (let i = 0; i < 4; i++) click(k, i * 0.025, 2600 + i * 250, 0.16, 3, 0.006);
        marimba(k, k.out, 0.1, N.C6, 0.05, 0.3);
      }
    },
  }),
  ev({
    id: 'build_invalid', bus: 'sfx', category: 'build', description: 'Cannot place here: dull, gentle low "dud" (lower and shorter than ui_error).',
    gain: 0.5, variations: 2, duration: 0.25, maxVoices: 1, minInterval: 0.2,
    recipe: (k, v) => {
      if (v === 0) {
        tone(k, { type: 'triangle', f: 185, dur: 0.2, amp: 0.3, a: 0.005, filter: { type: 'lowpass', f: 700 }, vib: { rate: 18, depth: 40 } });
        tone(k, { f: 330, dur: 0.05, amp: 0.12 });
      } else {
        for (const t of [0, 0.09]) {
          thud(k, t, 200, 150, 0.08, 0.3);
          noiseHit(k, { t, dur: 0.04, amp: 0.12, color: 'pink', filter: { type: 'lowpass', f: 800 } });
        }
      }
    },
  }),
  ev({
    id: 'construct_complete', bus: 'sfx', category: 'build', description: 'Construction finished: two hammer taps then a rising marimba F chord.',
    gain: 0.6, variations: 2, duration: 1.0, maxVoices: 2, minInterval: 0.3,
    recipe: (k, v) => {
      if (v === 0) {
        for (const t of [0, 0.1]) {
          ring(k, { t, f: 1450, amp: 0.1, partials: [[1, 0.6, 0.1], [2.6, 0.3, 0.05]] });
          click(k, t, 2800, 0.15);
        }
        [N.C5, N.F5, N.A5].forEach((m, i) => marimba(k, k.out, 0.22 + i * 0.04, m, 0.2, 0.75));
        noiseHit(k, { t: 0.18, dur: 0.25, amp: 0.05, color: 'pink', shape: 'swell', filter: { type: 'bandpass', f: 800, f2: 3000 } });
      } else {
        for (let i = 0; i < 4; i++) click(k, i * 0.03, 2400 + i * 200, 0.15, 3, 0.006);
        [N.F5, N.A5, N.C6, N.F6].forEach((m, i) => kalimba(k, k.out, 0.16 + i * 0.05, m, 0.2, 0.6 + i * 0.07));
        sparkle(k, 0.3, 0.5, 0.03);
      }
    },
  }),
  ev({
    id: 'upgrade_complete', bus: 'sfx', category: 'build', description: 'Upgrade done: soft power-up sweep landing on a glockenspiel F/C.',
    gain: 0.6, variations: 2, duration: 1.0, maxVoices: 2, minInterval: 0.3,
    recipe: (k, v) => {
      if (v === 0) {
        tone(k, { type: 'softsaw', f: 220, f2: 880, glide: 0.4, dur: 0.45, amp: 0.1, a: 0.03, filter: { type: 'lowpass', f: 400, f2: 4000, sweep: 0.4 } });
        glock(k, k.out, 0.4, N.F6, 0.3, 0.6);
        glock(k, k.out, 0.47, N.C7, 0.3, 0.5);
        sparkle(k, 0.42, 0.5, 0.03);
      } else {
        [N.F4, N.A4, N.C5, N.F5, N.A5].forEach((m, i) => pluck(k, k.out, i * 0.035, m, 0.2, 0.65));
        bell(k, k.out, 0.2, N.F6, 0.8, 0.55);
      }
    },
  }),
  ev({
    id: 'build_road', bus: 'sfx', category: 'build', description: 'Road/path tile laid: gravel crunch with a low tamp.',
    gain: 0.5, variations: 2, duration: 0.5, maxVoices: 2, minInterval: 0.06,
    recipe: (k, v) => {
      if (v === 0) {
        grains(k, { dur: 0.45, density: 260, densityEnd: 60, amp: 0.22, color: 'pink', bandRange: [600, 2500], bandQ: 1.5, grainDur: 0.004, shape: 'decay' });
        thud(k, 0, 120, 70, 0.12, 0.3);
      } else {
        thud(k, 0, 95, 60, 0.12, 0.38);
        thud(k, 0.16, 95, 60, 0.12, 0.3);
        grains(k, { dur: 0.25, density: 220, amp: 0.15, color: 'pink', bandRange: [700, 2200], grainDur: 0.004, shape: 'decay' });
      }
    },
  }),

  // ============================================================== Machines (positional)
  ev({
    id: 'bench_work', bus: 'sfx', category: 'machine', description: 'Workbench activity: hammer tap / screwdriver ratchet / sanding / wrench clank.',
    gain: 0.5, variations: 4, duration: 0.4, maxVoices: 3, minInterval: 0.12, pitchJitter: 0.04,
    recipe: (k, v) => {
      if (v === 0) {
        thud(k, 0, 210, 120, 0.08, 0.4);
        ring(k, { f: 980, amp: 0.13, partials: [[1, 0.5, 0.12], [2.6, 0.3, 0.06]] });
        click(k, 0, 3000, 0.15);
      } else if (v === 1) {
        for (let i = 0; i < 5; i++) {
          click(k, i * 0.035, 3500, 0.2 * (1 - i * 0.08), 3, 0.004);
          tone(k, { t: i * 0.035, f: 1400, dur: 0.008, amp: 0.04 });
        }
      } else if (v === 2) {
        noiseHit(k, { dur: 0.32, amp: 0.28, color: 'pink', shape: 'swell', filter: { type: 'bandpass', f: 1800, q: 0.8 } });
        grains(k, { dur: 0.3, density: 150, amp: 0.06, bandRange: [3000, 6000], shape: 'swell' });
      } else {
        ring(k, { f: 1240, amp: 0.17, partials: [[1, 0.6, 0.18], [2.71, 0.4, 0.12], [4.9, 0.2, 0.05]] });
        ring(k, { t: 0.07, f: 1600, amp: 0.07, partials: [[1, 0.6, 0.1], [2.4, 0.3, 0.06]] });
        thud(k, 0, 180, 120, 0.05, 0.2);
      }
    },
  }),
  ev({
    id: 'packer_work', bus: 'sfx', category: 'machine', description: 'Packing station: cardboard fold thump / tape rip / pneumatic press.',
    gain: 0.5, variations: 3, duration: 0.45, maxVoices: 3, minInterval: 0.15, pitchJitter: 0.03,
    recipe: (k, v) => {
      if (v === 0) {
        thud(k, 0, 140, 90, 0.09, 0.35);
        noiseHit(k, { dur: 0.08, amp: 0.3, color: 'pink', filter: { type: 'lowpass', f: 700 } });
        noiseHit(k, { dur: 0.04, amp: 0.1, filter: { type: 'bandpass', f: 2000 } });
      } else if (v === 1) {
        grains(k, { dur: 0.35, density: 380, amp: 0.13, bandRange: [2500, 5500], grainDur: 0.003, shape: 'flat' });
        noiseHit(k, { dur: 0.35, amp: 0.05, hold: 0.3, filter: { type: 'highpass', f: 3000 } });
        tone(k, { t: 0.33, f: 2200, f2: 1800, dur: 0.04, amp: 0.03 });
      } else {
        noiseHit(k, { dur: 0.12, amp: 0.16, filter: { type: 'highpass', f: 3000 } });
        thud(k, 0.1, 180, 110, 0.08, 0.35);
        click(k, 0.1, 2200, 0.15);
      }
    },
  }),
  ev({
    id: 'paint_spray', bus: 'sfx', category: 'machine', description: 'Paint spray burst: aerosol hiss (plain / with can rattle / long airbrush).',
    gain: 0.4, variations: 3, duration: 0.8, maxVoices: 2, minInterval: 0.25,
    recipe: (k, v) => {
      if (v === 0) {
        noiseHit(k, { dur: 0.5, a: 0.03, hold: 0.4, amp: 0.3, filter: { type: 'highpass', f: 2500 }, filter2: { type: 'bandpass', f: 6000, q: 0.7 } });
      } else if (v === 1) {
        for (const t of [0, 0.09]) {
          tone(k, { t, f: 2600, dur: 0.015, amp: 0.15 });
          click(k, t, 4000, 0.15, 2, 0.01);
        }
        noiseHit(k, { t: 0.2, dur: 0.35, a: 0.02, hold: 0.28, amp: 0.3, filter: { type: 'highpass', f: 3000 }, filter2: { type: 'bandpass', f: 5500, q: 0.8 }, seed: 4 });
      } else {
        noiseHit(k, { dur: 0.7, a: 0.05, hold: 0.55, amp: 0.25, filter: { type: 'highpass', f: 4000 }, filter2: { type: 'bandpass', f: 5000, f2: 7000, q: 0.6 }, seed: 6 });
      }
    },
  }),
  ev({
    id: 'arm_servo', bus: 'sfx', category: 'machine', description: 'Robot arm move: filtered servo whine with gear ticks.',
    gain: 0.4, variations: 3, duration: 0.42, maxVoices: 3, minInterval: 0.15, pitchJitter: 0.04,
    recipe: (k, v) => {
      const seg = (t: number, f0: number, f1: number, d: number): void => {
        tone(k, { t, type: 'softsquare', f: f0, f2: f1, glide: d, dur: d + 0.03, hold: d, a: 0.02, amp: 0.1, filter: { type: 'bandpass', f: 1200, q: 1.2 } });
        grains(k, { t, dur: d, density: 90, amp: 0.035, bandRange: [2000, 3000], bandQ: 3, shape: 'flat', periodic: true });
      };
      if (v === 0) {
        seg(0, 380, 620, 0.25);
        click(k, 0.28, 2500, 0.12);
      } else if (v === 1) {
        // heavier joint: lower triangle whine, denser gear ticks, settles with a soft clunk
        click(k, 0, 2200, 0.1);
        tone(k, { t: 0.01, type: 'triangle', f: 300, f2: 210, glide: 0.24, dur: 0.27, hold: 0.24, a: 0.02, amp: 0.16, filter: { type: 'bandpass', f: 700, q: 1 } });
        grains(k, { t: 0.01, dur: 0.24, density: 140, amp: 0.05, bandRange: [1200, 2200], bandQ: 3, shape: 'decay', periodic: true });
        thud(k, 0.27, 160, 110, 0.06, 0.12);
      } else {
        seg(0, 400, 560, 0.14);
        seg(0.2, 560, 700, 0.12);
        click(k, 0.34, 2600, 0.1);
      }
    },
  }),
  ev({
    id: 'machine_start', bus: 'sfx', category: 'machine', description: 'Machine powers on: relay click and motor spin-up.',
    gain: 0.5, variations: 2, duration: 1.0, maxVoices: 2, minInterval: 0.3,
    recipe: (k, v) => {
      click(k, 0, 2000, 0.2, 1.5, 0.012);
      tone(k, { f: 900, dur: 0.02, amp: 0.06 });
      if (v === 0) {
        tone(k, { type: 'softsaw', f: 30, f2: 110, glide: 0.7, dur: 0.9, hold: 0.75, a: 0.1, amp: 0.14, filter: { type: 'lowpass', f: 600, f2: 1500, sweep: 0.7 } });
        tone(k, { f: 300, f2: 1200, glide: 0.7, dur: 0.9, hold: 0.75, a: 0.15, amp: 0.025 });
      } else {
        tone(k, { type: 'organ', f: 40, f2: 150, glide: 0.6, dur: 0.85, hold: 0.7, a: 0.08, amp: 0.15, filter: { type: 'lowpass', f: 900 } });
        thud(k, 0.02, 140, 90, 0.08, 0.2);
        noiseHit(k, { t: 0.6, dur: 0.3, amp: 0.08, filter: { type: 'highpass', f: 3000 } });
      }
    },
  }),
  ev({
    id: 'machine_stop', bus: 'sfx', category: 'machine', description: 'Machine powers off: spin-down and a soft relay/air release.',
    gain: 0.5, variations: 2, duration: 1.0, maxVoices: 2, minInterval: 0.3,
    recipe: (k, v) => {
      if (v === 0) {
        tone(k, { type: 'softsaw', f: 110, f2: 30, glide: 0.8, dur: 0.9, hold: 0.25, a: 0.01, amp: 0.14, filter: { type: 'lowpass', f: 1500, f2: 400, sweep: 0.8 } });
        tone(k, { f: 1200, f2: 300, glide: 0.6, dur: 0.7, hold: 0.15, a: 0.01, amp: 0.025 });
        click(k, 0.75, 1800, 0.15, 1.5, 0.012);
      } else {
        click(k, 0, 1900, 0.15, 1.5, 0.012);
        tone(k, { type: 'organ', f: 150, f2: 40, glide: 0.7, dur: 0.8, hold: 0.2, a: 0.01, amp: 0.15, filter: { type: 'lowpass', f: 900 } });
        noiseHit(k, { t: 0.05, dur: 0.45, a: 0.01, amp: 0.1, filter: { type: 'highpass', f: 2500 }, filter2: { type: 'lowpass', f: 7000 } });
      }
    },
  }),
  ev({
    id: 'craft_done', bus: 'sfx', category: 'machine', description: 'Item crafted: small pleasant ding over a soft mechanical clunk.',
    gain: 0.45, variations: 3, duration: 0.8, maxVoices: 3, minInterval: 0.15,
    recipe: (k, v) => {
      if (v === 0) {
        kalimba(k, k.out, 0.01, N.F6, 0.3, 0.6);
        thud(k, 0, 300, 180, 0.05, 0.15);
      } else if (v === 1) {
        glock(k, k.out, 0.01, N.C6, 0.3, 0.45);
        click(k, 0, 2400, 0.12);
      } else {
        marimba(k, k.out, 0, N.A5, 0.1, 0.6);
        marimba(k, k.out, 0.06, N.C6, 0.1, 0.65);
        thud(k, 0, 260, 160, 0.04, 0.12);
      }
    },
  }),
  ev({
    id: 'alert_blocked', bus: 'sfx', category: 'alert', description: 'Output blocked (belt full / no space): soft descending muted double knock — "stuck".',
    gain: 0.5, variations: 2, duration: 0.6, maxVoices: 2, minInterval: 0.8, spatial: true,
    recipe: (k, v) => {
      const lp = k.filter('lowpass', 1500, 0.6);
      lp.connect(k.out);
      if (v === 0) {
        marimba(k, lp, 0, N.Bb4, 0.1, 0.8);
        marimba(k, lp, 0.14, N.G4, 0.1, 0.7);
        click(k, 0.14, 900, 0.06, 1, 0.01, lp);
      } else {
        kalimba(k, lp, 0, N.A4, 0.1, 0.7);
        kalimba(k, lp, 0.15, N.F4, 0.2, 0.6);
        thud(k, 0.15, 150, 110, 0.07, 0.12, lp);
      }
    },
  }),
  ev({
    id: 'alert_starved', bus: 'sfx', category: 'alert', description: 'Input starved (no materials): hollow rising "hm?" — a gentle question.',
    gain: 0.5, variations: 2, duration: 0.55, maxVoices: 2, minInterval: 0.8,
    recipe: (k, v) => {
      if (v === 0) {
        tone(k, { f: hz(N.C5), f2: hz(N.D5), glide: 0.15, dur: 0.3, a: 0.03, amp: 0.22, filter: { type: 'lowpass', f: 1800 } });
        noiseHit(k, { dur: 0.25, a: 0.04, amp: 0.04, color: 'pink', shape: 'swell', filter: { type: 'bandpass', f: 1000, q: 1.5 } });
      } else {
        for (const [t, m] of [[0, N.E5], [0.13, N.G5]] as Array<[number, number]>) {
          tone(k, { t, f: hz(m), dur: 0.09, amp: 0.25, filter: { type: 'bandpass', f: hz(m) * 1.5, q: 1 } });
          tone(k, { t, f: hz(m) * 2.02, dur: 0.03, amp: 0.05 });
        }
      }
    },
  }),
  ev({
    id: 'dock_door_open', bus: 'sfx', category: 'machine', description: 'Loading-dock roller door rising: accelerating rattle, motor, end clunk.',
    gain: 0.5, variations: 2, duration: 1.45, maxVoices: 2, minInterval: 0.6,
    recipe: (k, v) => {
      const d = v ? 1.0 : 1.2;
      grains(k, { dur: d, density: v ? 30 : 22, densityEnd: v ? 34 : 27, amp: 0.22, bandRange: [1200, 3500], bandQ: 4, grainDur: 0.01, shape: 'swell', periodic: true });
      tone(k, { type: 'softsaw', f: 90, f2: 110, glide: d, dur: d, hold: d - 0.1, a: 0.1, amp: 0.06, filter: { type: 'lowpass', f: 500 } });
      thud(k, d + 0.03, 140, 90, 0.1, 0.3);
      click(k, d + 0.03, 2000, 0.12);
    },
  }),
  ev({
    id: 'dock_door_close', bus: 'sfx', category: 'machine', description: 'Roller door lowering: decelerating rattle and a heavy floor thud.',
    gain: 0.5, variations: 2, duration: 1.5, maxVoices: 2, minInterval: 0.6,
    recipe: (k, v) => {
      const d = v ? 0.95 : 1.15;
      grains(k, { dur: d, density: v ? 32 : 26, densityEnd: v ? 24 : 20, amp: 0.2, bandRange: [1000, 3000], bandQ: 4, grainDur: 0.01, shape: 'swell', periodic: true });
      tone(k, { type: 'softsaw', f: 110, f2: 90, glide: d, dur: d, hold: d - 0.1, a: 0.1, amp: 0.05, filter: { type: 'lowpass', f: 450 } });
      thud(k, d, 110, 55, 0.25, 0.45);
      noiseHit(k, { t: d, dur: 0.12, amp: 0.25, color: 'pink', filter: { type: 'lowpass', f: 500 } });
    },
  }),
  ev({
    id: 'item_drop', bus: 'sfx', category: 'machine', description: 'Small item lands: cardboard tap / wooden clack / metal ting / plastic bounce.',
    gain: 0.4, variations: 4, duration: 0.3, maxVoices: 4, minInterval: 0.05, pitchJitter: 0.05,
    recipe: (k, v) => {
      if (v === 0) {
        thud(k, 0, 180, 120, 0.06, 0.32);
        noiseHit(k, { dur: 0.05, amp: 0.15, color: 'pink', filter: { type: 'lowpass', f: 1200 } });
      } else if (v === 1) {
        tone(k, { f: 900, f2: 700, dur: 0.04, amp: 0.25 });
        click(k, 0, 2000, 0.15);
        tone(k, { f: 2400, dur: 0.015, amp: 0.05 });
      } else if (v === 2) {
        ring(k, { f: 1850, amp: 0.1, partials: [[1, 1, 0.12], [2.3, 0.5, 0.07], [3.7, 0.25, 0.04]] });
        thud(k, 0, 220, 140, 0.04, 0.15);
      } else {
        [0, 0.085, 0.14].forEach((t, i) => tone(k, { t, f: 700 - i * 40, f2: 500, dur: 0.03, amp: 0.25 * (1 - i * 0.3) }));
      }
    },
  }),
  ev({
    id: 'item_pickup', bus: 'sfx', category: 'machine', description: 'Item picked up: soft lift bloop / cloth swish / small rattle.',
    gain: 0.4, variations: 3, duration: 0.2, maxVoices: 3, minInterval: 0.05, pitchJitter: 0.04,
    recipe: (k, v) => {
      if (v === 0) {
        tone(k, { f: 420, f2: 700, glide: 0.07, dur: 0.08, amp: 0.25 });
        noiseHit(k, { dur: 0.06, amp: 0.06, filter: { type: 'bandpass', f: 2500 } });
      } else if (v === 1) {
        noiseHit(k, { dur: 0.12, amp: 0.2, color: 'pink', shape: 'swell', filter: { type: 'bandpass', f: 1000, f2: 2500, q: 0.9 } });
        tone(k, { t: 0.04, f: 600, f2: 800, dur: 0.05, amp: 0.08 });
      } else {
        grains(k, { dur: 0.1, density: 120, amp: 0.12, bandRange: [2000, 4000], bandQ: 3, shape: 'decay' });
        tone(k, { f: 500, f2: 760, glide: 0.06, dur: 0.07, amp: 0.15 });
      }
    },
  }),
  ev({
    id: 'press_stamp', bus: 'sfx', category: 'machine', description: 'Hydraulic press (industrial): hiss, heavy thud, metal clank.',
    gain: 0.55, variations: 2, duration: 0.7, maxVoices: 2, minInterval: 0.25,
    recipe: (k, v) => {
      const room = roomSend(k, 0.2, k.out, 0.6);
      if (v === 0) {
        noiseHit(k, { dur: 0.12, amp: 0.1, filter: { type: 'highpass', f: 2500 }, dest: room });
        thud(k, 0.12, 90, 48, 0.3, 0.55, room);
        noiseHit(k, { t: 0.12, dur: 0.12, amp: 0.3, color: 'pink', filter: { type: 'lowpass', f: 400 }, dest: room });
        ring(k, { t: 0.12, f: 520, amp: 0.1, dest: room, partials: [[1, 0.4, 0.3], [2.3, 0.25, 0.2], [3.9, 0.12, 0.1]] });
      } else {
        thud(k, 0, 110, 60, 0.18, 0.4, room);
        ring(k, { f: 640, amp: 0.08, dest: room, partials: [[1, 0.4, 0.2], [2.5, 0.25, 0.12]] });
        thud(k, 0.18, 100, 55, 0.18, 0.35, room);
        noiseHit(k, { t: 0.32, dur: 0.3, a: 0.01, amp: 0.1, filter: { type: 'highpass', f: 2200 }, dest: room });
      }
    },
  }),
  ev({
    id: 'saw_cut', bus: 'sfx', category: 'machine', description: 'Cutting: short circular-saw pass (v0) or hand-saw strokes (v1).',
    gain: 0.35, variations: 2, duration: 0.85, maxVoices: 2, minInterval: 0.3,
    recipe: (k, v) => {
      if (v === 0) {
        tone(k, { type: 'sawtooth', f: 1500, f2: 1250, glide: 0.35, dur: 0.75, hold: 0.6, a: 0.06, amp: 0.05, filter: { type: 'bandpass', f: 3000, q: 2 } });
        noiseHit(k, { dur: 0.75, hold: 0.6, a: 0.08, amp: 0.12, filter: { type: 'bandpass', f: 4000, q: 1.2 } });
      } else {
        for (let i = 0; i < 3; i++) noiseHit(k, { t: i * 0.24, dur: 0.22, amp: 0.25, color: 'pink', shape: 'swell', seed: 30 + i, filter: { type: 'bandpass', f: i % 2 ? 1500 : 2200, f2: i % 2 ? 2200 : 1500, q: 1.4 } });
      }
    },
  }),
  ev({
    id: 'weld_spark', bus: 'sfx', category: 'machine', description: 'Welding/sparks: arc crackle (steady / short burst / sputter).',
    gain: 0.35, variations: 3, duration: 0.55, maxVoices: 2, minInterval: 0.25,
    recipe: (k, v) => {
      if (v === 0) {
        grains(k, { dur: 0.45, density: 220, amp: 0.3, bandRange: [2000, 8000], bandQ: 1.5, grainDur: 0.0015, shape: 'flat' });
        noiseHit(k, { dur: 0.45, hold: 0.38, amp: 0.04, filter: { type: 'highpass', f: 5000 } });
      } else if (v === 1) {
        grains(k, { dur: 0.25, density: 400, densityEnd: 80, amp: 0.3, bandRange: [3000, 9000], bandQ: 1.5, grainDur: 0.0012, shape: 'decay' });
      } else {
        for (let i = 0; i < 3; i++) grains(k, { t: i * 0.16, dur: 0.1, density: 300, amp: 0.28, bandRange: [2500, 7000], grainDur: 0.0015, shape: 'swell', seed: 40 + i });
      }
    },
  }),
  ev({
    id: 'steam_hiss', bus: 'sfx', category: 'machine', description: 'Steam/pressure release (food & industrial): soft hiss or valve puff.',
    gain: 0.35, variations: 2, duration: 0.75, maxVoices: 2, minInterval: 0.3,
    recipe: (k, v) => {
      if (v === 0) {
        noiseHit(k, { dur: 0.7, a: 0.015, amp: 0.3, filter: { type: 'highpass', f: 2000 }, filter2: { type: 'bandpass', f: 4500, q: 0.6 } });
      } else {
        click(k, 0, 1800, 0.12);
        noiseHit(k, { t: 0.02, dur: 0.3, a: 0.01, amp: 0.3, filter: { type: 'highpass', f: 2500 }, filter2: { type: 'bandpass', f: 3500, f2: 5500, q: 0.8 }, seed: 9 });
      }
    },
  }),
  ev({
    id: 'oven_ding', bus: 'sfx', category: 'machine', description: 'Bakery/oven timer done (food district): kitchen-timer bell.',
    gain: 0.45, variations: 2, duration: 1.2, maxVoices: 2, minInterval: 0.5,
    recipe: (k, v) => {
      const strike = (t: number, a: number): number => ring(k, { t, f: hz(N.A6), amp: a, partials: [[1, 1, 1.1], [2.32, 0.4, 0.5], [4.25, 0.2, 0.25], [6.1, 0.08, 0.1]] });
      strike(0, 0.15);
      if (v) strike(0.18, 0.1);
    },
  }),
  ev({
    id: 'robot_beep', bus: 'sfx', category: 'machine', description: 'Hightech robot chatter: cute filtered beep sequences.',
    gain: 0.35, variations: 3, duration: 0.4, maxVoices: 2, minInterval: 0.2,
    recipe: (k, v) => {
      const seqs = [
        [N.C6, N.F6, N.D6],
        [N.F6, N.C6, N.G6, N.F6],
      ];
      if (v < 2) {
        seqs[v].forEach((m, i) => tone(k, { t: i * (v ? 0.06 : 0.08), type: 'softsquare', f: hz(m), f2: hz(m) * 1.03, dur: 0.05, hold: 0.04, amp: 0.1, filter: { type: 'lowpass', f: 3500 } }));
      } else {
        tone(k, { type: 'softsquare', f: 900, f2: 1400, glide: 0.12, dur: 0.15, hold: 0.12, amp: 0.1, filter: { type: 'lowpass', f: 3000 } });
        tone(k, { t: 0.18, f: 2100, dur: 0.03, amp: 0.08 });
      }
    },
  }),
  ev({
    id: 'scanner_beep', bus: 'sfx', category: 'retail', description: 'Checkout scanner beep (gentle, rounded).',
    gain: 0.3, variations: 2, duration: 0.25, maxVoices: 2, minInterval: 0.12,
    recipe: (k, v) => {
      if (v === 0) tone(k, { type: 'softsquare', f: 1760, dur: 0.09, hold: 0.075, a: 0.004, amp: 0.12, filter: { type: 'lowpass', f: 4000 } });
      else {
        click(k, 0, 3000, 0.08);
        tone(k, { t: 0.01, f: 1397, dur: 0.12, hold: 0.1, a: 0.004, amp: 0.15 });
      }
    },
  }),

  // ============================================================== Loops
  ev({
    id: 'loop_belt', bus: 'sfx', category: 'machine', description: 'Conveyor running: roller clicks over a low rumble and motor hum.',
    loop: true, gain: 0.35, variations: 2, duration: 2.0, maxVoices: 3, pitchJitter: 0.03,
    recipe: (k, v) => {
      const T = k.renderLen;
      grains(k, { dur: T, density: loopRate(k, v ? 9 : 16), amp: v ? 0.2 : 0.14, ampJitter: 0.6, bandRange: v ? [600, 1400] : [1200, 2600], bandQ: 3, grainDur: v ? 0.012 : 0.007, shape: 'flat', periodic: true });
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.22, color: 'brown', filter: { type: 'lowpass', f: 220 } });
      tone(k, { type: 'organ', f: k.loopFreq(v ? 82 : 100), dur: T, hold: T, a: 0.001, amp: 0.05 });
      tone(k, { f: k.loopFreq(v ? 328 : 400), dur: T, hold: T, a: 0.001, amp: 0.012 });
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.08, color: 'pink', filter: { type: 'bandpass', f: 900, q: 0.5 }, seed: 8 });
      if (v) for (const t of [0.4, 1.3]) tone(k, { t, f: 2400, f2: 2250, dur: 0.06, amp: 0.012 });
    },
  }),
  ev({
    id: 'loop_motor_hum', bus: 'sfx', category: 'machine', description: 'Electric motor running: harmonic hum with slow beating and brush noise.',
    loop: true, gain: 0.3, variations: 2, duration: 2.0, maxVoices: 3, pitchJitter: 0.03,
    recipe: (k, v) => {
      const T = k.renderLen;
      const f0 = k.loopFreq(v ? 147 : 98);
      // strong upper harmonics so the hum is audible on small speakers
      const harm: Array<[number, number]> = [[1, 0.2], [2, 0.22], [3, 0.16], [4, 0.1], [5, 0.06], [6, 0.035], [8, 0.015]];
      for (const [h, a] of harm) tone(k, { f: f0 * h, dur: T, hold: T, a: 0.001, amp: a });
      tone(k, { f: (f0 + 0.5) * 2, dur: T, hold: T, a: 0.001, amp: 0.12 }); // 1 Hz beat on the 2nd harmonic = 2 per loop
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.08, color: 'pink', filter: { type: 'bandpass', f: 1500, q: 0.6 } });
      tone(k, { f: k.loopFreq(v ? 1180 : 760), dur: T, hold: T, a: 0.001, amp: v ? 0.014 : 0.008 });
    },
  }),
  ev({
    id: 'loop_paint_booth', bus: 'sfx', category: 'machine', description: 'Paint booth running: extraction fan with blade flutter and intermittent hiss.',
    loop: true, gain: 0.3, variations: 1, duration: 3.0, maxVoices: 2,
    recipe: (k) => {
      const T = k.renderLen;
      const fan = k.gain(1);
      fan.connect(k.out);
      k.lfo(fan.gain, k.loopFreq(23), 0.25, 0, T);
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.3, color: 'pink', filter: { type: 'lowpass', f: 1600 }, dest: fan });
      const hiss = k.gain(0.5);
      hiss.connect(k.out);
      k.lfo(hiss.gain, k.loopFreq(1 / 3), 0.5, 0, T);
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.08, filter: { type: 'highpass', f: 3000 }, dest: hiss, seed: 3 });
    },
  }),
  ev({
    id: 'loop_van_engine', bus: 'sfx', category: 'vehicle', description: 'Delivery van idling: small petrol putter (v0) or electric van whine + tyre noise (v1).',
    loop: true, gain: 0.35, variations: 2, duration: 1.5, maxVoices: 3, outdoor: true, pitchJitter: 0.05,
    recipe: (k, v) => {
      const T = k.renderLen;
      if (v === 0) {
        grains(k, { dur: T, density: loopRate(k, 30), amp: 0.5, ampJitter: 0.25, color: 'pink', grainDur: 0.012, grainJitter: 0.2, filter: { type: 'lowpass', f: 900 }, shape: 'flat', periodic: true });
        tone(k, { type: 'organ', f: k.loopFreq(60), dur: T, hold: T, a: 0.001, amp: 0.05, filter: { type: 'lowpass', f: 600 } });
        tone(k, { type: 'softsaw', f: k.loopFreq(120), dur: T, hold: T, a: 0.001, amp: 0.06, filter: { type: 'lowpass', f: 900 } });
        grains(k, { dur: T, density: loopRate(k, 15), amp: 0.06, bandRange: [1000, 2000], shape: 'flat', periodic: true, seed: 3 });
      } else {
        tone(k, { f: k.loopFreq(620), dur: T, hold: T, a: 0.001, amp: 0.05 });
        tone(k, { f: k.loopFreq(1240), dur: T, hold: T, a: 0.001, amp: 0.015 });
        noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.25, color: 'pink', filter: { type: 'lowpass', f: 800 } });
      }
    },
  }),
  ev({
    id: 'loop_truck_engine', bus: 'sfx', category: 'vehicle', description: 'Truck: diesel idle with knock (v0) or cruising rumble with road noise (v1).',
    loop: true, gain: 0.4, variations: 2, duration: 2.0, maxVoices: 2, outdoor: true, pitchJitter: 0.04,
    recipe: (k, v) => {
      const T = k.renderLen;
      if (v === 0) {
        grains(k, { dur: T, density: loopRate(k, 19), amp: 0.6, ampJitter: 0.2, color: 'pink', grainDur: 0.02, grainJitter: 0.15, filter: { type: 'lowpass', f: 1100 }, shape: 'flat', periodic: true });
        tone(k, { type: 'organ', f: k.loopFreq(38), dur: T, hold: T, a: 0.001, amp: 0.06, filter: { type: 'lowpass', f: 500 } });
        tone(k, { type: 'softsaw', f: k.loopFreq(76), dur: T, hold: T, a: 0.001, amp: 0.08, filter: { type: 'lowpass', f: 650 } });
        grains(k, { dur: T, density: loopRate(k, 38), amp: 0.14, bandRange: [1500, 3000], grainDur: 0.002, shape: 'flat', periodic: true, seed: 5 });
      } else {
        tone(k, { type: 'softsaw', f: k.loopFreq(55), dur: T, hold: T, a: 0.001, amp: 0.14, filter: { type: 'lowpass', f: 700 } });
        tone(k, { f: k.loopFreq(110), dur: T, hold: T, a: 0.001, amp: 0.06 });
        noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.33, color: 'pink', filter: { type: 'lowpass', f: 1000 } });
      }
    },
  }),
  ev({
    id: 'loop_amb_city_day', bus: 'ambience', category: 'ambience', description: 'Daytime city bed: distant traffic, air, passing cars, faraway birds (stereo).',
    loop: true, gain: 0.5, variations: 1, duration: 12, maxVoices: 1, stereo: true, spatial: false,
    recipe: (k) => {
      const T = k.renderLen;
      const bed = k.gain(1);
      bed.connect(k.out);
      k.lfo(bed.gain, k.loopFreq(1 / 12), 0.15, 0, T);
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.3, color: 'brown', filter: { type: 'lowpass', f: 450 }, pan: -0.5, dest: bed, seed: 1 });
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.3, color: 'brown', filter: { type: 'lowpass', f: 420 }, pan: 0.5, dest: bed, seed: 2 });
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.05, color: 'pink', filter: { type: 'bandpass', f: 1000, q: 0.5 }, dest: bed, seed: 11 });
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.035, color: 'pink', filter: { type: 'highpass', f: 2000 }, filter2: { type: 'lowpass', f: 6000 }, seed: 3 });
      for (const [t, p, f] of [[0.8, -0.7, 650], [4.6, 0.6, 520], [8.1, -0.2, 800]] as Array<[number, number, number]>) {
        noiseHit(k, { t, dur: 3.2, amp: 0.12, color: 'pink', shape: 'swell', filter: { type: 'bandpass', f, q: 0.8 }, pan: p, seed: 10 + t });
      }
      const room = roomSend(k, 0.5, k.out, 1.2);
      for (const [t, p] of [[2.1, 0.7], [2.35, 0.7], [6.8, -0.6], [10.2, 0.3]] as Array<[number, number]>) {
        chirp(k, t, [[0, 3400 + p * 300], [0.06, 4300], [0.1, 3800]], 0.02, room, p);
      }
    },
  }),
  ev({
    id: 'loop_amb_city_night', bus: 'ambience', category: 'ambience', description: 'Night city bed: crickets, soft wind, low distant hum, a far owl (stereo).',
    loop: true, gain: 0.45, variations: 1, duration: 12, maxVoices: 1, stereo: true, spatial: false,
    recipe: (k) => {
      const T = k.renderLen;
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.18, color: 'brown', filter: { type: 'lowpass', f: 200 }, seed: 4 });
      const wind = k.gain(1);
      wind.connect(k.out);
      k.lfo(wind.gain, k.loopFreq(1 / 6), 0.6, 0, T);
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.06, color: 'pink', filter: { type: 'bandpass', f: 420, q: 0.5 }, dest: wind, seed: 5 });
      const crickets: Array<[number, number, number, number]> = [
        [4300, -0.6, 0.62, 4],
        [4750, 0.55, 0.85, 3],
      ];
      for (const [f, p, period, pulses] of crickets) {
        const per = k.loopLen / Math.round(k.loopLen / period);
        for (let t = k.rng.range(0, per); t < T - 0.1; t += per) {
          for (let i = 0; i < pulses; i++) tone(k, { t: t + i * 0.033, f, dur: 0.018, a: 0.003, amp: 0.035, pan: p });
        }
      }
      for (const t of [5.2, 5.75]) tone(k, { t, f: 380, f2: 360, dur: 0.38, a: 0.06, amp: 0.025, vib: { rate: 6, depth: 10 }, pan: -0.3 });
    },
  }),
  ev({
    id: 'loop_amb_interior', bus: 'ambience', category: 'ambience', description: 'Factory interior room tone: low air, mains hum, distant machinery thumps (stereo).',
    loop: true, gain: 0.45, variations: 1, duration: 10, maxVoices: 1, stereo: true, spatial: false,
    recipe: (k) => {
      const T = k.renderLen;
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.3, color: 'brown', filter: { type: 'lowpass', f: 300 }, pan: -0.6, seed: 6 });
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.3, color: 'brown', filter: { type: 'lowpass', f: 280 }, pan: 0.6, seed: 7 });
      tone(k, { f: k.loopFreq(120), dur: T, hold: T, a: 0.001, amp: 0.02 });
      tone(k, { f: k.loopFreq(240), dur: T, hold: T, a: 0.001, amp: 0.008 });
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.05, color: 'pink', filter: { type: 'lowpass', f: 900 }, seed: 8 });
      const room = roomSend(k, 0.7, k.out, 1.4);
      for (const t of [1.3, 4.9, 7.6]) {
        thud(k, t, 80, 55, 0.25, 0.08, room);
        ring(k, { t: t + 0.05, f: k.rng.range(400, 800), amp: 0.012, dest: room, partials: [[1, 1, 0.5], [2.4, 0.4, 0.3]] });
      }
    },
  }),
  ev({
    id: 'loop_shop_chatter', bus: 'ambience', category: 'retail', description: 'Shop/retail murmur: synthesized formant "walla" (no real speech) with bag rustles (stereo).',
    loop: true, gain: 0.35, variations: 1, duration: 8, maxVoices: 2, stereo: true,
    recipe: (k) => {
      const T = k.renderLen;
      const vowels: Array<[number, number]> = [[730, 1090], [530, 1840], [400, 2000], [570, 840], [350, 900], [640, 1200]];
      const lp = k.filter('lowpass', 3000, 0.6);
      const room = roomSend(k, 0.45, k.out, 0.9);
      lp.connect(room);
      for (let vI = 0; vI < 6; vI++) {
        const g = 0.8 + k.rng.next() * 0.45;
        const f0 = (vI % 2 ? 190 : 115) * k.rng.range(0.9, 1.15);
        const src = k.osc('sawtooth', f0, 0, T);
        const srcN = k.src(k.noise('pink', 2, 20 + vI), 0, { dur: T, loop: true });
        const ng = k.gain(0.15);
        const f1 = k.filter('bandpass', 600, 5);
        const f2 = k.filter('bandpass', 1500, 6);
        const amp = k.gain(0);
        const pn = k.pan(k.rng.range(-0.8, 0.8));
        src.connect(f1);
        src.connect(f2);
        srcN.connect(ng);
        ng.connect(f1);
        ng.connect(f2);
        f1.connect(amp);
        f2.connect(amp);
        amp.connect(pn).connect(lp);
        let t = k.rng.range(0, 1);
        amp.gain.setValueAtTime(0, 0);
        while (t < T - 0.3) {
          const syl = k.rng.int(3, 8);
          src.frequency.setTargetAtTime(f0 * k.rng.range(0.92, 1.12), t, 0.2);
          for (let s = 0; s < syl && t < T - 0.3; s++) {
            const [a1, a2] = k.rng.pick(vowels);
            const d = k.rng.range(0.08, 0.2);
            f1.frequency.setTargetAtTime(a1 * g, t, 0.02);
            f2.frequency.setTargetAtTime(a2 * g, t, 0.02);
            const peak = 0.05 * k.rng.range(0.5, 1);
            amp.gain.setTargetAtTime(peak, t, 0.015);
            amp.gain.setTargetAtTime(peak * 0.15, t + d * 0.7, 0.02);
            t += d + k.rng.range(0.01, 0.06);
          }
          amp.gain.setTargetAtTime(0, t, 0.04);
          t += k.rng.range(0.4, 1.3);
        }
      }
      for (const t of [1.7, 5.3]) grains(k, { t, dur: 0.35, density: 120, amp: 0.025, bandRange: [2000, 5000], shape: 'swell', pan: k.rng.range(-0.6, 0.6), dest: room });
    },
  }),
  ev({
    id: 'loop_server_hum', bus: 'sfx', category: 'machine', description: 'Hightech server rack / lab: fan wash, mains hum, faint whine and disk ticks.',
    loop: true, gain: 0.28, variations: 2, duration: 3.0, maxVoices: 2,
    recipe: (k, v) => {
      const T = k.renderLen;
      const fan = k.gain(1);
      fan.connect(k.out);
      if (v) k.lfo(fan.gain, k.loopFreq(37), 0.15, 0, T);
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.2, color: 'pink', filter: { type: 'lowpass', f: v ? 1200 : 2500 }, dest: fan });
      tone(k, { f: k.loopFreq(v ? 50 : 100), dur: T, hold: T, a: 0.001, amp: 0.04 });
      tone(k, { f: k.loopFreq(v ? 2700 : 3200), dur: T, hold: T, a: 0.001, amp: 0.006 });
      grains(k, { dur: T, density: loopRate(k, v ? 3 : 5), amp: 0.06, bandRange: [3000, 5000], bandQ: 4, grainDur: 0.003, shape: 'flat', periodic: true, seed: 12 });
    },
  }),
  ev({
    id: 'loop_amb_industrial', bus: 'ambience', category: 'ambience', description: 'Industrial district bed: low rumble, distant clanks and steam (stereo).',
    loop: true, gain: 0.45, variations: 1, duration: 12, maxVoices: 1, stereo: true, spatial: false,
    recipe: (k) => {
      const T = k.renderLen;
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.35, color: 'brown', filter: { type: 'lowpass', f: 150 }, pan: -0.4, seed: 21 });
      noiseHit(k, { dur: T, a: 0.001, hold: T, amp: 0.35, color: 'brown', filter: { type: 'lowpass', f: 160 }, pan: 0.4, seed: 22 });
      const room = roomSend(k, 0.8, k.out, 1.8);
      for (const [t, f, p] of [[0.9, 420, -0.5], [3.4, 760, 0.6], [6.2, 560, -0.2], [9.7, 880, 0.3]] as Array<[number, number, number]>) {
        ring(k, { t, f, amp: 0.03, pan: p, dest: room, partials: [[1, 1, 0.8], [2.3, 0.5, 0.5], [3.9, 0.2, 0.3]] });
        thud(k, t, 100, 60, 0.15, 0.06, room);
      }
      for (const t of [2.2, 7.8]) noiseHit(k, { t, dur: 1.2, a: 0.1, amp: 0.03, shape: 'swell', filter: { type: 'highpass', f: 2500 }, seed: 30 + t, dest: room });
      for (const t of [5.0, 5.35, 11.0, 11.35]) thud(k, t, 90, 50, 0.12, 0.06, room);
    },
  }),

  // ============================================================== Logistics
  ev({
    id: 'van_horn', bus: 'sfx', category: 'vehicle', description: 'Small van horn: cheerful "beep-beep" (F+A) or one longer beep.',
    gain: 0.4, variations: 2, duration: 0.5, maxVoices: 2, minInterval: 0.6, outdoor: true,
    recipe: (k, v) => {
      const blast = (t: number, d: number, type: 'softsquare' | 'sawtooth'): void => {
        for (const m of [N.F4, N.A4]) tone(k, { t, type, f: hz(m), dur: d, hold: d - 0.03, a: 0.01, amp: 0.1, filter: { type: v ? 'bandpass' : 'lowpass', f: v ? 1000 : 2200, q: v ? 0.8 : 0.7 } });
      };
      if (v === 0) {
        blast(0, 0.12, 'softsquare');
        blast(0.19, 0.14, 'softsquare');
      } else blast(0, 0.36, 'sawtooth');
    },
  }),
  ev({
    id: 'truck_horn', bus: 'sfx', category: 'vehicle', description: 'Truck air horn: low F-major triad with a soft pitch bloom (not harsh).',
    gain: 0.4, variations: 2, duration: 0.9, maxVoices: 1, minInterval: 1, outdoor: true,
    recipe: (k, v) => {
      const blast = (t: number, d: number): void => {
        for (const m of [N.F3, N.A3, N.C4]) {
          const f = hz(m);
          tone(k, { t, type: 'softsaw', f: f * 0.97, f2: f, glide: 0.06, dur: d, hold: d - 0.06, a: 0.03, amp: 0.08, filter: { type: 'lowpass', f: 1400 } });
        }
      };
      if (v === 0) blast(0, 0.8);
      else {
        blast(0, 0.22);
        blast(0.32, 0.3);
      }
    },
  }),
  ev({
    id: 'truck_reverse', bus: 'sfx', category: 'vehicle', description: 'Reversing alarm, softened: three rounded beeps (v0) or broadband "white-noise" pulses (v1).',
    gain: 0.3, variations: 2, duration: 1.4, maxVoices: 2, minInterval: 1.3, outdoor: true,
    recipe: (k, v) => {
      for (let i = 0; i < 3; i++) {
        const t = i * 0.5;
        if (v === 0) tone(k, { t, type: 'softsquare', f: hz(N.C6), dur: 0.25, hold: 0.22, a: 0.01, amp: 0.1, filter: { type: 'lowpass', f: 3000 } });
        else noiseHit(k, { t, dur: 0.25, hold: 0.22, a: 0.01, amp: 0.25, filter: { type: 'bandpass', f: 1800, q: 0.7 }, seed: 50 + i });
      }
    },
  }),
  ev({
    id: 'unload_thud', bus: 'sfx', category: 'vehicle', description: 'Cargo unloaded: box thud / pallet with creak / soft sack.',
    gain: 0.5, variations: 3, duration: 0.45, maxVoices: 3, minInterval: 0.12, pitchJitter: 0.05,
    recipe: (k, v) => {
      if (v === 0) {
        thud(k, 0, 95, 55, 0.22, 0.5);
        noiseHit(k, { dur: 0.1, amp: 0.3, color: 'pink', filter: { type: 'lowpass', f: 500 } });
        ring(k, { f: 700, amp: 0.03, partials: [[1, 1, 0.08], [2.2, 0.5, 0.05]] });
      } else if (v === 1) {
        thud(k, 0, 80, 48, 0.25, 0.5);
        tone(k, { t: 0.02, type: 'softsaw', f: 180, f2: 150, dur: 0.12, amp: 0.035, filter: { type: 'bandpass', f: 900, q: 1.5 } });
        thud(k, 0.12, 90, 60, 0.1, 0.2);
      } else {
        noiseHit(k, { dur: 0.15, amp: 0.38, color: 'pink', filter: { type: 'lowpass', f: 800 } });
        thud(k, 0, 120, 70, 0.12, 0.25);
      }
    },
  }),
  ev({
    id: 'van_door', bus: 'sfx', category: 'vehicle', description: 'Van door: sliding door with latch / hinged slam / latch-and-creak open.',
    gain: 0.45, variations: 3, duration: 0.7, maxVoices: 2, minInterval: 0.25, outdoor: true,
    recipe: (k, v) => {
      if (v === 0) {
        noiseHit(k, { dur: 0.5, amp: 0.18, color: 'pink', shape: 'swell', filter: { type: 'bandpass', f: 700, f2: 1400, q: 1 } });
        grains(k, { dur: 0.48, density: 40, amp: 0.07, bandRange: [400, 900], shape: 'swell', periodic: true });
        thud(k, 0.55, 160, 100, 0.1, 0.35);
        click(k, 0.55, 2500, 0.15);
      } else if (v === 1) {
        click(k, 0, 2200, 0.12);
        thud(k, 0.02, 120, 70, 0.2, 0.45);
        ring(k, { t: 0.02, f: 420, amp: 0.05, partials: [[1, 1, 0.15], [2.3, 0.5, 0.1]] });
      } else {
        click(k, 0, 2600, 0.15);
        click(k, 0.04, 2000, 0.12);
        tone(k, { t: 0.08, type: 'sawtooth', f: 320, f2: 280, dur: 0.25, amp: 0.025, a: 0.05, filter: { type: 'bandpass', f: 1200, q: 2 } });
      }
    },
  }),
  ev({
    id: 'crate_slide', bus: 'sfx', category: 'vehicle', description: 'Wooden crate pushed/slid across a floor, ending with a bump.',
    gain: 0.4, variations: 2, duration: 0.65, maxVoices: 2, minInterval: 0.2,
    recipe: (k, v) => {
      const d = v ? 0.3 : 0.55;
      noiseHit(k, { dur: d, hold: d * 0.8, a: 0.03, amp: 0.18, filter: { type: 'bandpass', f: 800, q: 1 } });
      grains(k, { dur: d, density: 150, amp: 0.08, bandRange: [600, 1500], shape: 'flat' });
      thud(k, d, 140, 90, 0.08, 0.3);
      if (v) tone(k, { t: d, f: 700, dur: 0.04, amp: 0.1 });
    },
  }),

  // ============================================================== Retail
  ev({
    id: 'shop_bell', bus: 'sfx', category: 'retail', description: 'Customer enters: spring door bell jingle (v0) or two-tone door chime A-F (v1).',
    gain: 0.4, variations: 2, duration: 1.0, maxVoices: 2, minInterval: 0.4, outdoor: false,
    recipe: (k, v) => {
      if (v === 0) {
        [0, 0.07, 0.15, 0.26].forEach((t, i) => ring(k, { t, f: i % 2 ? 2790 : 2350, amp: 0.14 * (1 - i * 0.18), partials: [[1, 1, 0.5], [2.32, 0.5, 0.3], [4.1, 0.2, 0.15]] }));
      } else {
        bell(k, k.out, 0, N.A5, 0.9, 0.6);
        bell(k, k.out, 0.32, N.F5, 1.0, 0.55);
      }
    },
  }),
  ev({
    id: 'cash_register', bus: 'sfx', category: 'retail', description: 'Register: drawer "ka-ching" (v0) or modern till: key click, double beep, receipt buzz (v1).',
    gain: 0.45, variations: 2, duration: 1.0, maxVoices: 2, minInterval: 0.3,
    recipe: (k, v) => {
      if (v === 0) {
        noiseHit(k, { dur: 0.06, amp: 0.3, color: 'pink', filter: { type: 'lowpass', f: 1500 } });
        thud(k, 0, 140, 90, 0.1, 0.28);
        grains(k, { dur: 0.12, density: 80, amp: 0.08, bandRange: [2000, 4000], shape: 'decay' });
        ring(k, { t: 0.08, f: hz(N.F7), amp: 0.18, partials: [[1, 1, 0.9], [2.0, 0.4, 0.5], [2.92, 0.3, 0.3], [4.2, 0.15, 0.15]] });
      } else {
        click(k, 0, 3500, 0.15, 2, 0.006);
        tone(k, { t: 0.06, f: 1760, dur: 0.07, hold: 0.06, amp: 0.1 });
        tone(k, { t: 0.16, f: 2093, dur: 0.07, hold: 0.06, amp: 0.1 });
        tone(k, { t: 0.3, type: 'softsquare', f: 180, dur: 0.32, hold: 0.28, amp: 0.05, filter: { type: 'bandpass', f: 2000, q: 1 } });
      }
    },
  }),

  // ============================================================== Ambience / foley one-shots
  ev({
    id: 'bird_chirp', bus: 'ambience', category: 'ambience', description: 'Songbird: tweet-tweet / trill / descending whistle / chirp-trill.',
    gain: 0.35, variations: 4, duration: 0.6, maxVoices: 3, minInterval: 0.4, outdoor: true, pitchJitter: 0.05,
    recipe: (k, v) => {
      if (v === 0) {
        chirp(k, 0, [[0, 3400], [0.06, 4200]], 0.2);
        chirp(k, 0.12, [[0, 3600], [0.07, 4500]], 0.18);
      } else if (v === 1) {
        for (let i = 0; i < 8; i++) chirp(k, i * 0.028, [[0, i % 2 ? 3600 : 2800], [0.02, i % 2 ? 2900 : 3500]], 0.15);
      } else if (v === 2) {
        chirp(k, 0, [[0, 4800], [0.12, 4300], [0.26, 3000]], 0.18);
      } else {
        chirp(k, 0, [[0, 3000], [0.05, 3900]], 0.18);
        chirp(k, 0.09, [[0, 3100], [0.05, 4000]], 0.16);
        for (let i = 0; i < 5; i++) chirp(k, 0.2 + i * 0.025, [[0, 4400], [0.018, 3800]], 0.12);
      }
    },
  }),
  ev({
    id: 'footstep_concrete', bus: 'sfx', category: 'foley', description: 'Worker footstep on concrete: heel + toe (four timbres).',
    gain: 0.35, variations: 4, duration: 0.12, maxVoices: 4, minInterval: 0.18, pitchJitter: 0.06,
    recipe: (k, v) => {
      const fc = [1200, 1000, 1500, 1800][v];
      noiseHit(k, { dur: 0.04 + v * 0.004, amp: 0.35, filter: { type: 'bandpass', f: fc, q: 0.9 }, seed: 60 + v });
      tone(k, { f: 140 - v * 8, f2: 100, dur: 0.04, amp: 0.18 });
      noiseHit(k, { t: 0.045 + v * 0.005, dur: 0.03, amp: 0.13, filter: { type: 'bandpass', f: fc * 1.8, q: 1 }, seed: 70 + v });
      if (v === 3) grains(k, { dur: 0.05, density: 300, amp: 0.05, bandRange: [3000, 6000], shape: 'decay' });
    },
  }),
  ev({
    id: 'cricket_chirp', bus: 'ambience', category: 'ambience', description: 'Night insect: cricket pulse chirp (two species).',
    gain: 0.25, variations: 2, duration: 0.6, maxVoices: 2, minInterval: 0.5, outdoor: true,
    recipe: (k, v) => {
      const f = v ? 5000 : 4400;
      const pulses = v ? 8 : 4;
      const rate = v ? 0.025 : 0.033;
      for (let rep = 0; rep < (v ? 1 : 2); rep++) for (let i = 0; i < pulses; i++) tone(k, { t: rep * 0.28 + i * rate, f, dur: 0.016, a: 0.003, amp: 0.15 });
    },
  }),
  ev({
    id: 'bicycle_bell', bus: 'sfx', category: 'foley', description: 'Passing cyclist: thumb bell "ring-ring" or single ding.',
    gain: 0.35, variations: 2, duration: 0.9, maxVoices: 1, minInterval: 1, outdoor: true,
    recipe: (k, v) => {
      const strike = (t: number, a: number): number => ring(k, { t, f: 3000, amp: a, partials: [[1, 1, 0.4], [1.48, 0.6, 0.3], [2.06, 0.4, 0.25]] });
      if (v === 0) for (let g = 0; g < 2; g++) for (let i = 0; i < 5; i++) strike(g * 0.2 + i * 0.022, 0.08 * (1 - i * 0.12));
      else strike(0, 0.14);
    },
  }),
  ev({
    id: 'wind_gust', bus: 'ambience', category: 'ambience', description: 'Gust of wind (non-positional): band-swept noise swell.',
    gain: 0.35, variations: 2, duration: 1.9, maxVoices: 1, minInterval: 2, spatial: false, outdoor: true,
    recipe: (k, v) => {
      const d = v ? 1.2 : 1.8;
      noiseHit(k, { dur: d, amp: 0.3, color: 'pink', shape: 'swell', filter: { type: 'bandpass', f: v ? 700 : 400, f2: v ? 1400 : 900, q: 0.5, sweep: d * 0.6 } });
      noiseHit(k, { dur: d, amp: 0.04, shape: 'swell', filter: { type: 'highpass', f: 3000 }, seed: 9 });
    },
  }),
];

export const SFX_BY_ID: Record<string, SfxDef> = Object.fromEntries(SFX_CATALOG.map((d) => [d.id, d]));

/** IDs the integration owner calls; kept here so tools can assert they exist. */
export const REQUIRED_SFX_IDS = [
  'ui_tap', 'ui_open', 'ui_close', 'ui_toggle', 'ui_error', 'ui_confirm', 'ui_purchase', 'ui_tab',
  'sale_coin', 'order_complete', 'unlock', 'level_up', 'notify', 'tutorial_step', 'milestone',
  'build_place', 'build_belt', 'build_remove', 'build_rotate', 'build_invalid', 'construct_complete', 'upgrade_complete',
  'bench_work', 'packer_work', 'paint_spray', 'arm_servo', 'machine_start', 'machine_stop', 'craft_done', 'alert_blocked',
  'alert_starved', 'dock_door_open', 'dock_door_close', 'item_drop',
  'loop_belt', 'loop_motor_hum', 'loop_paint_booth', 'loop_van_engine', 'loop_truck_engine', 'loop_amb_city_day',
  'loop_amb_city_night', 'loop_amb_interior', 'loop_shop_chatter',
  'van_horn', 'truck_reverse', 'unload_thud', 'van_door', 'shop_bell', 'cash_register', 'bird_chirp', 'footstep_concrete',
] as const;
