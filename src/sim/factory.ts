/**
 * Factory interior simulation: conveyor belts, recipe machines, loading bays, storage,
 * splitters, staffing, power and running costs. Fixed-step, integer, deterministic.
 *
 * Rules the player can learn:
 *  - Belts pointing INTO a machine feed it; belts pointing AWAY from a machine carry its output.
 *  - A machine starts a cycle only with a worker, all inputs, room in its output buffer and spare power.
 *  - A full output buffer blocks the machine; a missing input starves it. The UI shows which item.
 */
import type { ContentDB } from '../content/db';
import { footprintOf } from '../content/db';
import type { BuildingLevelDef, MachineDef, RecipeDef } from '../content/types';
import { addQty, EventBus, post, qty, rngInt, sumQty } from './core';
import type { BeltEntity, Dir, Entity, FactoryState, GameState, MachineEntity } from './types';
import { DX, DY, TPS, TICKS_PER_MIN } from './types';

export const BELT_SPACING = 340; // min gap between items on a belt (tile = 1000)
export const BELT_MAX_ITEMS = 3;
export const BELT_BASE_SPEED = 125; // units per tick at 100% (1.25 tiles/s)
export const DOCK_INTERVAL = 4; // ticks between items unloaded per receiving dock
export const WAGE_PER_MIN = 120; // cents per hired worker per minute
export const ENERGY_CENTS_PER_KWMIN = 4;
const WT_PER_CENT = Math.round((1000 * TICKS_PER_MIN) / ENERGY_CENTS_PER_KWMIN);
export const UPGRADE_SECONDS = 30;

// ---------------------------------------------------------------------------- derived caches
interface Derived {
  v: number;
  w: number;
  grid: Int32Array; // entity id per tile (0 = empty)
  byId: Map<number, Entity>;
  outBelts: Map<number, BeltEntity[]>; // machine id -> belts carrying its output
}
const cache = new WeakMap<FactoryState, Derived>();

export function derived(f: FactoryState, db: ContentDB): Derived {
  const c = cache.get(f);
  if (c && c.v === f.layoutVersion && c.w === f.w * 1000 + f.h) return c;
  const grid = new Int32Array(f.w * f.h);
  const byId = new Map<number, Entity>();
  for (const e of f.entities) {
    byId.set(e.id, e);
    const [fw, fh] = entityFootprint(db, e);
    for (let y = e.y; y < e.y + fh; y++)
      for (let x = e.x; x < e.x + fw; x++) if (x >= 0 && y >= 0 && x < f.w && y < f.h) grid[y * f.w + x] = e.id;
  }
  const outBelts = new Map<number, BeltEntity[]>();
  for (const e of f.entities) {
    if (e.kind !== 'belt') continue;
    const bx = e.x - DX[e.rot];
    const by = e.y - DY[e.rot];
    if (bx < 0 || by < 0 || bx >= f.w || by >= f.h) continue;
    const src = byId.get(grid[by * f.w + bx]);
    if (src && src.kind === 'machine') {
      const arr = outBelts.get(src.id) ?? [];
      arr.push(e);
      outBelts.set(src.id, arr);
    }
  }
  const d: Derived = { v: f.layoutVersion, w: f.w * 1000 + f.h, grid, byId, outBelts };
  cache.set(f, d);
  return d;
}

export function entityFootprint(db: ContentDB, e: { def: string; rot: number }): [number, number] {
  const m = db.machines.get(e.def);
  return m ? footprintOf(m, e.rot) : [1, 1];
}

export function entityAt(f: FactoryState, db: ContentDB, x: number, y: number): Entity | undefined {
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return undefined;
  const d = derived(f, db);
  const id = d.grid[y * f.w + x];
  return id ? d.byId.get(id) : undefined;
}

export function levelDef(db: ContentDB, defId: string, level: number): BuildingLevelDef {
  const b = db.buildings.get(defId);
  if (!b) throw new Error(`unknown building ${defId}`);
  return b.levels[Math.min(level, b.levels.length) - 1];
}

// ---------------------------------------------------------------------------- placement
export type PlaceCheck = { ok: true } | { ok: false; reason: string; params?: Record<string, string | number> };

