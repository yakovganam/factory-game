/**
 * Windowed offline scheduler. Creating every note's nodes up front makes Chromium process
 * thousands of idle nodes per render quantum (measured: ~25 s for a 130 s stem). Instead we
 * suspend the OfflineAudioContext every `window` seconds, create only the notes of the next
 * window and disconnect finished voices (~1.6 s for the same stem).
 */
import { Kit } from './kit';
import { startRendering } from './render';

export interface SeqEvent {
  /** context time in seconds */
  t: number;
  run: () => void;
}

export async function renderWindowed(ctx: OfflineAudioContext, kit: Kit, events: SeqEvent[], windowSec = 1): Promise<AudioBuffer> {
  events.sort((a, b) => a.t - b.t);
  const sr = ctx.sampleRate;
  const dur = ctx.length / sr;
  const quantum = 128 / sr;
  let idx = 0;
  const fill = (until: number): void => {
    while (idx < events.length && events[idx].t < until) {
      events[idx].run();
      idx++;
    }
  };
  fill(windowSec * 2);
  const canSuspend = typeof (ctx as OfflineAudioContext).suspend === 'function';
  if (!canSuspend) {
    fill(Infinity);
    return startRendering(ctx);
  }
  const scheduleNext = (ts: number): void => {
    const tq = Math.ceil(ts / quantum) * quantum;
    if (tq >= dur - quantum * 4) {
      return;
    }
    ctx.suspend(tq).then(() => {
      kit.collect(ctx.currentTime - 0.005);
      fill(tq + windowSec * 2);
      scheduleNext(tq + windowSec);
      void ctx.resume();
    });
  };
  scheduleNext(windowSec);
  return startRendering(ctx);
}
