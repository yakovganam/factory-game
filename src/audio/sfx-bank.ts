/**
 * SfxBank: renders catalog events into AudioBuffers lazily, one job at a time in idle time,
 * in priority order (UI first, ambience last). `request(id)` moves an event to the front when
 * the game needs it before its turn. Rendering needs only OfflineAudioContext, so it can start
 * before the user gesture that unlocks the real AudioContext.
 */
import type { SfxDef } from './sfx-catalog';
import { renderSfxPcm } from './sfx-render';
import { createOffline } from './synth/render';

interface Job {
  id: string;
  v: number;
  pri: number;
  seq: number;
}

type IdleFn = (cb: () => void) => void;

const idle: IdleFn = (cb) => {
  const g = globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(cb, { timeout: 400 });
  else setTimeout(cb, 16);
};

export class SfxBank {
  private buffers = new Map<string, Array<AudioBuffer | null>>();
  private queue: Job[] = [];
  private running = false;
  private started = false;
  private seq = 0;
  private listeners: Array<(id: string) => void> = [];
  private failed = new Set<string>();
  renderedJobs = 0;
  totalJobs = 0;
  renderMs = 0;
  bytes = 0;

  constructor(private readonly catalog: SfxDef[]) {
    for (const d of catalog) {
      this.buffers.set(d.id, new Array(d.variations).fill(null));
      this.totalJobs += d.variations;
    }
  }

  get available(): boolean {
    return createOffline(1, 128, 44100) !== null;
  }

  /** Begin background rendering of the whole catalog (idempotent). */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.available) {
      this.running = false;
      return;
    }
    for (const d of this.catalog) for (let v = 0; v < d.variations; v++) this.queue.push({ id: d.id, v, pri: d.priority, seq: this.seq++ });
    this.sort();
    this.pump();
  }

  onReady(fn: (id: string) => void): void {
    this.listeners.push(fn);
  }

  /** Move an event's variations to the front of the queue. */
  request(id: string): void {
    if (!this.started) this.start();
    let moved = false;
    for (const j of this.queue) if (j.id === id && j.pri > -1) {
      j.pri = -1;
      moved = true;
    }
    if (moved) this.sort();
  }

  /** Rendered variations for an event (may be partial while rendering). */
  get(id: string): AudioBuffer[] {
    const arr = this.buffers.get(id);
    return arr ? (arr.filter(Boolean) as AudioBuffer[]) : [];
  }

  variation(id: string, v: number): AudioBuffer | null {
    return this.buffers.get(id)?.[v] ?? null;
  }

  isFailed(id: string): boolean {
    return this.failed.has(id);
  }

  private sort(): void {
    this.queue.sort((a, b) => a.pri - b.pri || a.seq - b.seq);
  }

  private pump(): void {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = true;
    idle(() => {
      void this.run(job).finally(() => {
        this.running = false;
        this.pump();
      });
    });
  }

  private async run(job: Job): Promise<void> {
    const def = this.catalog.find((d) => d.id === job.id);
    if (!def) return;
    try {
      const r = await renderSfxPcm(def, job.v);
      if (!r) {
        this.failed.add(job.id);
        return;
      }
      const ctx = createOffline(r.channels.length, r.channels[0].length, r.sampleRate);
      if (!ctx) return;
      const buf = ctx.createBuffer(r.channels.length, r.channels[0].length, r.sampleRate);
      r.channels.forEach((c, i) => buf.getChannelData(i).set(c));
      this.buffers.get(job.id)![job.v] = buf;
      this.renderedJobs++;
      this.renderMs += r.renderMs;
      this.bytes += r.channels.length * r.channels[0].length * 4;
      for (const fn of this.listeners) fn(job.id);
    } catch (e) {
      this.failed.add(job.id);
      if (isDev()) console.warn(`[audio] render failed for ${job.id}#${job.v}`, e);
    }
  }
}

export function isDev(): boolean {
  try {
    return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
  } catch {
    return false;
  }
}