export function checkPlacement(
  db: ContentDB,
  f: FactoryState,
  def: string,
  x: number,
  y: number,
  rot: Dir,
  ignoreId = 0,
): PlaceCheck {
  const m = db.machines.get(def);
  if (!m) return { ok: false, reason: 'err.unknown_machine' };
  if (!m.buildings.includes(f.def)) return { ok: false, reason: 'err.machine_not_allowed' };
  const [fw, fh] = footprintOf(m, rot);
  if (x < 0 || y < 0 || x + fw > f.w || y + fh > f.h) return { ok: false, reason: 'err.out_of_bounds' };
  const d = derived(f, db);
  for (let yy = y; yy < y + fh; yy++)
    for (let xx = x; xx < x + fw; xx++) {
      const id = d.grid[yy * f.w + xx];
      if (id && id !== ignoreId) {
        const other = d.byId.get(id)!;
        return { ok: false, reason: 'err.tile_occupied', params: { what: `machine.${other.def}` } };
      }
    }
  return { ok: true };
}

export function newMachineEntity(id: number, def: string, x: number, y: number, rot: Dir, tick: number): MachineEntity {
  return { id, kind: 'machine', def, x, y, rot, tier: 0, placedTick: tick, recipe: null, inv: {}, out: {}, progress: 0, working: false, status: 'idle', rr: 0, cd: 0, workTicks: 0, worker: -1 };
}

export function newBeltEntity(id: number, x: number, y: number, rot: Dir, tick: number): BeltEntity {
  return { id, kind: 'belt', def: 'belt', x, y, rot, tier: 0, placedTick: tick, items: [] };
}

/** Rebuild fixed bays for the factory's current level (keeps existing bay state when position matches). */
export function syncBays(db: ContentDB, f: FactoryState, tick: number): void {
  const lv = levelDef(db, f.def, f.level);
  for (const bay of lv.bays) {
    const exists = f.entities.find((e) => e.def === bay.machine && e.x === bay.x && e.y === bay.y);
    if (exists) continue;
    const m = newMachineEntity(f.nextEntityId++, bay.machine, bay.x, bay.y, bay.rot, tick);
    m.filter = null;
    f.entities.push(m);
  }
  f.entities.sort((a, b) => a.id - b.id);
  f.layoutVersion++;
}

// ---------------------------------------------------------------------------- acceptance
function beltCanTake(b: BeltEntity): boolean {
  const n = b.items.length;
  return n < BELT_MAX_ITEMS && (n === 0 || b.items[n - 1].pos >= BELT_SPACING);
}

function machineAccept(s: GameState, db: ContentDB, f: FactoryState, m: MachineEntity, item: string, ev: EventBus): boolean {
  const def = db.machines.get(m.def)!;
  switch (def.role) {
    case 'receiving':
      return false;
    case 'shipping': {
      const lv = levelDef(db, f.def, f.level);
      if (sumQty(f.outbound) >= lv.outboundCap) return false;
      addQty(f.outbound, item, 1);
      m.cd = 20;
      ev.push({ t: 'dock', f: f.id, e: m.id, item, dir: 'in' });
      return true;
    }
    case 'storage': {
      const q = (m.queue ??= []);
      if (q.length >= (def.storageCap ?? 0)) return false;
      q.push(item);
      return true;
    }
    case 'splitter': {
      const q = (m.queue ??= []);
      if (q.length >= 1) return false;
      q.push(item);
      return true;
    }
    default: {
      if (!m.recipe) return false;
      const r = db.recipes.get(m.recipe);
      if (!r) return false;
      const need = r.inputs.find((i) => i.item === item);
      if (!need) return false;
      if (qty(m.inv, item) >= need.qty * Math.max(1, def.inputCrafts)) return false;
      addQty(m.inv, item, 1);
      return true;
    }
  }
}

