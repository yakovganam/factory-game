/**
 * Progression: research unlocks, contract orders, the hand-authored tutorial, and the
 * anti-softlock safety net (community grant).
 */
import type { ContentDB } from '../content/db';
import type { UnlockCondition } from '../content/types';
import { EventBus, post, rngInt } from './core';
import type { GameState, Order } from './types';
import { TICKS_PER_MIN } from './types';

// ---------------------------------------------------------------------------- unlocks
export function conditionMet(s: GameState, c: UnlockCondition): boolean {
  switch (c.t) {
    case 'sold':
      return (s.stats.sold[c.item] ?? 0) >= c.qty;
    case 'produced':
      return (s.stats.produced[c.item] ?? 0) >= c.qty;
    case 'level':
      return Object.values(s.factories).some((f) => f.def === c.building && f.level >= c.level) || Object.values(s.stores).some((st) => st.def === c.building && st.level >= c.level);
    case 'revenue':
      return (s.ledger.total.sales ?? 0) + (s.ledger.total.contracts ?? 0) >= c.cents;
    case 'orders':
      return s.stats.ordersCompleted >= c.count;
  }
}

export type UnlockState = 'owned' | 'available' | 'locked';

export function unlockState(s: GameState, db: ContentDB, id: string): UnlockState {
  if (s.unlocked.includes(id)) return 'owned';
  const u = db.unlocks.get(id);
  if (!u) return 'locked';
  if (!u.requires.every((r) => s.unlocked.includes(r))) return 'locked';
  if (!(u.conditions ?? []).every((c) => conditionMet(s, c))) return 'locked';
  return 'available';
}

export function grantUnlock(s: GameState, id: string, ev: EventBus) {
  if (s.unlocked.includes(id)) return;
  s.unlocked.push(id);
  s.unlocked.sort();
  ev.push({ t: 'unlock', id });
}

// ---------------------------------------------------------------------------- orders
/** Consumer goods the player can currently make (their recipes are unlocked). */
export function makeableGoods(s: GameState, db: ContentDB): string[] {
  const r: string[] = [];
  for (const d of db.demand.values()) {
    const producers = [...db.recipes.values()].filter((x) => x.outputs.some((o) => o.item === d.item));
    if (producers.some((p) => !p.unlock || s.unlocked.includes(p.unlock))) r.push(d.item);
  }
  return r.sort();
}

export const ORDER_SLOTS = 3;
/** At most this many accepted contracts in progress at once. */
export const MAX_ACTIVE_ORDERS = 3;
/** Minimum time between new offers. */
export const ORDER_INTERVAL = 90 * 10;
export const ORDER_OFFER_TICKS = 10 * TICKS_PER_MIN;

export function generateOrder(s: GameState, db: ContentDB, ev: EventBus): Order | null {
  const goods = makeableGoods(s, db);
  const customers = s.buildings.filter((b) => b.role === 'house' || b.role === 'civic');
  if (!goods.length || !customers.length) return null;
  const items: Record<string, number> = {};
  const kinds = goods.length > 1 && rngInt(s, 3) === 0 ? 2 : 1;
  const pool = [...goods];
  // Prefer the newest product so orders pull the player forward.
  for (let k = 0; k < kinds && pool.length; k++) {
    const idx = k === 0 && rngInt(s, 2) === 0 ? pool.length - 1 : rngInt(s, pool.length);
    const item = pool.splice(idx, 1)[0];
    items[item] = 4 + rngInt(s, 9); // 4..12
  }
  let value = 0;
  let units = 0;
  for (const k in items) {
    value += (db.demand.get(k)?.refPrice ?? 0) * items[k];
    units += items[k];
  }
  const reward = Math.round((value * 135) / 100 / 100) * 100;
  const o: Order = {
    id: s.nextId++,
    customer: customers[rngInt(s, customers.length)].id,
    items,
    reward,
    bonus: Math.round(reward / 5 / 100) * 100,
    bonusTick: 0,
    status: 'offered',
    offeredTick: s.tick,
    expireTick: s.tick + ORDER_OFFER_TICKS,
    shipped: {},
  };
  // Bonus window is set when accepted: units × 25 s + 4 min.
  o.bonusTick = units * 25 * 10 + 4 * TICKS_PER_MIN;
  s.orders.push(o);
  ev.push({ t: 'orderOffered', id: o.id });
  return o;
}

