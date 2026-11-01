import type {
  BuildingDef,
  ContentPack,
  DemandDef,
  ItemDef,
  MachineDef,
  RecipeDef,
  SourceDef,
  UnlockDef,
} from './types';

/** Indexed, read-only view over one or more content packs. Built once at boot. */
export interface ContentDB {
  items: Map<string, ItemDef>;
  recipes: Map<string, RecipeDef>;
  machines: Map<string, MachineDef>;
  buildings: Map<string, BuildingDef>;
  unlocks: Map<string, UnlockDef>;
  demand: Map<string, DemandDef>;
  /** item id -> sources (imports, farms, mines …) */
  sources: Map<string, SourceDef[]>;
  recipesByMachine: Map<string, RecipeDef[]>;
  /** Integer watts per machine while working (content stores kW). */
  machinePowerW: Map<string, number>;
  /** Standard (cheapest known) cost per unit in cents, used for stock valuation and COGS memo. */
  standardCost: Map<string, number>;
}

export function buildDB(packs: ContentPack[]): ContentDB {
  const db: ContentDB = {
    items: new Map(),
    recipes: new Map(),
    machines: new Map(),
    buildings: new Map(),
    unlocks: new Map(),
    demand: new Map(),
    sources: new Map(),
    recipesByMachine: new Map(),
    machinePowerW: new Map(),
    standardCost: new Map(),
  };
  for (const p of packs) {
    for (const x of p.items) db.items.set(x.id, x);
    for (const x of p.recipes) db.recipes.set(x.id, x);
    for (const x of p.machines) db.machines.set(x.id, x);
    for (const x of p.buildings) db.buildings.set(x.id, x);
    for (const x of p.unlocks) db.unlocks.set(x.id, x);
    for (const x of p.demand) db.demand.set(x.item, x);
    for (const s of p.sources) {
      const arr = db.sources.get(s.item) ?? [];
      arr.push(s);
      db.sources.set(s.item, arr);
    }
  }
  for (const r of db.recipes.values()) {
    const arr = db.recipesByMachine.get(r.machine) ?? [];
    arr.push(r);
    db.recipesByMachine.set(r.machine, arr);
  }
  for (const m of db.machines.values()) db.machinePowerW.set(m.id, Math.round(m.powerKw * 1000));

  // Cheapest-cost fixpoint: imports seed the costs; recipes propagate.
  const cost = db.standardCost;
  for (const [item, srcs] of db.sources) {
    let best = Infinity;
    for (const s of srcs) if (s.kind === 'import' && s.unitPrice > 0) best = Math.min(best, s.unitPrice);
    if (best < Infinity) cost.set(item, best);
  }
  for (let iter = 0; iter < 64; iter++) {
    let changed = false;
    for (const r of db.recipes.values()) {
      let sum = 0;
      let ok = true;
      for (const i of r.inputs) {
        const c = cost.get(i.item);
        if (c === undefined) {
          ok = false;
          break;
        }
        sum += c * i.qty;
      }
      if (!ok || r.outputs.length === 0) continue;
      const main = r.outputs[0];
      const per = Math.max(1, Math.round(sum / main.qty));
      const prev = cost.get(main.item);
      if (prev === undefined || per < prev) {
        cost.set(main.item, per);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const it of db.items.values()) if (!cost.has(it.id)) cost.set(it.id, it.baseValue);
  return db;
}

export function footprintOf(m: MachineDef, rot: number): [number, number] {
  return rot % 2 === 0 ? [m.footprint[0], m.footprint[1]] : [m.footprint[1], m.footprint[0]];
}