/** Why a belt end is stuck (for the UI). */
export function beltBlockReason(f: FactoryState, db: ContentDB, b: BeltEntity): { key: string; item?: string; target?: string } | null {
  const front = b.items[0];
  if (!front || front.pos < 1000) return null;
  const t = entityAt(f, db, b.x + DX[b.rot], b.y + DY[b.rot]);
  if (!t) return { key: 'block.belt_end', item: front.item };
  if (t.kind === 'belt') {
    if ((t.rot + 2) % 4 === b.rot) return { key: 'block.belt_head_on', item: front.item };
    return { key: 'block.belt_full', item: front.item };
  }
  const def = db.machines.get(t.def)!;
  if (def.role === 'receiving') return { key: 'block.into_receiving', item: front.item };
  if (def.role === 'shipping') return { key: 'block.shipping_full', item: front.item };
  if (def.role === 'storage' || def.role === 'splitter') return { key: 'block.storage_full', item: front.item, target: t.def };
  if (!t.recipe) return { key: 'block.no_recipe', item: front.item, target: t.def };
  const r = db.recipes.get(t.recipe)!;
  if (!r.inputs.some((i) => i.item === front.item)) return { key: 'block.wrong_item', item: front.item, target: t.recipe };
  return { key: 'block.input_full', item: front.item, target: t.def };
}

function pushToOutput(s: GameState, f: FactoryState, m: MachineEntity, belts: BeltEntity[] | undefined, item: string): boolean {
  if (!belts || belts.length === 0) return false;
  for (let k = 0; k < belts.length; k++) {
    const b = belts[(m.rr + k) % belts.length];
    if (beltCanTake(b)) {
      b.items.push({ uid: s.uid++, item, pos: 0, t: s.tick });
      m.rr = (m.rr + k + 1) % belts.length;
      return true;
    }
  }
  return false;
}

function firstKey(rec: Record<string, number>, rr: number): string | undefined {
  const keys = Object.keys(rec).sort();
  if (keys.length === 0) return undefined;
  return keys[rr % keys.length];
}

export function recipeTicks(db: ContentDB, r: RecipeDef): number {
  return r.durationSec * TPS * 100;
}

function speedPct(def: MachineDef, tier: number): number {
  return def.speedPct[Math.min(tier, def.speedPct.length - 1)] ?? 100;
}

