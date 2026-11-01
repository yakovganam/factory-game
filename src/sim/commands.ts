/**
 * Player commands — the only way presentation mutates the simulation. Every command is
 * validated and either applied atomically or rejected with an i18n reason key + params so the
 * UI can explain what went wrong and how to fix it.
 */
import type { ContentDB } from '../content/db';
import { addQty, EventBus, post, trySpend } from './core';
import { checkPlacement, entityFootprint, levelDef, newBeltEntity, newMachineEntity, UPGRADE_SECONDS } from './factory';
import { orderImport, VAN_CAPACITY, VAN_SPEED } from './logistics';
import { STORE_SHELVES } from './market';
import { acceptOrder, activeOrders, claimGrant, grantUnlock, MAX_ACTIVE_ORDERS, unlockState } from './progression';
import type { Dir, Entity, FactoryState, GameState, ImportPolicy } from './types';
import { TPS } from './types';

export type Command =
  | { t: 'place'; f: string; def: string; x: number; y: number; rot: Dir }
  | { t: 'placeBelts'; f: string; tiles: { x: number; y: number; rot: Dir }[] }
  | { t: 'remove'; f: string; e: number }
  | { t: 'rotate'; f: string; e: number }
  | { t: 'move'; f: string; e: number; x: number; y: number; rot: Dir }
  | { t: 'setRecipe'; f: string; e: number; recipe: string | null }
  | { t: 'setFilter'; f: string; e: number; item: string | null }
  | { t: 'upgradeMachine'; f: string; e: number }
  | { t: 'hire'; f: string; n: number }
  | { t: 'import'; f: string; items: Record<string, number> }
  | { t: 'autoImport'; f: string; item: string; policy: ImportPolicy }
  | { t: 'sellInbound'; f: string; item: string; qty: number }
  | { t: 'storeStaff'; store: string; n: number }
  | { t: 'setPrice'; store: string; item: string; price: number }
  | { t: 'setShelf'; store: string; shelf: number; item: string | null }
  | { t: 'setRestock'; store: string; on: boolean }
  | { t: 'upgradeBuilding'; id: string }
  | { t: 'research'; id: string }
  | { t: 'acceptOrder'; id: number }
  | { t: 'buyVan'; f: string }
  | { t: 'claimGrant' }
  | { t: 'tutorialFlag'; flag: string }
  | { t: 'skipTutorial' };

export type CmdResult = { ok: true; cost?: number; id?: number } | { ok: false; reason: string; params?: Record<string, string | number> };

const fail = (reason: string, params?: Record<string, string | number>): CmdResult => ({ ok: false, reason, params });

export const HIRE_FEE = 2000;
export const VAN_COST = 30000;
/** Early construction is fully reversible: 100% refund within this window or during the tutorial. */
export const FULL_REFUND_TICKS = 60 * TPS;
export const LATE_REFUND_PCT = 50;

export function refundFor(s: GameState, e: Entity, db: ContentDB): number {
  const m = db.machines.get(e.def)!;
  let paid = m.cost;
  for (let i = 1; i <= e.tier; i++) paid += m.upgradeCost[i] ?? 0;
  const full = s.tick - e.placedTick < FULL_REFUND_TICKS || !s.tutorial.done;
  return full ? paid : Math.floor((paid * LATE_REFUND_PCT) / 100);
}

export function maxVans(s: GameState, f: FactoryState): number {
  return 1 + (s.unlocked.includes('ch1_second_van') ? 1 : 0) + (f.level >= 3 ? 1 : 0);
}

export function totalHired(s: GameState): number {
  let n = 0;
  for (const f of Object.values(s.factories)) n += f.staff;
  for (const st of Object.values(s.stores)) n += st.staff;
  return n;
}