export function tickOrders(s: GameState, db: ContentDB, ev: EventBus) {
  if (s.tick % 50 !== 0) return;
  for (const o of s.orders) if (o.status === 'offered' && s.tick >= o.expireTick) o.status = 'withdrawn';
  // Keep history bounded.
  if (s.orders.length > 40) s.orders = s.orders.filter((o) => o.status !== 'withdrawn' && o.status !== 'fulfilled').concat(s.orders.filter((o) => o.status === 'fulfilled').slice(-10));
  // Orders open after the tutorial reaches the contracts step (or is skipped).
  const ordersOpen = s.tutorial.done || s.tutorial.skipped || s.tutorial.step >= TUTORIAL_ORDER_STEP;
  if (!ordersOpen) return;
  const offered = s.orders.filter((o) => o.status === 'offered').length;
  const last = s.orders.reduce((m, o) => Math.max(m, o.offeredTick), -Infinity);
  // First offer arrives promptly; later ones at a steady pace, never more than ORDER_SLOTS waiting.
  if (offered < ORDER_SLOTS && (last === -Infinity || s.tick - last >= ORDER_INTERVAL)) generateOrder(s, db, ev);
}

export function activeOrders(s: GameState): number {
  return s.orders.filter((o) => o.status === 'accepted' || o.status === 'dispatched').length;
}

export function acceptOrder(s: GameState, id: number): boolean {
  const o = s.orders.find((x) => x.id === id);
  if (!o || o.status !== 'offered') return false;
  if (activeOrders(s) >= MAX_ACTIVE_ORDERS) return false;
  o.status = 'accepted';
  o.bonusTick = s.tick + o.bonusTick;
  s.stats.ordersAccepted++;
  return true;
}

// ---------------------------------------------------------------------------- tutorial
export interface TutorialStep {
  id: string;
  /** UI target to highlight (DOM data-tut attribute or world target). */
  target?: string;
  done: (s: GameState) => boolean;
}

const ws = (s: GameState) => Object.values(s.factories)[0];
const hasMachine = (s: GameState, def: string) => !!ws(s)?.entities.some((e) => e.def === def);

export const TUTORIAL: TutorialStep[] = [
  { id: 'welcome', target: 'world:toy_workshop', done: (s) => !!s.tutorial.flags.viewed_interior },
  { id: 'import_wood', target: 'ui:imports', done: (s) => Object.values(s.factories).some((f) => (f.inbound.wood_pieces ?? 0) + (f.incoming.wood_pieces ?? 0) > 0) || (s.stats.produced.block_set ?? 0) > 0 },
  { id: 'place_bench', target: 'ui:build', done: (s) => hasMachine(s, 'assembly_bench') },
  { id: 'bench_recipe', target: 'ui:recipe', done: (s) => !!ws(s)?.entities.some((e) => e.kind === 'machine' && e.def === 'assembly_bench' && e.recipe) },
  { id: 'belt_in', target: 'ui:belt', done: (s) => (s.stats.produced.block_set ?? 0) > 0 },
  { id: 'place_packer', target: 'ui:build', done: (s) => hasMachine(s, 'packing_station') && !!ws(s)?.entities.some((e) => e.kind === 'machine' && e.def === 'packing_station' && e.recipe) },
  { id: 'cartons', target: 'ui:imports', done: (s) => (s.stats.produced.boxed_blocks ?? 0) > 0 },
  { id: 'ship', target: 'ui:belt', done: (s) => Object.values(s.factories).some((f) => (f.outbound.boxed_blocks ?? 0) > 0) || Object.values(s.stores).some((st) => st.shelves.some((sl) => sl.qty > 0) || Object.keys(st.backroom).length > 0 || Object.keys(st.incoming).length > 0) || (s.stats.sold.boxed_blocks ?? 0) > 0 },
  { id: 'first_sale', target: 'world:toy_store', done: (s) => (s.stats.sold.boxed_blocks ?? 0) > 0 },
  { id: 'accept_order', target: 'ui:orders', done: (s) => s.stats.ordersAccepted > 0 },
  { id: 'research_car', target: 'ui:research', done: (s) => s.unlocked.includes('ch1_toy_car') },
];
export const TUTORIAL_ORDER_STEP = TUTORIAL.findIndex((t) => t.id === 'accept_order');

export function tickTutorial(s: GameState, ev: EventBus) {
  const t = s.tutorial;
  if (t.done || t.skipped || s.tick % 5 !== 0) return;
  // Steps can complete out of order if the player is ahead; advance past every satisfied step.
  let moved = false;
  while (t.step < TUTORIAL.length && TUTORIAL[t.step].done(s)) {
    t.step++;
    moved = true;
  }
  if (moved) ev.push({ t: 'tutorial', step: t.step });
  if (t.step >= TUTORIAL.length) t.done = true;
}

// ---------------------------------------------------------------------------- safety net
export const GRANT_CENTS = 40000;
export const GRANT_THRESHOLD = 5000;
export const GRANT_COOLDOWN = 20 * TICKS_PER_MIN;

export function grantAvailable(s: GameState): boolean {
  return s.cash < GRANT_THRESHOLD && s.tick >= s.grant.availableTick;
}

export function claimGrant(s: GameState): boolean {
  if (!grantAvailable(s)) return false;
  post(s, 'grants', GRANT_CENTS);
  s.grant.availableTick = s.tick + GRANT_COOLDOWN;
  s.stats.grantsClaimed++;
  return true;
}