// ---------------------------------------------------------------------------- tick
export function tickFactory(s: GameState, db: ContentDB, f: FactoryState, ev: EventBus): void {
  const d = derived(f, db);
  const lv = levelDef(db, f.def, f.level);
  const capW = lv.powerCapKw * 1000;
  f.powerCapW = capW;

  // Construction of an upgrade proceeds while production continues.
  if (f.upgradeTicks > 0) {
    f.upgradeTicks--;
    if (f.upgradeTicks === 0) applyLevel(s, db, f, f.level + 1, ev);
  }

  // Staffing: hired workers are assigned to staffed machines in placement order.
  let workers = f.staff;
  let workerIdx = 0;
  for (const e of f.entities) {
    if (e.kind !== 'machine') continue;
    const def = db.machines.get(e.def)!;
    if (def.staff > 0 && workers >= def.staff) {
      workers -= def.staff;
      e.worker = workerIdx++;
    } else e.worker = def.staff > 0 ? -1 : -2; // -2 = automated
  }

  // Power held by running machines and moving belts.
  let usedW = 0;
  let idleW = 0;
  for (const e of f.entities) {
    const pw = db.machinePowerW.get(e.def) ?? 0;
    if (e.kind === 'belt') {
      if (e.items.length) usedW += pw;
    } else if (e.working && e.worker !== -1) usedW += pw;
    else idleW += Math.floor(pw / 10);
  }

  // Machines.
  for (const e of f.entities) {
    if (e.kind !== 'machine') continue;
    const def = db.machines.get(e.def)!;
    const outs = d.outBelts.get(e.id);
    switch (def.role) {
      case 'receiving': {
        if (!e.filter) {
          setStatus(e, 'no_recipe', undefined, f, ev);
          break;
        }
        if (qty(f.inbound, e.filter) === 0) {
          setStatus(e, 'starved', e.filter, f, ev);
          break;
        }
        if (e.cd > 0) {
          e.cd--;
          break;
        }
        if (pushToOutput(s, f, e, outs, e.filter)) {
          addQty(f.inbound, e.filter, -1);
          e.cd = DOCK_INTERVAL;
          setStatus(e, 'working', undefined, f, ev);
          ev.push({ t: 'dock', f: f.id, e: e.id, item: e.filter, dir: 'out' });
        } else setStatus(e, 'blocked', e.filter, f, ev);
        break;
      }
      case 'shipping': {
        if (sumQty(f.outbound) >= lv.outboundCap) setStatus(e, 'blocked', undefined, f, ev);
        else if (e.cd > 0) {
          e.cd--;
          setStatus(e, 'working', undefined, f, ev);
        } else setStatus(e, 'idle', undefined, f, ev);
        break;
      }
      case 'storage':
      case 'splitter': {
        const q = (e.queue ??= []);
        if (q.length && pushToOutput(s, f, e, outs, q[0])) {
          q.shift();
          setStatus(e, 'working', undefined, f, ev);
        } else if (q.length && def.role === 'storage' && q.length >= (def.storageCap ?? 0)) setStatus(e, 'blocked', q[0], f, ev);
        else setStatus(e, q.length ? 'working' : 'idle', undefined, f, ev);
        break;
      }
      default:
        usedW = tickRecipeMachine(s, db, f, e, def, outs, usedW, capW, ev);
    }
  }

  // Belts (id order). Front item transfers when it reaches the tile edge.
  for (const e of f.entities) {
    if (e.kind !== 'belt') continue;
    const def = db.machines.get(e.def)!;
    const speed = Math.floor((BELT_BASE_SPEED * speedPct(def, e.tier)) / 100);
    const items = e.items;
    let i = 0;
    while (i < items.length) {
      const it = items[i];
      if (it.t === s.tick) {
        i++;
        continue;
      }
      const limit = i === 0 ? 1000 : items[i - 1].pos - BELT_SPACING;
      let np = it.pos + speed;
      if (i === 0 && np >= 1000) {
        const tx = e.x + DX[e.rot];
        const ty = e.y + DY[e.rot];
        const target = tx >= 0 && ty >= 0 && tx < f.w && ty < f.h ? d.byId.get(d.grid[ty * f.w + tx]) : undefined;
        let moved = false;
        if (target) {
          if (target.kind === 'belt') {
            if ((target.rot + 2) % 4 !== e.rot && beltCanTake(target)) {
              target.items.push({ uid: it.uid, item: it.item, pos: 0, t: s.tick });
              moved = true;
            }
          } else moved = machineAccept(s, db, f, target, it.item, ev);
        }
        if (moved) {
          items.shift();
          continue; // same index now holds the next item
        }
        np = 1000;
      }
      it.pos = Math.max(it.pos, Math.min(np, limit));
      i++;
    }
  }

  // Running costs (integer accumulators; no money is lost to rounding).
  f.powerW = usedW;
  f.acc.energyWT += usedW + idleW;
  if (f.acc.energyWT >= WT_PER_CENT) {
    const c = Math.floor(f.acc.energyWT / WT_PER_CENT);
    f.acc.energyWT -= c * WT_PER_CENT;
    post(s, 'energy', -c);
  }
  f.acc.wageCT += f.staff * WAGE_PER_MIN;
  if (f.acc.wageCT >= TICKS_PER_MIN) {
    const c = Math.floor(f.acc.wageCT / TICKS_PER_MIN);
    f.acc.wageCT -= c * TICKS_PER_MIN;
    post(s, 'wages', -c);
  }
  if (f.acc.maintCT >= TICKS_PER_MIN) {
    const c = Math.floor(f.acc.maintCT / TICKS_PER_MIN);
    f.acc.maintCT -= c * TICKS_PER_MIN;
    post(s, 'maintenance', -c);
  }
}

function setStatus(e: MachineEntity, st: MachineEntity['status'], item: string | undefined, f: FactoryState, ev: EventBus) {
  if (e.status !== st || e.statusItem !== item) {
    const wasWorking = e.status === 'working';
    e.status = st;
    e.statusItem = item;
    if (st === 'starved' || st === 'blocked' || st === 'no_power' || st === 'no_worker') {
      if (wasWorking) ev.push({ t: 'stall', f: f.id, e: e.id, status: st, item });
    }
  }
}