function machineAvailable(s: GameState, db: ContentDB, f: FactoryState, def: string): CmdResult | null {
  const m = db.machines.get(def);
  if (!m) return fail('err.unknown_machine');
  if (m.fixed) return fail('err.fixed_bay');
  if (m.unlock && !s.unlocked.includes(m.unlock)) return fail('err.locked', { what: `unlock.${m.unlock}` });
  const b = db.buildings.get(f.def)!;
  const needLevel = b.levels.find((l) => l.unlocksMachines?.includes(def));
  if (needLevel && f.level < needLevel.level) return fail('err.needs_level', { level: needLevel.level });
  return null;
}

/** Return everything held by an entity to the factory's receiving stock (never destroys goods). */
function refundInputs(s: GameState, f: FactoryState, recipe: string, db: ContentDB) {
  const r = db.recipes.get(recipe);
  if (!r) return;
  for (const i of r.inputs) {
    addQty(f.inbound, i.item, i.qty);
    s.stats.consumed[i.item] -= i.qty;
  }
}

function returnContents(s: GameState, f: FactoryState, e: Entity, db: ContentDB) {
  if (e.kind === 'belt') {
    for (const it of e.items) addQty(f.inbound, it.item, 1);
    e.items = [];
    return;
  }
  for (const k in e.inv) addQty(f.inbound, k, e.inv[k]);
  for (const k in e.out) addQty(f.inbound, k, e.out[k]);
  for (const k of e.queue ?? []) addQty(f.inbound, k, 1);
  if (e.working && e.recipe) refundInputs(s, f, e.recipe, db);
  e.inv = {};
  e.out = {};
  e.queue = [];
  e.working = false;
  e.progress = 0;
}

