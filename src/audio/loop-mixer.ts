/**
 * Loop aggregation (pure logic). Many machines request loops every frame; we turn them into a
 * small set of voices:
 *  1. each request is spatialized (gain/pan relative to the listener; inaudible ones dropped);
 *  2. requests of the same event inside one world grid cell form a cluster that plays as ONE
 *     voice, a bit louder than its loudest member (1 + 0.25·log2(n), capped at 1.6x) — 30 belts
 *     in a hall become one rich belt bed instead of 30 phasing copies;
 *  3. per-event cap (catalog maxVoices) and a global cap keep only the nearest/loudest clusters,
 *     with a stickiness bonus for clusters that already have a voice (prevents flapping).
 * Non-spatial loops (ambience beds) aggregate by event id using the max requested gain.
 */
import type { ListenerContext } from './types';
import type { SfxDef } from './sfx-catalog';
import { spatialize } from './spatial';

export interface LoopRequest {
  key: string;
  eventId: string;
  pos: { x: number; y: number; z: number };
  gain: number;
  /** seconds (wall clock) of the last setLoop call */
  updated: number;
}

export interface LoopTarget {
  voiceKey: string;
  eventId: string;
  gain: number;
  pan: number;
  muffled: boolean;
  members: number;
}

export interface LoopMixOptions {
  maxLoopVoices: number;
  /** voice keys that are currently playing (they get a ranking bonus) */
  existing: Set<string>;
  stickiness?: number;
  cellSize: number;
}

const CELL_BANDS: Array<[number, number]> = [
  [0.25, 8],
  [0.5, 16],
  [0.75, 32],
  [Infinity, 64],
];

/** Cluster cell size in metres for the current zoom, with hysteresis around band edges. */
export function clusterCell(zoom01: number, interior: boolean, prev?: number): number {
  if (interior) return 6;
  const idx = CELL_BANDS.findIndex(([edge]) => zoom01 < edge);
  const cell = CELL_BANDS[idx][1];
  if (prev && prev !== cell) {
    const prevIdx = CELL_BANDS.findIndex(([, c]) => c === prev);
    if (prevIdx >= 0) {
      const lo = prevIdx > 0 ? CELL_BANDS[prevIdx - 1][0] : -Infinity;
      const hi = CELL_BANDS[prevIdx][0];
      if (zoom01 > lo - 0.05 && zoom01 < hi + 0.05) return prev;
    }
  }
  return cell;
}

export function clusterGain(maxEff: number, members: number): number {
  return maxEff * Math.min(1 + 0.25 * Math.log2(Math.max(1, members)), 1.6);
}

export function computeLoopTargets(reqs: Iterable<LoopRequest>, l: ListenerContext, catalog: Record<string, SfxDef>, o: LoopMixOptions): LoopTarget[] {
  interface Acc {
    eventId: string;
    n: number;
    max: number;
    sum: number;
    panSum: number;
    muffled: boolean;
  }
  const clusters = new Map<string, Acc>();
  for (const r of reqs) {
    if (!(r.gain > 0)) continue;
    const def = catalog[r.eventId];
    if (!def || !def.loop) continue;
    let key: string;
    let eff: number;
    let pan = 0;
    let muffled = false;
    if (def.spatial === false) {
      key = r.eventId;
      eff = r.gain;
      muffled = !!(l.interior && def.outdoor);
    } else {
      const s = spatialize(l, r.pos, def);
      if (!s.audible) continue;
      eff = r.gain * s.gain;
      pan = s.pan;
      muffled = s.muffled;
      const cx = Math.floor(r.pos.x / o.cellSize);
      const cz = Math.floor(r.pos.z / o.cellSize);
      key = `${r.eventId}@${cx},${cz}`;
    }
    if (eff < 0.002) continue;
    const a = clusters.get(key) ?? { eventId: r.eventId, n: 0, max: 0, sum: 0, panSum: 0, muffled: false };
    a.n++;
    a.max = Math.max(a.max, eff);
    a.sum += eff;
    a.panSum += eff * pan;
    a.muffled = a.muffled || muffled;
    clusters.set(key, a);
  }
  const sticky = o.stickiness ?? 1.3;
  const all: Array<LoopTarget & { rank: number }> = [];
  for (const [voiceKey, a] of clusters) {
    const def = catalog[a.eventId];
    const gain = def.spatial === false ? a.max : clusterGain(a.max, a.n);
    all.push({ voiceKey, eventId: a.eventId, gain, pan: a.sum > 0 ? a.panSum / a.sum : 0, muffled: a.muffled, members: a.n, rank: gain * (o.existing.has(voiceKey) ? sticky : 1) });
  }
  all.sort((x, y) => y.rank - x.rank);
  const perEvent = new Map<string, number>();
  const out: LoopTarget[] = [];
  for (const t of all) {
    const def = catalog[t.eventId];
    const used = perEvent.get(t.eventId) ?? 0;
    if (used >= def.maxVoices) continue;
    if (out.length >= o.maxLoopVoices) break;
    perEvent.set(t.eventId, used + 1);
    const { rank: _rank, ...rest } = t;
    out.push(rest);
  }
  return out;
}