function tickRecipeMachine(
  s: GameState,
  db: ContentDB,
  f: FactoryState,
  e: MachineEntity,
  def: MachineDef,
  outs: BeltEntity[] | undefined,
  usedW: number,
  capW: number,
  ev: EventBus,
): number {
  // Push finished goods first so a full buffer can drain.
  const k = firstKey(e.out, e.rr);
  if (k && pushToOutput(s, f, e, outs, k)) addQty(e.out, k, -1);

  const r = e.recipe ? db.recipes.get(e.recipe) : undefined;
  if (!r) {
    setStatus(e, 'no_recipe', undefined, f, ev);
    return usedW;
  }
  const hasWorker = def.staff === 0 || e.worker >= 0;
  const pw = db.machinePowerW.get(def.id) ?? 0;
  if (e.working) {
    if (!hasWorker) {
      setStatus(e, 'no_worker', undefined, f, ev);
      return usedW;
    }
    e.progress += speedPct(def, e.tier);
    e.workTicks++;
    f.acc.maintCT += def.maintenancePerMin;
    if (e.progress >= recipeTicks(db, r)) {
      for (const o of r.outputs) {
        const chance = o.chancePermille ?? 1000;
        if (chance >= 1000 || rngInt(s, 1000) < chance) {
          addQty(e.out, o.item, o.qty);
          s.stats.produced[o.item] = (s.stats.produced[o.item] ?? 0) + o.qty;
        }
      }
      e.working = false;
      e.progress = 0;
      usedW -= pw; // release the power it held; it may immediately re-acquire it below
      ev.push({ t: 'craft', f: f.id, e: e.id, recipe: r.id });
    } else {
      setStatus(e, 'working', undefined, f, ev);
      return usedW;
    }
  }
  // Try to start a new cycle.
  if (!hasWorker) {
    setStatus(e, 'no_worker', undefined, f, ev);
    return usedW;
  }
  for (const i of r.inputs) {
    if (qty(e.inv, i.item) < i.qty) {
      setStatus(e, 'starved', i.item, f, ev);
      return usedW;
    }
  }
  let outQty = 0;
  for (const o of r.outputs) outQty += o.qty;
  if (sumQty(e.out) + outQty > def.outputCap) {
    setStatus(e, 'blocked', firstKey(e.out, 0), f, ev);
    return usedW;
  }
  if (usedW + pw > capW) {
    setStatus(e, 'no_power', undefined, f, ev);
    return usedW;
  }
  for (const i of r.inputs) {
    addQty(e.inv, i.item, -i.qty);
    s.stats.consumed[i.item] = (s.stats.consumed[i.item] ?? 0) + i.qty;
  }
  e.working = true;
  e.progress = 0;
  if (e.status !== 'working') ev.push({ t: 'start', f: f.id, e: e.id });
  setStatus(e, 'working', undefined, f, ev);
  return usedW + pw;
}

export function applyLevel(s: GameState, db: ContentDB, f: FactoryState, level: number, ev: EventBus) {
  const lv = levelDef(db, f.def, level);
  f.level = level;
  // Expansion only grows toward +x/+y so every existing entity keeps its coordinates.
  f.w = Math.max(f.w, lv.interior[0]);
  f.h = Math.max(f.h, lv.interior[1]);
  syncBays(db, f, s.tick);
  ev.push({ t: 'level', building: f.id, level });
}

/** Units of each item currently inside a factory (belts, buffers, docks) — used by conservation tests. */
export function factoryContents(f: FactoryState): Record<string, number> {
  const r: Record<string, number> = {};
  const add = (k: string, n: number) => (r[k] = (r[k] ?? 0) + n);
  for (const k in f.inbound) add(k, f.inbound[k]);
  for (const k in f.outbound) add(k, f.outbound[k]);
  for (const e of f.entities) {
    if (e.kind === 'belt') for (const it of e.items) add(it.item, 1);
    else {
      for (const k in e.inv) add(k, e.inv[k]);
      for (const k in e.out) add(k, e.out[k]);
      for (const k of e.queue ?? []) add(k, 1);
    }
  }
  return r;
}
