/**
 * Renders one catalog event variation into PCM via OfflineAudioContext.
 * Used at runtime by the SFX bank (lazy, background) and by tools/audio/check-sfx.mjs (QA).
 */
import type { SfxDef } from './sfx-catalog';
import { Kit } from './synth/kit';
import { hashString } from './synth/rng';
import { createOffline, startRendering, channelsOf, wrapLoop, trimTail, normalize, fadeIn, analyze, maxWindowLoudness, BufferStats } from './synth/render';

/** Default normalization targets per category: max 100 ms weighted loudness (LUFS-like). */
export const LEVEL_TARGETS: Record<string, number> = {
  ui: -17,
  economy: -16,
  build: -15,
  machine: -15,
  alert: -17,
  vehicle: -15,
  retail: -16,
  ambience: -20,
  foley: -16,
};
export const LOOP_LEVEL = -19;
export const MAX_PEAK_DB = -1;
/** Crossfade length used to wrap loops seamlessly. */
export const LOOP_XFADE = 0.35;

export interface RenderedPcm {
  channels: Float32Array[];
  sampleRate: number;
  stats: BufferStats;
  /** linear gain applied by normalization */
  normGain: number;
  /** max 100 ms weighted loudness after normalization (LUFS-like, see synth/render.ts weighted()) */
  loudness: number;
  renderMs: number;
}

/**
 * Render sample rate per event: stereo ambience beds are noise/texture (24 kHz keeps memory low),
 * other loops 32 kHz, one-shots 44.1 kHz. WebAudio resamples at playback.
 */
export function sfxRenderRate(def: SfxDef): number {
  if (def.loop && def.stereo) return 24000;
  if (def.loop) return 32000;
  return 44100;
}

export function sfxSeed(id: string, variation: number): number {
  return (hashString(id) ^ Math.imul(variation + 1, 0x9e3779b1)) >>> 0;
}

export async function renderSfxPcm(def: SfxDef, variation: number, sampleRate = sfxRenderRate(def)): Promise<RenderedPcm | null> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const v = ((variation % def.variations) + def.variations) % def.variations;
  const xfade = def.loop ? Math.min(LOOP_XFADE, def.duration * 0.25) : 0;
  const tail = def.loop ? 0 : (def.tail ?? 0.08);
  const total = def.duration + xfade + tail;
  const chCount = def.stereo ? 2 : 1;
  const ctx = createOffline(chCount, Math.ceil(total * sampleRate), sampleRate);
  if (!ctx) return null;
  const out = ctx.createGain();
  // DC blocker / sub-rumble guard (phone speakers can't reproduce < 30 Hz anyway)
  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 28;
  dcBlock.Q.value = 0.6;
  out.connect(dcBlock).connect(ctx.destination);
  const kit = new Kit(ctx, out, sfxSeed(def.id, v));
  kit.loopLen = def.loop ? def.duration : 0;
  kit.renderLen = total;
  def.recipe(kit, v, out);
  const buf = await startRendering(ctx);
  let chs: Float32Array[] = channelsOf(buf).map((c) => new Float32Array(c));
  if (def.loop) {
    chs = wrapLoop(chs, Math.round(def.duration * sampleRate), Math.round(xfade * sampleRate));
  } else {
    fadeIn(chs, sampleRate, 0.6);
    chs = trimTail(chs, sampleRate);
  }
  const target = def.level ?? (def.loop ? LOOP_LEVEL : (LEVEL_TARGETS[def.category] ?? -16));
  const normGain = normalize(chs, sampleRate, target, MAX_PEAK_DB, 'loudness');
  const stats = analyze(chs, sampleRate);
  const loudness = maxWindowLoudness(chs, sampleRate);
  const renderMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return { channels: chs, sampleRate, stats, normGain, renderMs, loudness };
}
