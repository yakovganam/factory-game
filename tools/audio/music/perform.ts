// Performs (renders) one stem of a Score with the synth library in an OfflineAudioContext.
// The piece is rendered with a tail and the tail is folded onto the start, so the stem loops
// seamlessly (the reverb of the last bar rings over bar 0 exactly as it would when looping).
import type { Score, Track } from './theory';
import { Kit, midiToFreq } from '../../../src/audio/synth/kit';
import { hashString, Rng } from '../../../src/audio/synth/rng';
import { createReverb, createDelay } from '../../../src/audio/synth/fx';
import { INSTRUMENTS } from '../../../src/audio/synth/instruments';
import { DRUMS } from '../../../src/audio/synth/drums';
import { createOffline, channelsOf, foldTail } from '../../../src/audio/synth/render';
import { renderWindowed, SeqEvent } from '../../../src/audio/synth/sequencer';

export const TAIL_SEC = 4;

export function loopSeconds(score: Score): number {
  return (score.bars * score.beatsPerBar * 60) / score.bpm;
}

export function loopSamples(score: Score, sr: number): number {
  return Math.round(loopSeconds(score) * sr);
}

/** beat -> seconds including 8th-note swing (16ths are swung proportionally). */
export function beatToSec(score: Score, beat: number): number {
  const spb = 60 / score.bpm;
  const s = score.swing ?? 0;
  const whole = Math.floor(beat + 1e-9);
  const frac = beat - whole;
  let off = 0;
  if (s) {
    // piecewise-linear warp of the beat: 0 -> 0, 0.5 -> 0.5 + s, 1 -> 1
    off = frac <= 0.5 ? (frac / 0.5) * s : ((1 - frac) / 0.5) * s;
  }
  return (beat + off) * spb;
}

export async function renderStem(score: Score, stemId: string, sr: number): Promise<{ channels: Float32Array[]; events: number; renderMs: number }> {
  const t0 = performance.now();
  const stem = score.stems.find((s) => s.id === stemId);
  if (!stem) throw new Error(`no stem ${stemId}`);
  const loopLen = loopSamples(score, sr);
  const total = loopLen + Math.round(TAIL_SEC * sr);
  const ctx = createOffline(stem.channels, total, sr);
  if (!ctx) throw new Error('OfflineAudioContext unavailable');

  const stemBus = ctx.createGain();
  stemBus.gain.value = stem.gain;
  // gentle glue compression on the stem (keeps transients but tames stacked chords)
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 2;
  comp.attack.value = 0.02;
  comp.release.value = 0.25;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 32;
  // gentle presence shelf: synthesized timbres are sine-heavy; this keeps definition on phones
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 3200;
  shelf.gain.value = score.presenceDb ?? 4;
  stemBus.connect(hp).connect(shelf).connect(comp).connect(ctx.destination);

  const kit = new Kit(ctx, stemBus, hashString(`${score.id}:${stemId}`));
  const rev = createReverb(kit, score.reverb);
  rev.output.connect(stemBus);
  let dly: ReturnType<typeof createDelay> | null = null;
  if (score.delay) {
    dly = createDelay(kit, { time: (score.delay.beats * 60) / score.bpm, feedback: score.delay.feedback, tone: score.delay.tone, pingpong: stem.channels === 2 });
    dly.output.connect(rev.input);
    const dg = ctx.createGain();
    dg.gain.value = 0.8;
    dly.output.connect(dg).connect(stemBus);
  }

  const events: SeqEvent[] = [];
  const tracks = score.tracks.filter((t) => t.stem === stemId);
  for (const tr of tracks) {
    const bus = buildTrackBus(kit, tr, stemBus, rev.input, dly?.input ?? null);
    const rng = new Rng(hashString(`${score.id}:${tr.name}`));
    for (const n of tr.notes) {
      const h = tr.humanize;
      const tSec = Math.max(0, beatToSec(score, n.t) + (h ? (rng.next() * 2 - 1) * h.time : 0));
      const endSec = beatToSec(score, n.t + n.d);
      const dSec = Math.max(0.03, endSec - beatToSec(score, n.t));
      const v = Math.max(0.05, Math.min(1, n.v * (1 + (h ? (rng.next() * 2 - 1) * h.vel : 0))));
      if (tSec >= total / sr - 0.05) continue;
      if (tr.instrument === 'drums') {
        const fn = DRUMS[n.k ?? ''];
        if (!fn) throw new Error(`unknown drum ${n.k} in ${tr.name}`);
        const variant = n.p + (n.k === 'snare' || n.k === 'shaker' ? rng.int(0, 2) : 0);
        events.push({ t: tSec, run: () => void fn(kit, bus, tSec, v, variant) });
      } else {
        const fn = INSTRUMENTS[tr.instrument];
        if (!fn) throw new Error(`unknown instrument ${tr.instrument} in ${tr.name}`);
        if (midiToFreq(n.p) > sr * 0.45) continue;
        events.push({ t: tSec, run: () => void fn(kit, bus, tSec, n.p, dSec, v, tr.opts) });
      }
    }
  }
  const count = events.length;
  const buf = await renderWindowed(ctx, kit, events, 1);
  const chs = foldTail(channelsOf(buf), loopLen);
  return { channels: chs, events: count, renderMs: performance.now() - t0 };
}

function buildTrackBus(kit: Kit, tr: Track, out: AudioNode, revIn: AudioNode, dlyIn: AudioNode | null): AudioNode {
  const ctx = kit.ctx;
  const input = ctx.createGain();
  input.gain.value = tr.gain;
  let node: AudioNode = input;
  if (tr.highpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = tr.highpass;
    node.connect(f);
    node = f;
  }
  if (tr.lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = tr.lowpass;
    node.connect(f);
    node = f;
  }
  let panned: AudioNode = node;
  if (tr.pan && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = tr.pan;
    node.connect(p);
    panned = p;
  }
  panned.connect(out);
  if (tr.reverb) {
    const g = ctx.createGain();
    g.gain.value = tr.reverb;
    panned.connect(g).connect(revIn);
  }
  if (tr.delay && dlyIn) {
    const g = ctx.createGain();
    g.gain.value = tr.delay;
    panned.connect(g).connect(dlyIn);
  }
  return input;
}