export function execCommand(s: GameState, db: ContentDB, c: Command, ev: EventBus): CmdResult {
  switch (c.t) {
    case 'place': {
      const f = s.factories[c.f];
      if (!f) return fail('err.unknown_building');
      const na = machineAvailable(s, db, f, c.def);
      if (na) return na;
      const chk = checkPlacement(db, f, c.def, c.x, c.y, c.rot);
      if (!chk.ok) return fail(chk.reason, chk.params);
      const m = db.machines.get(c.def)!;
      if (!trySpend(s, 'construction', m.cost)) return fail('err.no_cash', { cost: m.cost });
      const id = f.nextEntityId++;
      f.entities.push(m.role === 'belt' ? newBeltEntity(id, c.x, c.y, c.rot, s.tick) : newMachineEntity(id, c.def, c.x, c.y, c.rot, s.tick));
      f.layoutVersion++;
      // Helpful default: a machine with a single available recipe selects it.
      const ent = f.entities[f.entities.length - 1];
      if (ent.kind === 'machine') {
        const recs = (db.recipesByMachine.get(c.def) ?? []).filter((r) => !r.unlock || s.unlocked.includes(r.unlock));
        if (recs.length === 1) ent.recipe = recs[0].id;
      }
      return { ok: true, cost: m.cost, id };
    }
    case 'placeBelts': {
      const f = s.factories[c.f];
      if (!f) return fail('err.unknown_building');
      const m = db.machines.get('belt')!;
      // Tiles that already hold a belt are re-pointed (free); new tiles are bought.
      let cost = 0;
      const plan: { x: number; y: number; rot: Dir; existing?: Entity }[] = [];
      const seen = new Set<string>();
      for (const t of c.tiles) {
        const key = t.x + ',' + t.y;
        if (seen.has(key)) continue;
        seen.add(key);
        const ex = f.entities.find((e) => e.kind === 'belt' && e.x === t.x && e.y === t.y);
        if (ex) {
          plan.push({ ...t, existing: ex });
          continue;
        }
        const chk = checkPlacement(db, f, 'belt', t.x, t.y, t.rot);
        if (!chk.ok) return fail(chk.reason, { ...chk.params, x: t.x, y: t.y });
        cost += m.cost;
        plan.push(t);
      }
      if (!plan.length) return fail('err.nothing_to_do');
      if (!trySpend(s, 'construction', cost)) return fail('err.no_cash', { cost });
      for (const p of plan) {
        if (p.existing) p.existing.rot = p.rot;
        else f.entities.push(newBeltEntity(f.nextEntityId++, p.x, p.y, p.rot, s.tick));
      }
      f.layoutVersion++;
      return { ok: true, cost };
    }
    case 'remove': {
      const f = s.factories[c.f];
      const idx = f?.entities.findIndex((e) => e.id === c.e) ?? -1;
      if (!f || idx < 0) return fail('err.unknown_entity');
      const e = f.entities[idx];
      if (db.machines.get(e.def)?.fixed) return fail('err.fixed_bay');
      const refund = refundFor(s, e, db);
      returnContents(s, f, e, db);
      f.entities.splice(idx, 1);
      f.layoutVersion++;
      post(s, 'refunds', refund);
      return { ok: true, cost: -refund };
    }
    case 'rotate': {
      const f = s.factories[c.f];
      const e = f?.entities.find((x) => x.id === c.e);
      if (!f || !e) return fail('err.unknown_entity');
      if (db.machines.get(e.def)?.fixed) return fail('err.fixed_bay');
      const rot = ((e.rot + 1) % 4) as Dir;
      const chk = checkPlacement(db, f, e.def, e.x, e.y, rot, e.id);
      if (!chk.ok) return fail(chk.reason, chk.params);
      e.rot = rot;
      f.layoutVersion++;
      return { ok: true };
    }
    case 'move': {
      const f = s.factories[c.f];
      const e = f?.entities.find((x) => x.id === c.e);
      if (!f || !e) return fail('err.unknown_entity');
      if (db.machines.get(e.def)?.fixed) return fail('err.fixed_bay');
      const chk = checkPlacement(db, f, e.def, c.x, c.y, c.rot, e.id);
      if (!chk.ok) return fail(chk.reason, chk.params);
      e.x = c.x;
      e.y = c.y;
      e.rot = c.rot;
      f.layoutVersion++;
      return { ok: true };
    }
    case 'setRecipe': {
      const f = s.factories[c.f];
      const e = f?.entities.find((x) => x.id === c.e);
      if (!f || !e || e.kind !== 'machine') return fail('err.unknown_entity');
      if (c.recipe) {
        const r = db.recipes.get(c.recipe);
        if (!r || r.machine !== e.def) return fail('err.bad_recipe');
        if (r.unlock && !s.unlocked.includes(r.unlock)) return fail('err.locked', { what: `unlock.${r.unlock}` });
      }
      if (e.recipe === c.recipe) return { ok: true };
      // Changeover: loaded and in-progress inputs return to receiving stock; finished outputs stay to drain.
      for (const k in e.inv) addQty(f.inbound, k, e.inv[k]);
      if (e.working && e.recipe) refundInputs(s, f, e.recipe, db);
      e.inv = {};
      e.working = false;
      e.progress = 0;
      e.recipe = c.recipe;
      return { ok: true };
    }
    case 'setFilter': {
      const f = s.factories[c.f];
      const e = f?.entities.find((x) => x.id === c.e);
      if (!f || !e || e.kind !== 'machine' || db.machines.get(e.def)?.role !== 'receiving') return fail('err.unknown_entity');
      e.filter = c.item;
      return { ok: true };
    }
    case 'upgradeMachine': {
      const f = s.factories[c.f];
      const e = f?.entities.find((x) => x.id === c.e);
      if (!f || !e) return fail('err.unknown_entity');
      const m = db.machines.get(e.def)!;
      const next = e.tier + 1;
      if (next >= m.speedPct.length) return fail('err.max_tier');
      if (m.role === 'belt' && !s.unlocked.includes('ch1_belt_mk2')) return fail('err.locked', { what: 'unlock.ch1_belt_mk2' });
      const cost = m.upgradeCost[next] ?? 0;
      if (!trySpend(s, 'construction', cost)) return fail('err.no_cash', { cost });
      e.tier = next;
      return { ok: true, cost };
    }
    case 'hire': {
      const f = s.factories[c.f];
      if (!f) return fail('err.unknown_building');
      const lv = levelDef(db, f.def, f.level);
      if (c.n > 0) {
        if (f.staff + c.n > lv.staffCap) return fail('err.staff_cap', { cap: lv.staffCap });
        if (totalHired(s) + c.n > s.workforce) return fail('err.no_workforce', { free: s.workforce - totalHired(s) });
        if (!trySpend(s, 'hiring', HIRE_FEE * c.n)) return fail('err.no_cash', { cost: HIRE_FEE * c.n });
      } else if (f.staff + c.n < 0) return fail('err.bad_quantity');
      f.staff += c.n;
      return { ok: true };
    }
    case 'import': {
      const r = orderImport(s, db, c.f, c.items, ev);
      return r.ok ? { ok: true, cost: r.cost } : fail(r.reason, r.params);
    }
    case 'autoImport': {
      const f = s.factories[c.f];
      if (!f) return fail('err.unknown_building');
      if (!s.unlocked.includes('ch1_auto_import')) return fail('err.locked', { what: 'unlock.ch1_auto_import' });
      const p = c.policy;
      if (!Number.isSafeInteger(p.qty) || !Number.isSafeInteger(p.threshold) || p.qty < 0 || p.threshold < 0) return fail('err.bad_quantity');
      f.autoImport[c.item] = { ...p };
      return { ok: true };
    }
    case 'sellInbound': {
      const f = s.factories[c.f];
      if (!f) return fail('err.unknown_building');
      const have = f.inbound[c.item] ?? 0;
      if (c.qty <= 0 || c.qty > have) return fail('err.bad_quantity');
      const src = (db.sources.get(c.item) ?? []).find((x) => x.kind === 'import');
      const unit = Math.floor(((src?.unitPrice ?? db.standardCost.get(c.item) ?? 0) * 50) / 100);
      addQty(f.inbound, c.item, -c.qty);
      s.stats.soldBack[c.item] = (s.stats.soldBack[c.item] ?? 0) + c.qty;
      post(s, 'refunds', unit * c.qty);
      return { ok: true, cost: -unit * c.qty };
    }
    case 'storeStaff': {
      const st = s.stores[c.store];
      if (!st) return fail('err.unknown_building');
      const lv = levelDef(db, st.def, st.level);
      if (c.n > 0) {
        if (st.staff + c.n > lv.staffCap) return fail('err.staff_cap', { cap: lv.staffCap });
        if (totalHired(s) + c.n > s.workforce) return fail('err.no_workforce', { free: s.workforce - totalHired(s) });
        if (!trySpend(s, 'hiring', HIRE_FEE * c.n)) return fail('err.no_cash', { cost: HIRE_FEE * c.n });
      } else if (st.staff + c.n < 0) return fail('err.bad_quantity');
      st.staff += c.n;
      return { ok: true };
    }
    case 'setPrice': {
      const st = s.stores[c.store];
      const d = db.demand.get(c.item);
      if (!st || !d) return fail('err.unknown_building');
      const lo = Math.ceil((d.refPrice * 30) / 100);
      const hi = d.refPrice * 3;
      if (!Number.isSafeInteger(c.price) || c.price < lo || c.price > hi) return fail('err.price_range', { lo, hi });
      st.prices[c.item] = c.price;
      return { ok: true };
    }
    case 'setShelf': {
      const st = s.stores[c.store];
      if (!st || c.shelf < 0 || c.shelf >= st.shelves.length) return fail('err.unknown_building');
      const b = db.buildings.get(st.def)!;
      if (c.item && !(b.sells ?? []).includes(c.item)) return fail('err.not_sold_here');
      const sl = st.shelves[c.shelf];
      if (sl.item === c.item) return { ok: true };
      // Stock on the old shelf goes back to the backroom (never destroyed).
      if (sl.item && sl.qty > 0) addQty(st.backroom, sl.item, sl.qty);
      sl.qty = 0;
      sl.item = c.item;
      return { ok: true };
    }
    case 'setRestock': {
      const st = s.stores[c.store];
      if (!st) return fail('err.unknown_building');
      st.restock = c.on;
      return { ok: true };
    }
    case 'upgradeBuilding': {
      const f = s.factories[c.id];
      const st = s.stores[c.id];
      const ent = f ?? st;
      if (!ent) return fail('err.unknown_building');
      const b = db.buildings.get(ent.def)!;
      const next = b.levels[ent.level];
      if (!next) return fail('err.max_level');
      if (f && f.upgradeTicks > 0) return fail('err.upgrade_in_progress');
      if (next.requires && !s.unlocked.includes(next.requires)) return fail('err.locked', { what: `unlock.${next.requires}` });
      if (!trySpend(s, 'construction', next.cost)) return fail('err.no_cash', { cost: next.cost });
      if (f) f.upgradeTicks = UPGRADE_SECONDS * TPS;
      else if (st) {
        st.level = next.level;
        const sh = STORE_SHELVES[Math.min(next.level, STORE_SHELVES.length) - 1];
        for (const sl of st.shelves) sl.cap = sh.cap;
        while (st.shelves.length < sh.n) st.shelves.push({ item: null, qty: 0, cap: sh.cap });
        st.backroomCap += 40;
        ev.push({ t: 'level', building: st.id, level: st.level });
      }
      return { ok: true, cost: next.cost };
    }
    case 'research': {
      const u = db.unlocks.get(c.id);
      if (!u) return fail('err.unknown_unlock');
      const state = unlockState(s, db, c.id);
      if (state === 'owned') return fail('err.already_owned');
      if (state === 'locked') return fail('err.requirements');
      if (!trySpend(s, 'research', u.cost)) return fail('err.no_cash', { cost: u.cost });
      grantUnlock(s, c.id, ev);
      onUnlocked(s, db, c.id);
      return { ok: true, cost: u.cost };
    }
    case 'acceptOrder':
      if (activeOrders(s) >= MAX_ACTIVE_ORDERS) return fail('err.too_many_orders', { n: MAX_ACTIVE_ORDERS });
      return acceptOrder(s, c.id) ? { ok: true } : fail('err.order_unavailable');
    case 'buyVan': {
      const f = s.factories[c.f];
      const b = s.buildings.find((x) => x.id === c.f);
      if (!f || !b) return fail('err.unknown_building');
      const have = s.vehicles.filter((v) => v.owner === 'player' && v.home === c.f).length;
      if (have >= maxVans(s, f)) return fail('err.van_cap', { cap: maxVans(s, f) });
      if (!trySpend(s, 'construction', VAN_COST)) return fail('err.no_cash', { cost: VAN_COST });
      s.vehicles.push({ id: s.nextId++, kind: 'van', owner: 'player', home: c.f, capacity: VAN_CAPACITY, speed: VAN_SPEED, state: 'idle', path: [b.access], seg: 0, segPos: 0, timer: 0, shipment: null, cargo: {}, at: b.access, odometer: 0 });
      return { ok: true, cost: VAN_COST };
    }
    case 'claimGrant':
      return claimGrant(s) ? { ok: true } : fail('err.grant_unavailable');
    case 'tutorialFlag':
      s.tutorial.flags[c.flag] = true;
      return { ok: true };
    case 'skipTutorial':
      s.tutorial.skipped = true;
      return { ok: true };
  }
}

/** Side effects of unlocking content that make new options immediately usable. */
function onUnlocked(s: GameState, db: ContentDB, id: string) {
  // Put a newly unlocked consumer product on an empty shelf so players see it sell.
  for (const r of db.recipes.values()) {
    if (r.unlock !== id) continue;
    for (const o of r.outputs) {
      if (!db.demand.has(o.item)) continue;
      for (const st of Object.values(s.stores)) {
        const b = db.buildings.get(st.def)!;
        if (!(b.sells ?? []).includes(o.item) || st.shelves.some((sl) => sl.item === o.item)) continue;
        const empty = st.shelves.find((sl) => !sl.item);
        if (empty) empty.item = o.item;
      }
    }
  }
}

export { entityFootprint };
