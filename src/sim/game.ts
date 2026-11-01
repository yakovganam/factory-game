/**
 * Simulation driver: new game creation, the fixed-step tick, and the command boundary.
 * Presentation calls `sim.exec(cmd)` between ticks and drains `sim.ev` each frame.
 */
import type { ContentDB } from '../content/db';
import { EventBus } from './core';
import { levelDef, syncBays, tickFactory } from './factory';
import { orderImport, tickDispatch, tickVehicles, VAN_CAPACITY, VAN_SPEED } from './logistics';
import { STORE_SHELVES, tickStore, tickTrends, TREND_EVERY } from './market';
import { tickOrders, tickTutorial } from './progression';
import type { FactoryState, GameState, StoreState, Vehicle } from './types';
import { SAVE_VERSION } from './types';
import { initialWorld } from './world';
import { execCommand, type Command, type CmdResult } from './commands';

export const START_CASH = 120000;
export const START_POPULATION = 1000;
export const START_WORKFORCE = 40;
export const START_STAFF = 2;

export function newFactory(db: ContentDB, id: string, def: string, tick: number): FactoryState {
  const lv = levelDef(db, def, 1);
  const f: FactoryState = {
    id, def, level: 1, w: lv.interior[0], h: lv.interior[1], layoutVersion: 0, entities: [], nextEntityId: 1,
    staff: START_STAFF, inbound: {}, incoming: {}, outbound: {}, reserved: {}, autoImport: {},
    acc: { energyWT: 0, maintCT: 0, wageCT: 0 }, powerW: 0, powerCapW: lv.powerCapKw * 1000, upgradeTicks: 0,
  };
  syncBays(db, f, tick);
  return f;
}

export function newStore(db: ContentDB, id: string, def: string): StoreState {
  const b = db.buildings.get(def)!;
  const sh = STORE_SHELVES[0];
  const st: StoreState = {
    id, def, level: 1,
    shelves: Array.from({ length: sh.n }, () => ({ item: null, qty: 0, cap: sh.cap })),
    backroom: {}, backroomCap: 60, prices: {}, staff: 1, demandAcc: {}, queue: [], serviceAcc: 0, shelveCd: 0,
    incoming: {}, restock: true, acc: { wageCT: 0 },
    minute: { sold: 0, lost: 0, lostQueue: 0 }, lastMinute: { sold: 0, lost: 0, lostQueue: 0 },
  };
  for (const item of b.sells ?? []) st.prices[item] = db.demand.get(item)?.refPrice ?? 0;
  st.shelves[0].item = b.sells?.[0] ?? null;
  return st;
}

export function newGame(db: ContentDB, seed: number, wallMs = 0): GameState {
  const s: GameState = {
    version: SAVE_VERSION, seed, rng: seed | 0, tick: 0, uid: 1, cash: 0,
    ledger: { total: {}, minutes: [], cogs: 0 },
    stats: { produced: {}, consumed: {}, imported: {}, soldBack: {}, sold: {}, shipped: {}, lostSales: {}, ordersCompleted: 0, ordersAccepted: 0, grantsClaimed: 0, lastSaleTick: 0 },
    factories: {}, stores: {}, buildings: [], nodes: [], edges: [], vehicles: [], shipments: [], orders: [], nextId: 1,
    population: START_POPULATION, workforce: START_WORKFORCE, unlocked: [],
    trend: { item: null, untilTick: 0, next: null, nextTick: TREND_EVERY },
    tutorial: { step: 0, done: false, skipped: false, flags: {} },
    grant: { availableTick: 0 },
    wallMs,
    meta: { created: wallMs, playTicks: 0, offlineTicksGranted: 0 },
  };
  s.cash = START_CASH; // opening capital is equity, not revenue
  initialWorld(s);
  for (const b of s.buildings) {
    if (b.role === 'factory') {
      s.factories[b.id] = newFactory(db, b.id, b.def, 0);
      const van: Vehicle = {
        id: s.nextId++, kind: 'van', owner: 'player', home: b.id, capacity: VAN_CAPACITY, speed: VAN_SPEED,
        state: 'idle', path: [b.access], seg: 0, segPos: 0, timer: 0, shipment: null, cargo: {}, at: b.access, odometer: 0,
      };
      s.vehicles.push(van);
    } else if (b.role === 'store') s.stores[b.id] = newStore(db, b.id, b.def);
  }
  return s;
}

export class Sim {
  readonly ev = new EventBus();
  /** Commands applied since creation, with the tick they were applied at (replay/debug). */
  readonly log: { tick: number; cmd: Command }[] = [];

  constructor(public readonly db: ContentDB, public s: GameState) {}

  step(): void {
    const s = this.s;
    const db = this.db;
    for (const id of Object.keys(s.factories).sort()) tickFactory(s, db, s.factories[id], this.ev);
    tickVehicles(s, db, this.ev);
    tickDispatch(s, db, this.ev);
    for (const id of Object.keys(s.stores).sort()) tickStore(s, db, s.stores[id], this.ev);
    tickTrends(s, db, this.ev);
    tickOrders(s, db, this.ev);
    tickAutoImport(s, db, this.ev);
    tickTutorial(s, this.ev);
    s.tick++;
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  exec(cmd: Command): CmdResult {
    const r = execCommand(this.s, this.db, cmd, this.ev);
    if (r.ok) this.log.push({ tick: this.s.tick, cmd });
    return r;
  }
}

/** Manager policy: reorder imports below a threshold (requires the Purchasing Manager unlock). */
function tickAutoImport(s: GameState, db: ContentDB, ev: EventBus) {
  if (s.tick % 50 !== 25 || !s.unlocked.includes('ch1_auto_import')) return;
  for (const fid of Object.keys(s.factories).sort()) {
    const f = s.factories[fid];
    for (const item of Object.keys(f.autoImport).sort()) {
      const p = f.autoImport[item];
      if (!p.enabled || p.qty <= 0) continue;
      if ((f.inbound[item] ?? 0) + (f.incoming[item] ?? 0) >= p.threshold) continue;
      const r = orderImport(s, db, fid, { [item]: p.qty }, ev);
      if (!r.ok && s.tick % 600 === 25) ev.push({ t: 'notify', key: 'note.auto_import_failed', params: { item: `item.${item}`, reason: r.reason }, sev: 'warn' });
    }
  }
}
