/**
 * Core helpers: seeded RNG, money/ledger accounting, events, and invariant guards.
 * All arithmetic is integer; any non-safe-integer result throws (overflow guard).
 */
import type { Account, GameState, Ledger } from './types';
import { TICKS_PER_MIN } from './types';

// ---------------------------------------------------------------------------- RNG
/** mulberry32 — tiny, fast, deterministic across JS engines (pure 32-bit integer ops). */
export function rngNext(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
/** Integer in [0, n). */
export function rngInt(s: GameState, n: number): number {
  return rngNext(s) % n;
}

// ---------------------------------------------------------------------------- money
export const MAX_CENTS = Number.MAX_SAFE_INTEGER;

export function safeAdd(a: number, b: number): number {
  const r = a + b;
  if (!Number.isSafeInteger(r)) throw new RangeError(`money overflow: ${a} + ${b}`);
  return r;
}

function bucket(ledger: Ledger, tick: number) {
  const m = Math.floor(tick / TICKS_PER_MIN);
  let last = ledger.minutes[ledger.minutes.length - 1];
  if (!last || last.m !== m) {
    last = { m, a: {} };
    ledger.minutes.push(last);
    if (ledger.minutes.length > 60) ledger.minutes.shift();
  }
  return last;
}

/**
 * Post a cash movement. `cents` is signed: positive = cash in. Every cash change in the
 * simulation MUST go through here so the ledger always reconciles with cash.
 */
export function post(s: GameState, account: Account, cents: number): void {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`non-integer money: ${cents}`);
  if (cents === 0) return;
  s.cash = safeAdd(s.cash, cents);
  s.ledger.total[account] = safeAdd(s.ledger.total[account] ?? 0, cents);
  const b = bucket(s.ledger, s.tick);
  b.a[account] = safeAdd(b.a[account] ?? 0, cents);
}

/** Discretionary spending: refuses (returns false) if cash is insufficient. */
export function trySpend(s: GameState, account: Account, cents: number): boolean {
  if (cents < 0) throw new RangeError('trySpend expects a positive cost');
  if (s.cash < cents) return false;
  post(s, account, -cents);
  return true;
}

// ---------------------------------------------------------------------------- inventory helpers
export function addQty(rec: Record<string, number>, item: string, q: number): void {
  const v = (rec[item] ?? 0) + q;
  if (v < 0) throw new RangeError(`negative inventory for ${item}: ${v}`);
  if (v === 0) delete rec[item];
  else rec[item] = v;
}
export function qty(rec: Record<string, number>, item: string): number {
  return rec[item] ?? 0;
}
export function sumQty(rec: Record<string, number>): number {
  let n = 0;
  for (const k in rec) n += rec[k];
  return n;
}

// ---------------------------------------------------------------------------- events
export type SimEvent =
  | { t: 'craft'; f: string; e: number; recipe: string }
  | { t: 'start'; f: string; e: number }
  | { t: 'stall'; f: string; e: number; status: string; item?: string }
  | { t: 'sale'; store: string; item: string; price: number }
  | { t: 'lostSale'; store: string; item: string; reason: 'stock' | 'queue' | 'price' }
  | { t: 'dock'; f: string; e: number; item: string; dir: 'in' | 'out' }
  | { t: 'vehicle'; v: number; what: 'depart' | 'arrive' | 'loaded' | 'unloaded' }
  | { t: 'delivered'; shipment: number; kind: string; to: string }
  | { t: 'orderOffered'; id: number }
  | { t: 'orderDone'; id: number; reward: number; bonus: number }
  | { t: 'unlock'; id: string }
  | { t: 'level'; building: string; level: number }
  | { t: 'tutorial'; step: number }
  | { t: 'trend'; item: string; phase: 'soon' | 'start' | 'end' }
  | { t: 'notify'; key: string; params?: Record<string, string | number>; sev: 'info' | 'warn' | 'good' };

export class EventBus {
  list: SimEvent[] = [];
  push(e: SimEvent) {
    // Bounded: presentation drains every frame; during fast-forward we keep only the latest.
    if (this.list.length > 4000) this.list.splice(0, 2000);
    this.list.push(e);
  }
  drain(): SimEvent[] {
    const l = this.list;
    this.list = [];
    return l;
  }
}

// ---------------------------------------------------------------------------- hashing (determinism tests)
/** Stable FNV-1a hash of the JSON state (keys sorted). */
export function hashState(s: unknown): string {
  const json = stableStringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}
