/**
 * City logistics: road graph, deterministic shortest paths, vehicles and shipments.
 *
 * Shipment lifecycle (conservation is tested in tests/economy.test.ts):
 *   created  -> origin stock is RESERVED (still physically at the origin), destination `incoming` is raised
 *   loading  -> reserved units move from origin stock into the vehicle cargo
 *   unloading-> cargo moves into the destination (store backroom / factory inbound / customer)
 * Vehicles are not physics objects: they advance an integer millimetre position along graph edges.
 */
import type { ContentDB } from '../content/db';
import { addQty, EventBus, post, qty, sumQty, trySpend } from './core';
import { levelDef } from './factory';
import type { FactoryState, GameState, Shipment, ShipmentKind, StoreState, Vehicle } from './types';

export const VAN_CAPACITY = 16;
export const TRUCK_CAPACITY = 60;
export const VAN_SPEED = 900; // mm per tick (9 m/s)
export const TRUCK_SPEED = 800;
export const LOAD_BASE_TICKS = 20;
export const LOAD_TICKS_PER_UNIT = 2;
export const FREIGHT_BASE = 150; // cents per van trip
export const FREIGHT_PER_KM = 400; // cents per km driven by a player van
export const IMPORT_FREIGHT_PER_TRUCK = 600; // cents charged by the import depot per truck

// ---------------------------------------------------------------------------- graph
interface Graph {
  adj: Map<number, { to: number; len: number }[]>;
  pos: Map<number, { x: number; z: number }>;
  paths: Map<string, number[] | null>;
}
const graphs = new WeakMap<object, Graph>();

function graph(s: GameState): Graph {
  let g = graphs.get(s.edges);
  if (g) return g;
  g = { adj: new Map(), pos: new Map(), paths: new Map() };
  for (const n of s.nodes) {
    g.pos.set(n.id, n);
    g.adj.set(n.id, []);
  }
  for (const e of s.edges) {
    g.adj.get(e.a)!.push({ to: e.b, len: e.len });
    g.adj.get(e.b)!.push({ to: e.a, len: e.len });
  }
  for (const l of g.adj.values()) l.sort((p, q) => p.to - q.to);
  graphs.set(s.edges, g);
  return g;
}

/** Deterministic Dijkstra (ties broken by node id). Cached per edge-set. */
export function findPath(s: GameState, a: number, b: number): number[] | null {
  const g = graph(s);
  const key = a + '>' + b;
  if (g.paths.has(key)) return g.paths.get(key)!;
  const dist = new Map<number, number>([[a, 0]]);
  const prev = new Map<number, number>();
  const open = new Set<number>([a]);
  while (open.size) {
    let u = -1;
    let best = Infinity;
    for (const n of open) {
      const d = dist.get(n)!;
      if (d < best || (d === best && n < u)) {
        best = d;
        u = n;
      }
    }
    open.delete(u);
    if (u === b) break;
    for (const { to, len } of g.adj.get(u) ?? []) {
      const nd = best + len;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, u);
        open.add(to);
      }
    }
  }
  let path: number[] | null = null;
  if (a === b) path = [a];
  else if (prev.has(b)) {
    path = [b];
    let c = b;
    while (c !== a) {
      c = prev.get(c)!;
      path.push(c);
    }
    path.reverse();
  }
  g.paths.set(key, path);
  return path;
}

export function edgeLen(s: GameState, a: number, b: number): number {
  for (const e of graph(s).adj.get(a) ?? []) if (e.to === b) return e.len;
  return 0;
}

export function pathLen(s: GameState, p: number[]): number {
  let n = 0;
  for (let i = 0; i + 1 < p.length; i++) n += edgeLen(s, p[i], p[i + 1]);
  return n;
}

export function nodePos(s: GameState, id: number) {
  return graph(s).pos.get(id)!;
}

// ---------------------------------------------------------------------------- helpers
export function building(s: GameState, id: string) {
  return s.buildings.find((b) => b.id === id);
}

export function availableOutbound(f: FactoryState, item: string): number {
  return qty(f.outbound, item) - qty(f.reserved, item);
}

