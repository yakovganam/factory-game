/**
 * Offline progress: a conservative catch-up that runs the SAME fixed-step simulation for the
 * elapsed wall time (clamped to a disclosed horizon). Because it is the real simulation, inputs,
 * storage, vehicle capacity, demand, wages and unlock state all constrain it automatically —
 * there is no "elapsed × max revenue" shortcut.
 *
 * Clock safety: time going backwards grants nothing; each interval is granted once because
 * `state.wallMs` advances to the granted instant and is saved immediately afterwards.
 */
import type { Sim } from './game';
import { TPS } from './types';

/** Disclosed in Settings → Offline progress. */
export const OFFLINE_HORIZON_SEC = 4 * 60 * 60;
/** Gaps shorter than this are treated as a normal pause (no catch-up). */
export const OFFLINE_MIN_SEC = 5;

export interface CatchUpPlan {
  ticks: number;
  elapsedSec: number;
  /** Elapsed time exceeded the horizon. */
  clamped: boolean;
  /** The device's compute budget limited the catch-up (large city / slow device). */
  budgetClamped: boolean;
  clockSkew: boolean;
}

/** Max wall-clock compute spent catching up, so returning never means a long wait. */
export const OFFLINE_COMPUTE_BUDGET_MS = 15000;

/**
 * @param msPerTick measured cost of one simulation tick on this device (0 = unknown → no budget clamp)
 */
export function planCatchUp(sim: Sim, nowMs: number, msPerTick = 0): CatchUpPlan {
  const last = sim.s.wallMs;
  const none = { ticks: 0, clamped: false, budgetClamped: false };
  if (!last || nowMs <= last) return { ...none, elapsedSec: 0, clockSkew: nowMs < last };
  const elapsedSec = Math.floor((nowMs - last) / 1000);
  if (elapsedSec < OFFLINE_MIN_SEC) return { ...none, elapsedSec, clockSkew: false };
  const sec = Math.min(elapsedSec, OFFLINE_HORIZON_SEC);
  let ticks = sec * TPS;
  let budgetClamped = false;
  if (msPerTick > 0) {
    const maxTicks = Math.floor(OFFLINE_COMPUTE_BUDGET_MS / msPerTick);
    if (ticks > maxTicks) {
      ticks = Math.max(TPS * 60, maxTicks);
      budgetClamped = true;
    }
  }
  return { ticks, elapsedSec, clamped: sec < elapsedSec, budgetClamped, clockSkew: false };
}

/**
 * Run a catch-up plan in slices so the UI stays responsive. `onProgress` receives 0..1.
 * The wall clock is advanced to `nowMs` only after the whole plan completed (so an interrupted
 * catch-up is retried, never double-granted: partial progress is saved with a matching wallMs).
 */
export async function runCatchUp(
  sim: Sim,
  plan: CatchUpPlan,
  nowMs: number,
  onProgress?: (p: number) => void,
  sliceTicks = 3000,
  yieldFn: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0)),
): Promise<void> {
  const startWall = sim.s.wallMs;
  let done = 0;
  while (done < plan.ticks) {
    const n = Math.min(sliceTicks, plan.ticks - done);
    sim.run(n);
    done += n;
    sim.s.meta.offlineTicksGranted += n;
    // Keep wallMs consistent with the simulated amount so a crash mid-way cannot re-grant.
    sim.s.wallMs = startWall + Math.floor((done / TPS) * 1000);
    sim.ev.drain(); // presentation does not replay offline events one by one
    onProgress?.(done / plan.ticks);
    if (done < plan.ticks) await yieldFn();
  }
  // Time beyond the horizon is forfeited (disclosed), not banked.
  sim.s.wallMs = Math.max(sim.s.wallMs, nowMs);
}

/** Synchronous variant for tests and tools. */
export function catchUpSync(sim: Sim, nowMs: number): CatchUpPlan {
  const plan = planCatchUp(sim, nowMs);
  if (plan.ticks > 0) {
    sim.run(plan.ticks);
    sim.s.meta.offlineTicksGranted += plan.ticks;
    sim.ev.drain();
  }
  if (nowMs > sim.s.wallMs) sim.s.wallMs = nowMs;
  return plan;
}
