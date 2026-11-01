/**
 * Retail: finite, explainable demand.
 *
 *   customers/min = base(per 1000 residents) × residents/1000 × priceFactor × trend × storeAppeal
 *   priceFactor   = 1.6 − 0.6 × price/refPrice   (clamped 0..1.6)  → at ref price 1.0; +10% price ≈ −6% customers
 *
 * Customers who find an empty shelf, or a checkout queue that is too long, leave: that is
 * recorded as unmet demand with the reason so the UI can suggest a fix.
 */
import type { ContentDB } from '../content/db';
import { addQty, EventBus, post, qty, rngInt } from './core';
import { shelfQty } from './logistics';
import type { GameState, StoreState } from './types';
import { TICKS_PER_MIN } from './types';

export const UNIT_ACC = 1000 * TICKS_PER_MIN; // milli-units × ticks per unit
export const CHECKOUT_TICKS = 30; // ticks per customer per cashier
export const QUEUE_PER_CASHIER = 6;
export const SHELVE_TICKS = 5; // ticks per unit moved backroom -> shelf per staff
export const STORE_WAGE_PER_MIN = 100;
export const TREND_PERMILLE = 1400;
export const TREND_EVERY = 8 * TICKS_PER_MIN;
export const TREND_LENGTH = 3 * TICKS_PER_MIN;
export const TREND_NOTICE = 2 * TICKS_PER_MIN;
const APPEAL = [1000, 1250, 1500];
/** Shelves per store level and units per shelf. */
export const STORE_SHELVES: { n: number; cap: number }[] = [
  { n: 2, cap: 20 },
  { n: 3, cap: 24 },
  { n: 4, cap: 30 },
];

export function priceFactorPermille(price: number, ref: number): number {
  if (ref <= 0) return 0;
  const pf = 1600 - Math.floor((600 * price) / ref);
  return Math.max(0, Math.min(1600, pf));
}

/** Expected customers per minute (milli) for an item at a store. Pure — used by UI forecasts too. */
export function demandMilliPerMin(s: GameState, db: ContentDB, st: StoreState, item: string, price?: number): number {
  const d = db.demand.get(item);
  if (!d) return 0;
  const p = price ?? st.prices[item] ?? d.refPrice;
  let r = Math.floor((d.baseMilliPerMinPer1000 * s.population) / 1000);
  r = Math.floor((r * priceFactorPermille(p, d.refPrice)) / 1000);
  if (s.trend.item === item) r = Math.floor((r * TREND_PERMILLE) / 1000);
  r = Math.floor((r * APPEAL[Math.min(st.level, 3) - 1]) / 1000);
  return r;
}

export function tickStore(s: GameState, db: ContentDB, st: StoreState, ev: EventBus): void {
  // Minute rollover for UI counters.
  if (s.tick % TICKS_PER_MIN === 0) {
    st.lastMinute = st.minute;
    st.minute = { sold: 0, lost: 0, lostQueue: 0 };
  }
  const staff = Math.max(0, st.staff);

  // Staff restock shelves from the backroom.
  if (staff > 0) {
    if (st.shelveCd > 0) st.shelveCd--;
    else {
      for (const sl of st.shelves) {
        if (!sl.item || sl.qty >= sl.cap) continue;
        if (qty(st.backroom, sl.item) > 0) {
          addQty(st.backroom, sl.item, -1);
          sl.qty++;
          st.shelveCd = Math.max(1, Math.floor(SHELVE_TICKS / staff));
          break;
        }
      }
    }
  }

  // Customer arrivals per offered item (items not on any shelf are not offered).
  const offered = new Set<string>();
  for (const sl of st.shelves) if (sl.item) offered.add(sl.item);
  for (const item of [...offered].sort()) {
    const rate = demandMilliPerMin(s, db, st, item);
    let acc = (st.demandAcc[item] ?? 0) + rate;
    if (acc >= UNIT_ACC) {
      acc -= UNIT_ACC;
      if (shelfQty(st, item) === 0) {
        s.stats.lostSales[item] = (s.stats.lostSales[item] ?? 0) + 1;
        st.minute.lost++;
        ev.push({ t: 'lostSale', store: st.id, item, reason: 'stock' });
      } else if (st.queue.length >= Math.max(1, staff) * QUEUE_PER_CASHIER) {
        s.stats.lostSales[item] = (s.stats.lostSales[item] ?? 0) + 1;
        st.minute.lostQueue++;
        ev.push({ t: 'lostSale', store: st.id, item, reason: 'queue' });
      } else {
        // Take from the fullest shelf of that item.
        let best = -1;
        for (let i = 0; i < st.shelves.length; i++) {
          const sl = st.shelves[i];
          if (sl.item === item && sl.qty > 0 && (best < 0 || sl.qty > st.shelves[best].qty)) best = i;
        }
        st.shelves[best].qty--;
        const d = db.demand.get(item)!;
        st.queue.push({ item, price: st.prices[item] ?? d.refPrice });
      }
    }
    st.demandAcc[item] = Math.min(acc, UNIT_ACC * 2);
  }

  // Checkout.
  if (st.queue.length && staff > 0) {
    st.serviceAcc += staff;
    if (st.serviceAcc >= CHECKOUT_TICKS) {
      st.serviceAcc -= CHECKOUT_TICKS;
      const c = st.queue.shift()!;
      post(s, 'sales', c.price);
      s.ledger.cogs += db.standardCost.get(c.item) ?? 0;
      s.stats.sold[c.item] = (s.stats.sold[c.item] ?? 0) + 1;
      s.stats.lastSaleTick = s.tick;
      st.minute.sold++;
      ev.push({ t: 'sale', store: st.id, item: c.item, price: c.price });
    }
  } else st.serviceAcc = 0;

  // Store wages.
  st.acc.wageCT += staff * STORE_WAGE_PER_MIN;
  if (st.acc.wageCT >= TICKS_PER_MIN) {
    const c = Math.floor(st.acc.wageCT / TICKS_PER_MIN);
    st.acc.wageCT -= c * TICKS_PER_MIN;
    post(s, 'wages', -c);
  }
}

/** Weekly toy trends: telegraphed two minutes ahead, temporary, never punitive. */
export function tickTrends(s: GameState, db: ContentDB, ev: EventBus): void {
  const t = s.trend;
  if (t.item && s.tick >= t.untilTick) {
    ev.push({ t: 'trend', item: t.item, phase: 'end' });
    t.item = null;
  }
  if (!t.next && s.tick >= t.nextTick - TREND_NOTICE) {
    const pool: string[] = [];
    for (const st of Object.values(s.stores)) for (const sl of st.shelves) if (sl.item && !pool.includes(sl.item)) pool.push(sl.item);
    pool.sort();
    if (pool.length) {
      t.next = pool[rngInt(s, pool.length)];
      ev.push({ t: 'trend', item: t.next, phase: 'soon' });
    } else t.nextTick = s.tick + TREND_EVERY;
  }
  if (t.next && s.tick >= t.nextTick) {
    t.item = t.next;
    t.untilTick = s.tick + TREND_LENGTH;
    t.next = null;
    t.nextTick = s.tick + TREND_EVERY;
    ev.push({ t: 'trend', item: t.item, phase: 'start' });
  }
}