function newShipment(s: GameState, kind: ShipmentKind, from: string, to: string, items: Record<string, number>): Shipment {
  const sh: Shipment = { id: s.nextId++, kind, from, to, items, status: 'queued', vehicle: null, createdTick: s.tick, freight: 0 };
  s.shipments.push(sh);
  return sh;
}

// ---------------------------------------------------------------------------- imports
export type ImportResult = { ok: true; cost: number } | { ok: false; reason: string; params?: Record<string, string | number> };

export function importQuote(s: GameState, db: ContentDB, items: Record<string, number>): { goods: number; freight: number; units: number } {
  let goods = 0;
  let units = 0;
  for (const k in items) {
    const src = (db.sources.get(k) ?? []).find((x) => x.kind === 'import');
    if (!src) continue;
    goods += src.unitPrice * items[k];
    units += items[k];
  }
  const trucks = Math.ceil(units / TRUCK_CAPACITY);
  return { goods, freight: trucks * IMPORT_FREIGHT_PER_TRUCK, units };
}

export function orderImport(s: GameState, db: ContentDB, factoryId: string, items: Record<string, number>, ev: EventBus): ImportResult {
  const f = s.factories[factoryId];
  if (!f) return { ok: false, reason: 'err.unknown_building' };
  let units = 0;
  for (const k in items) {
    const n = items[k];
    if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, reason: 'err.bad_quantity' };
    const src = (db.sources.get(k) ?? []).find((x) => x.kind === 'import');
    if (!src) return { ok: false, reason: 'err.no_import_source', params: { item: `item.${k}` } };
    if (src.unlock && !s.unlocked.includes(src.unlock)) return { ok: false, reason: 'err.locked', params: { item: `item.${k}` } };
    units += n;
  }
  if (units === 0) return { ok: false, reason: 'err.bad_quantity' };
  const lv = levelDef(db, f.def, f.level);
  const free = lv.inboundCap - sumQty(f.inbound) - sumQty(f.incoming);
  if (units > free) return { ok: false, reason: 'err.receiving_full', params: { free: Math.max(0, free) } };
  const q = importQuote(s, db, items);
  if (s.cash < q.goods + q.freight) return { ok: false, reason: 'err.no_cash', params: { cost: q.goods + q.freight } };
  trySpend(s, 'imports', q.goods);
  trySpend(s, 'freight', q.freight);

  // Split into trucks; each truck is its own shipment.
  const depot = s.buildings.find((b) => b.role === 'depot')!;
  const fb = building(s, factoryId)!;
  const queue = Object.keys(items)
    .sort()
    .map((k) => [k, items[k]] as [string, number]);
  while (queue.length) {
    const load: Record<string, number> = {};
    let room = TRUCK_CAPACITY;
    while (room > 0 && queue.length) {
      const [k, n] = queue[0];
      const take = Math.min(n, room);
      load[k] = (load[k] ?? 0) + take;
      room -= take;
      if (take === n) queue.shift();
      else queue[0][1] = n - take;
    }
    const sh = newShipment(s, 'import', depot.id, factoryId, load);
    sh.freight = IMPORT_FREIGHT_PER_TRUCK;
    for (const k in load) {
      addQty(f.incoming, k, load[k]);
      s.stats.imported[k] = (s.stats.imported[k] ?? 0) + load[k];
    }
    const path = findPath(s, depot.access, fb.access2 ?? fb.access);
    if (!path) return { ok: false, reason: 'err.no_route' };
    const v: Vehicle = {
      id: s.nextId++, kind: 'truck', owner: 'supplier', home: depot.id, capacity: TRUCK_CAPACITY, speed: TRUCK_SPEED,
      state: 'to_dropoff', path, seg: 0, segPos: 0, timer: 0, shipment: sh.id, cargo: { ...load }, at: depot.access, odometer: 0,
    };
    s.vehicles.push(v);
    sh.vehicle = v.id;
    sh.status = 'in_transit';
    ev.push({ t: 'vehicle', v: v.id, what: 'depart' });
  }
  // Auto-assign an unloading item to idle receiving docks so the first import "just works".
  for (const k of Object.keys(items).sort()) {
    const docks = f.entities.filter((e) => e.kind === 'machine' && e.def.includes('receiving'));
    if (docks.some((d) => d.kind === 'machine' && d.filter === k)) continue;
    const free = docks.find((d) => d.kind === 'machine' && !d.filter);
    if (free && free.kind === 'machine') free.filter = k;
  }
  return { ok: true, cost: q.goods + q.freight };
}

// ---------------------------------------------------------------------------- dispatch
/** Create a van shipment from a factory's outbound stock. Reserves stock and charges freight. */
export function dispatch(
  s: GameState,
  db: ContentDB,
  kind: 'restock' | 'order',
  factoryId: string,
  to: string,
  items: Record<string, number>,
  ev: EventBus,
  orderId?: number,
): Shipment | null {
  const f = s.factories[factoryId];
  const van = s.vehicles.find((v) => v.owner === 'player' && v.home === factoryId && v.state === 'idle');
  if (!f || !van) return null;
  let units = 0;
  for (const k in items) {
    if (items[k] <= 0 || availableOutbound(f, k) < items[k]) return null;
    units += items[k];
  }
  if (units === 0 || units > van.capacity) return null;
  const fb = building(s, factoryId)!;
  const tb = building(s, to)!;
  const p1 = findPath(s, van.at, fb.access);
  const p2 = findPath(s, fb.access, tb.access);
  const p3 = findPath(s, tb.access, fb.access);
  if (!p1 || !p2 || !p3) return null;
  const tripMm = pathLen(s, p1) + pathLen(s, p2) + pathLen(s, p3);
  const freight = FREIGHT_BASE + Math.round((tripMm * FREIGHT_PER_KM) / 1_000_000);
  post(s, 'freight', -freight); // running cost: allowed to dip into overdraft
  const sh = newShipment(s, kind, factoryId, to, items);
  sh.freight = freight;
  sh.orderId = orderId;
  for (const k in items) addQty(f.reserved, k, items[k]);
  if (kind === 'restock') {
    const st = s.stores[to];
    for (const k in items) addQty(st.incoming, k, items[k]);
  }
  sh.vehicle = van.id;
  sh.status = 'assigned';
  van.shipment = sh.id;
  if (p1.length > 1) {
    van.state = 'to_pickup';
    van.path = p1;
  } else {
    van.state = 'loading';
    van.timer = LOAD_BASE_TICKS + LOAD_TICKS_PER_UNIT * units;
    van.path = [fb.access];
  }
  van.seg = 0;
  van.segPos = 0;
  ev.push({ t: 'vehicle', v: van.id, what: 'depart' });
  return sh;
}

// ---------------------------------------------------------------------------- vehicle tick
export function tickVehicles(s: GameState, db: ContentDB, ev: EventBus): void {
  for (let i = 0; i < s.vehicles.length; i++) {
    const v = s.vehicles[i];
    switch (v.state) {
      case 'idle':
        break;
      case 'loading':
      case 'unloading':
        if (--v.timer <= 0) finishStop(s, db, v, ev);
        break;
      default: {
        // moving
        let remaining = v.speed;
        while (remaining > 0 && v.seg < v.path.length - 1) {
          const len = edgeLen(s, v.path[v.seg], v.path[v.seg + 1]);
          const step = Math.min(remaining, len - v.segPos);
          v.segPos += step;
          v.odometer += step;
          remaining -= step;
          if (v.segPos >= len) {
            v.seg++;
            v.segPos = 0;
          }
        }
        if (v.seg >= v.path.length - 1) arrive(s, db, v, ev);
      }
    }
  }
  // Supplier trucks that returned to the depot leave the simulation.
  for (let i = s.vehicles.length - 1; i >= 0; i--) {
    const v = s.vehicles[i];
    if (v.owner === 'supplier' && v.state === 'idle') s.vehicles.splice(i, 1);
  }
}

function shipmentOf(s: GameState, v: Vehicle) {
  return v.shipment !== null ? s.shipments.find((x) => x.id === v.shipment) : undefined;
}

function arrive(s: GameState, db: ContentDB, v: Vehicle, ev: EventBus) {
  v.at = v.path[v.path.length - 1];
  v.seg = 0;
  v.segPos = 0;
  const sh = shipmentOf(s, v);
  ev.push({ t: 'vehicle', v: v.id, what: 'arrive' });
  if (v.state === 'to_pickup' && sh) {
    v.state = 'loading';
    v.timer = LOAD_BASE_TICKS + LOAD_TICKS_PER_UNIT * sumQty(sh.items);
    v.path = [v.at];
  } else if (v.state === 'to_dropoff' && sh) {
    v.state = 'unloading';
    v.timer = LOAD_BASE_TICKS + LOAD_TICKS_PER_UNIT * sumQty(v.cargo);
    v.path = [v.at];
  } else {
    v.state = 'idle';
    v.path = [v.at];
  }
}

function finishStop(s: GameState, db: ContentDB, v: Vehicle, ev: EventBus) {
  const sh = shipmentOf(s, v);
  if (!sh) {
    v.state = 'idle';
    return;
  }
  if (v.state === 'loading') {
    const f = s.factories[sh.from];
    for (const k in sh.items) {
      addQty(f.reserved, k, -sh.items[k]);
      addQty(f.outbound, k, -sh.items[k]);
      addQty(v.cargo, k, sh.items[k]);
    }
    sh.status = 'in_transit';
    ev.push({ t: 'vehicle', v: v.id, what: 'loaded' });
    const tb = building(s, sh.to)!;
    v.path = findPath(s, v.at, tb.access) ?? [v.at];
    v.seg = 0;
    v.segPos = 0;
    v.state = v.path.length > 1 ? 'to_dropoff' : 'unloading';
    if (v.state === 'unloading') v.timer = LOAD_BASE_TICKS;
    return;
  }
  // unloading
  deliver(s, db, sh, v, ev);
  ev.push({ t: 'vehicle', v: v.id, what: 'unloaded' });
  const home = building(s, v.home)!;
  v.path = findPath(s, v.at, home.access) ?? [v.at];
  v.seg = 0;
  v.segPos = 0;
  v.shipment = null;
  v.state = v.path.length > 1 ? 'returning' : 'idle';
}

function deliver(s: GameState, db: ContentDB, sh: Shipment, v: Vehicle, ev: EventBus) {
  const cargo = v.cargo;
  if (sh.kind === 'import') {
    const f = s.factories[sh.to];
    for (const k in cargo) {
      addQty(f.incoming, k, -cargo[k]);
      addQty(f.inbound, k, cargo[k]);
    }
  } else if (sh.kind === 'restock') {
    const st = s.stores[sh.to];
    for (const k in cargo) {
      addQty(st.incoming, k, -cargo[k]);
      addQty(st.backroom, k, cargo[k]);
    }
  } else if (sh.kind === 'order') {
    const o = s.orders.find((x) => x.id === sh.orderId);
    for (const k in cargo) {
      s.stats.shipped[k] = (s.stats.shipped[k] ?? 0) + cargo[k];
      if (o) o.shipped[k] = (o.shipped[k] ?? 0) + cargo[k];
    }
    if (o) completeOrderIfDone(s, o, ev);
  }
  for (const k of Object.keys(cargo)) delete cargo[k];
  sh.status = 'delivered';
  ev.push({ t: 'delivered', shipment: sh.id, kind: sh.kind, to: sh.to });
  // Keep the shipment log bounded.
  if (s.shipments.length > 200) s.shipments = s.shipments.filter((x) => x.status !== 'delivered' || x.id === sh.id).slice(-200);
}

export function orderRemaining(o: GameState['orders'][number]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const k in o.items) {
    const left = o.items[k] - (o.shipped[k] ?? 0);
    if (left > 0) r[k] = left;
  }
  return r;
}

function inFlightForOrder(s: GameState, orderId: number): Record<string, number> {
  const r: Record<string, number> = {};
  for (const sh of s.shipments) if (sh.orderId === orderId && sh.status !== 'delivered') for (const k in sh.items) r[k] = (r[k] ?? 0) + sh.items[k];
  return r;
}

function completeOrderIfDone(s: GameState, o: GameState['orders'][number], ev: EventBus) {
  if (Object.keys(orderRemaining(o)).length) return;
  if (o.status === 'fulfilled') return;
  o.status = 'fulfilled';
  const bonus = s.tick <= o.bonusTick ? o.bonus : 0;
  post(s, 'contracts', o.reward + bonus);
  s.stats.ordersCompleted++;
  ev.push({ t: 'orderDone', id: o.id, reward: o.reward, bonus });
}

// ---------------------------------------------------------------------------- automation
/**
 * Manager policies, evaluated every 2 s: accepted orders have priority over shop restocking;
 * stock reserved for orders is never sent to shops.
 */
export function tickDispatch(s: GameState, db: ContentDB, ev: EventBus): void {
  if (s.tick % 20 !== 0) return;
  for (const fid of Object.keys(s.factories).sort()) {
    const f = s.factories[fid];
    if (!s.vehicles.some((v) => v.owner === 'player' && v.home === fid && v.state === 'idle')) continue;

    // 1) Orders (oldest first).
    const orderNeed: Record<string, number> = {};
    for (const o of s.orders) {
      if (o.status !== 'accepted' && o.status !== 'dispatched') continue;
      const rem = orderRemaining(o);
      const fly = inFlightForOrder(s, o.id);
      const send: Record<string, number> = {};
      let units = 0;
      for (const k of Object.keys(rem).sort()) {
        const need = rem[k] - (fly[k] ?? 0);
        if (need <= 0) continue;
        const take = Math.min(need, availableOutbound(f, k), VAN_CAPACITY - units);
        if (take > 0) {
          send[k] = take;
          units += take;
        }
        orderNeed[k] = (orderNeed[k] ?? 0) + need - (take > 0 ? take : 0);
      }
      if (units > 0) {
        const sh = dispatch(s, db, 'order', fid, o.customer, send, ev, o.id);
        if (sh) o.status = 'dispatched';
        if (!s.vehicles.some((v) => v.owner === 'player' && v.home === fid && v.state === 'idle')) return;
      }
    }

    // 2) Shop restocking.
    for (const sid of Object.keys(s.stores).sort()) {
      const st = s.stores[sid];
      if (!st.restock) continue;
      const want = storeWants(st);
      const send: Record<string, number> = {};
      let units = 0;
      // Lowest fill ratio first.
      const keys = Object.keys(want).sort((a, b) => want[b] - want[a] || (a < b ? -1 : 1));
      for (const k of keys) {
        const spare = availableOutbound(f, k) - (orderNeed[k] ?? 0);
        const take = Math.min(want[k], spare, VAN_CAPACITY - units);
        if (take > 0) {
          send[k] = take;
          units += take;
        }
      }
      // Avoid trickle trips: send when the van would be at least a quarter full or the shelf is empty.
      const urgent = keys.some((k) => send[k] && shelfQty(st, k) + qty(st.backroom, k) === 0);
      if (units >= VAN_CAPACITY / 4 || (units > 0 && urgent)) {
        dispatch(s, db, 'restock', fid, sid, send, ev);
        if (!s.vehicles.some((v) => v.owner === 'player' && v.home === fid && v.state === 'idle')) return;
      }
    }
  }
}

export function shelfQty(st: StoreState, item: string): number {
  let n = 0;
  for (const sl of st.shelves) if (sl.item === item) n += sl.qty;
  return n;
}

/** Units the store wants delivered per item (shelf space minus stock on hand and in transit). */
export function storeWants(st: StoreState): Record<string, number> {
  const cap: Record<string, number> = {};
  for (const sl of st.shelves) if (sl.item) cap[sl.item] = (cap[sl.item] ?? 0) + sl.cap;
  const r: Record<string, number> = {};
  for (const k in cap) {
    const n = cap[k] - shelfQty(st, k) - qty(st.backroom, k) - qty(st.incoming, k);
    if (n > 0) r[k] = n;
  }
  return r;
}
