/**
 * Content validator — structural, referential, economic and progression checks over a set of ContentPacks.
 * Pure function; no side effects. CLI wrapper: `npx tsx tools/validate-content.ts`.
 *
 * Error codes (selection): duplicate_id, bad_id, unknown_item, unknown_machine, unknown_building, unknown_unlock,
 * bad_number, import_price, missing_source, unreachable_item, unbootstrapped_cycle, value_loop, unused_item,
 * footprint_too_big, bay_out_of_bounds, bay_not_on_edge, level_not_monotonic, too_few_levels,
 * duplicate_factory_index, missing_factory_index, duplicate_business_index, missing_business_index,
 * unlock_cycle, unlock_orphan_root, condition_item_too_late, condition_unreachable, bootstrap_no_import,
 * missing_demand, missing_i18n.
 */
import enContent from '../i18n/en/content.json';
import heContent from '../i18n/he/content.json';
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

export interface Issue {
  code: string;
  message: string;
  ref?: string;
}

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
  stats: Record<string, number>;
}

export interface ValidateOptions {
  /** Override the i18n tables (tests). Defaults to src/i18n/{en,he}/content.json. Pass false to skip. */
  i18n?: { en: Record<string, string>; he: Record<string, string> } | false;
  /** Expected manufacturing / business index ranges (defaults 50 / 10). */
  factoryCount?: number;
  businessCount?: number;
}

export interface Ctx {
  items: Map<string, ItemDef>;
  recipes: Map<string, RecipeDef>;
  machines: Map<string, MachineDef>;
  buildings: Map<string, BuildingDef>;
  unlocks: Map<string, UnlockDef>;
  sources: Map<string, SourceDef>;
  demand: Map<string, DemandDef>;
  err: (code: string, message: string, ref?: string) => void;
  warn: (code: string, message: string, ref?: string) => void;
}

const ID_RE = /^[a-z][a-z0-9_]*$/;
const isPosInt = (n: unknown): boolean => Number.isInteger(n) && (n as number) > 0;
const isNonNegInt = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 0;

/** Footprint of a machine/bay after rotation (rot 1/3 swap axes). */
export function rotatedFootprint(fp: [number, number], rot: number): [number, number] {
  return rot % 2 === 1 ? [fp[1], fp[0]] : [fp[0], fp[1]];
}

export function validateContent(packs: ContentPack[], opts: ValidateOptions = {}): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const ctx: Ctx = {
    items: new Map(),
    recipes: new Map(),
    machines: new Map(),
    buildings: new Map(),
    unlocks: new Map(),
    sources: new Map(),
    demand: new Map(),
    err: (code, message, ref) => errors.push({ code, message, ...(ref ? { ref } : {}) }),
    warn: (code, message, ref) => warnings.push({ code, message, ...(ref ? { ref } : {}) }),
  };

  collectTables(ctx, packs);
  checkItems(ctx);
  checkRecipes(ctx);
  checkMachines(ctx);
  checkBuildings(ctx, opts.factoryCount ?? 50, opts.businessCount ?? 10);
  checkSources(ctx);
  checkUnlocks(ctx);
  checkDemand(ctx);
  checkGraph(ctx);
  checkProgression(ctx);
  if (opts.i18n !== false) {
    const i18n = opts.i18n ?? { en: enContent as Record<string, string>, he: heContent as Record<string, string> };
    checkI18n(ctx, i18n.en, i18n.he);
  }

  const blds = [...ctx.buildings.values()];
  const stats: Record<string, number> = {
    items: ctx.items.size,
    recipes: ctx.recipes.size,
    machines: ctx.machines.size,
    buildings: ctx.buildings.size,
    factories: blds.filter((b) => b.kind === 'factory').length,
    businesses: blds.filter((b) => b.kind === 'business').length,
    sources: ctx.sources.size,
    importSources: [...ctx.sources.values()].filter((s) => s.kind === 'import').length,
    unlocks: ctx.unlocks.size,
    demand: ctx.demand.size,
    consumerItems: [...ctx.items.values()].filter((i) => i.consumer).length,
    recyclingRecipes: [...ctx.recipes.values()].filter((r) => r.recycling).length,
  };
  if (stats.items < 150) ctx.warn('target_items', `only ${stats.items} items (target ≥ 150)`);
  if (stats.recipes < 200) ctx.warn('target_recipes', `only ${stats.recipes} recipes (target ≥ 200)`);
  return { errors, warnings, stats };
}

// ───────────────────────────── tables ─────────────────────────────

function collectTables(ctx: Ctx, packs: ContentPack[]): void {
  const add = <T extends { id: string }>(table: string, map: Map<string, T>, x: T): void => {
    if (!ID_RE.test(x.id)) ctx.err('bad_id', `${table} id "${x.id}" is not lower_snake_case`, x.id);
    if (map.has(x.id)) ctx.err('duplicate_id', `${table} id "${x.id}" is defined more than once`, x.id);
    else map.set(x.id, x);
  };
  for (const p of packs) {
    for (const x of p.items) add('item', ctx.items, x);
    for (const x of p.recipes) add('recipe', ctx.recipes, x);
    for (const x of p.machines) add('machine', ctx.machines, x);
    for (const x of p.buildings) add('building', ctx.buildings, x);
    for (const x of p.unlocks) add('unlock', ctx.unlocks, x);
    for (const x of p.sources) add('source', ctx.sources, x);
    for (const d of p.demand) {
      if (ctx.demand.has(d.item)) ctx.err('duplicate_id', `demand for "${d.item}" is defined more than once`, d.item);
      else ctx.demand.set(d.item, d);
    }
  }
}

function checkUnlockRef(ctx: Ctx, id: string | undefined, where: string): void {
  if (id !== undefined && !ctx.unlocks.has(id)) ctx.err('unknown_unlock', `${where} references unknown unlock "${id}"`, id);
}

// ───────────────────────────── items / recipes ─────────────────────────────

function checkItems(ctx: Ctx): void {
  for (const it of ctx.items.values()) {
    if (!Number.isInteger(it.tier) || it.tier < 0 || it.tier > 6) ctx.err('bad_number', `item ${it.id}: tier must be an integer 0..6`, it.id);
    if (!isNonNegInt(it.baseValue)) ctx.err('bad_number', `item ${it.id}: baseValue must be integer cents ≥ 0`, it.id);
    if (!isPosInt(it.volume)) ctx.err('bad_number', `item ${it.id}: volume must be a positive integer`, it.id);
    if (it.shelfLifeSec !== undefined && !isPosInt(it.shelfLifeSec)) ctx.err('bad_number', `item ${it.id}: shelfLifeSec must be a positive integer`, it.id);
  }
}

function checkRecipes(ctx: Ctx): void {
  for (const r of ctx.recipes.values()) {
    const m = ctx.machines.get(r.machine);
    if (!m) ctx.err('unknown_machine', `recipe ${r.id} uses unknown machine "${r.machine}"`, r.id);
    else if (m.role) ctx.err('recipe_on_role_machine', `recipe ${r.id} runs on ${m.id}, a '${m.role}' machine`, r.id);
    if (!isPosInt(r.durationSec)) ctx.err('bad_number', `recipe ${r.id}: durationSec must be a positive integer`, r.id);
    if (r.inputs.length === 0) ctx.err('recipe_no_inputs', `recipe ${r.id} has no inputs (creates goods from nothing)`, r.id);
    if (r.outputs.length === 0) ctx.err('recipe_no_outputs', `recipe ${r.id} has no outputs`, r.id);
    if (r.waterL !== undefined && !(r.waterL >= 0)) ctx.err('bad_number', `recipe ${r.id}: waterL must be ≥ 0`, r.id);
    for (const s of [...r.inputs, ...r.outputs]) {
      if (!ctx.items.has(s.item)) ctx.err('unknown_item', `recipe ${r.id} references unknown item "${s.item}"`, r.id);
      if (!isPosInt(s.qty)) ctx.err('bad_number', `recipe ${r.id}: qty of ${s.item} must be a positive integer`, r.id);
    }
    for (const o of r.outputs) {
      if (o.chancePermille !== undefined && (!Number.isInteger(o.chancePermille) || o.chancePermille < 1 || o.chancePermille > 1000)) {
        ctx.err('bad_number', `recipe ${r.id}: chancePermille of ${o.item} must be an integer 1..1000`, r.id);
      }
    }
    checkUnlockRef(ctx, r.unlock, `recipe ${r.id}`);
  }
}

// ───────────────────────────── machines ─────────────────────────────

function checkMachines(ctx: Ctx): void {
  const usedByRecipe = new Set([...ctx.recipes.values()].map((r) => r.machine));
  for (const m of ctx.machines.values()) {
    const ref = m.id;
    if (!isPosInt(m.footprint[0]) || !isPosInt(m.footprint[1])) ctx.err('bad_number', `machine ${ref}: footprint must be positive integers`, ref);
    if (!isNonNegInt(m.cost)) ctx.err('bad_number', `machine ${ref}: cost must be integer cents ≥ 0`, ref);
    if (!(m.powerKw >= 0) || !Number.isFinite(m.powerKw)) ctx.err('bad_number', `machine ${ref}: powerKw must be ≥ 0`, ref);
    if (!isNonNegInt(m.staff)) ctx.err('bad_number', `machine ${ref}: staff must be an integer ≥ 0`, ref);
    if (!isNonNegInt(m.maintenancePerMin)) ctx.err('bad_number', `machine ${ref}: maintenancePerMin must be integer cents ≥ 0`, ref);
    if (!isNonNegInt(m.inputCrafts) || !isNonNegInt(m.outputCap)) ctx.err('bad_number', `machine ${ref}: buffers must be integers ≥ 0`, ref);
    if (m.speedPct.length === 0 || m.speedPct[0] !== 100) ctx.err('bad_number', `machine ${ref}: speedPct must start at 100`, ref);
    if (m.speedPct.length !== m.upgradeCost.length) ctx.err('bad_number', `machine ${ref}: speedPct and upgradeCost lengths differ`, ref);
    for (let i = 1; i < m.speedPct.length; i++) {
      if (!isPosInt(m.speedPct[i]) || m.speedPct[i] < m.speedPct[i - 1]) ctx.err('bad_number', `machine ${ref}: speedPct must be increasing integers`, ref);
    }
    for (const c of m.upgradeCost) if (!isNonNegInt(c)) ctx.err('bad_number', `machine ${ref}: upgradeCost must be integer cents`, ref);
    if (m.role === 'storage' && !isPosInt(m.storageCap)) ctx.err('bad_number', `machine ${ref}: storage machines need a positive storageCap`, ref);
    if (m.fixed && m.role !== 'receiving' && m.role !== 'shipping') ctx.warn('fixed_without_bay_role', `machine ${ref} is fixed but not a receiving/shipping bay`, ref);
    if (!m.role && !usedByRecipe.has(m.id)) ctx.warn('machine_without_recipe', `machine ${ref} has no role and no recipe`, ref);
    checkUnlockRef(ctx, m.unlock, `machine ${ref}`);
    if (m.buildings.length === 0) ctx.err('unknown_building', `machine ${ref} is not allowed in any building`, ref);
    const factories = m.buildings.filter((b) => ctx.buildings.get(b)?.kind === 'factory');
    if (!m.role && factories.length > 1) ctx.warn('shared_machine', `recipe machine ${ref} is shared by factories ${factories.join(', ')}`, ref);
    for (const bid of m.buildings) {
      const b = ctx.buildings.get(bid);
      if (!b) {
        ctx.err('unknown_building', `machine ${ref} lists unknown building "${bid}"`, ref);
        continue;
      }
      if (!b.machines.includes(m.id)) ctx.err('machine_building_mismatch', `machine ${ref} lists ${bid}, but ${bid}.machines does not include it`, ref);
      const l1 = b.levels.find((l) => l.level === 1) ?? b.levels[0];
      if (!l1) continue;
      const [w, h] = l1.interior;
      const [fx, fz] = m.footprint;
      if (!((fx <= w && fz <= h) || (fz <= w && fx <= h))) {
        ctx.err('footprint_too_big', `machine ${ref} footprint ${fx}×${fz} does not fit ${bid} level-1 interior ${w}×${h}`, ref);
      }
      if (m.powerKw > l1.powerCapKw && b.kind !== 'resource') ctx.warn('machine_power_exceeds_cap', `machine ${ref} draws ${m.powerKw} kW, above ${bid} level-1 cap ${l1.powerCapKw} kW`, ref);
      if (m.staff > l1.staffCap) ctx.warn('machine_staff_exceeds_cap', `machine ${ref} needs ${m.staff} staff, above ${bid} level-1 cap ${l1.staffCap}`, ref);
    }
  }
}

// ───────────────────────────── buildings ─────────────────────────────

function checkBuildings(ctx: Ctx, factoryCount: number, businessCount: number): void {
  const factoryIdx = new Map<number, string>();
  const businessIdx = new Map<number, string>();
  for (const b of ctx.buildings.values()) {
    const ref = b.id;
    checkUnlockRef(ctx, b.unlock, `building ${ref}`);
    if (!Number.isInteger(b.chapter) || b.chapter < 1 || b.chapter > 7) ctx.err('bad_number', `building ${ref}: chapter must be 1..7`, ref);
    if (b.unlock && ctx.unlocks.get(b.unlock) && ctx.unlocks.get(b.unlock)!.chapter !== b.chapter) {
      ctx.warn('building_chapter_mismatch', `building ${ref} is chapter ${b.chapter} but its unlock is chapter ${ctx.unlocks.get(b.unlock)!.chapter}`, ref);
    }
    for (const mid of b.machines) {
      const m = ctx.machines.get(mid);
      if (!m) ctx.err('unknown_machine', `building ${ref} lists unknown machine "${mid}"`, ref);
      else if (!m.buildings.includes(b.id)) ctx.err('machine_building_mismatch', `building ${ref} lists ${mid}, but ${mid}.buildings does not include it`, ref);
    }
    for (const i of [...(b.sells ?? []), ...(b.consumes ?? [])]) {
      if (!ctx.items.has(i)) ctx.err('unknown_item', `building ${ref} sells/consumes unknown item "${i}"`, ref);
    }
    if ((b.sells || b.consumes) && b.kind !== 'business') ctx.warn('trade_on_non_business', `building ${ref} (${b.kind}) has sells/consumes`, ref);

    // indices
    if (b.kind === 'factory') {
      if (!Number.isInteger(b.factoryIndex)) ctx.err('missing_factory_index', `factory ${ref} has no factoryIndex`, ref);
      else if (b.factoryIndex! < 1 || b.factoryIndex! > factoryCount) ctx.err('bad_factory_index', `factory ${ref} index ${b.factoryIndex} outside 1..${factoryCount}`, ref);
      else if (factoryIdx.has(b.factoryIndex!)) ctx.err('duplicate_factory_index', `factoryIndex ${b.factoryIndex} used by ${factoryIdx.get(b.factoryIndex!)} and ${ref}`, ref);
      else factoryIdx.set(b.factoryIndex!, ref);
    } else if (b.factoryIndex !== undefined) ctx.err('bad_factory_index', `${b.kind} ${ref} must not have a factoryIndex`, ref);
    if (b.kind === 'business') {
      if (!Number.isInteger(b.businessIndex)) ctx.err('missing_business_index', `business ${ref} has no businessIndex`, ref);
      else if (b.businessIndex! < 1 || b.businessIndex! > businessCount) ctx.err('bad_business_index', `business ${ref} index ${b.businessIndex} outside 1..${businessCount}`, ref);
      else if (businessIdx.has(b.businessIndex!)) ctx.err('duplicate_business_index', `businessIndex ${b.businessIndex} used by ${businessIdx.get(b.businessIndex!)} and ${ref}`, ref);
      else businessIdx.set(b.businessIndex!, ref);
    } else if (b.businessIndex !== undefined) ctx.err('bad_business_index', `${b.kind} ${ref} must not have a businessIndex`, ref);

    checkLevels(ctx, b);

    if (b.kind === 'factory') {
      if (b.mechanics.length === 0) ctx.err('missing_mechanics', `factory ${ref} has no mechanics`, ref);
      if (!b.identity.trim()) ctx.err('missing_identity', `factory ${ref} has no identity sentence`, ref);
      const recipeMachines = new Set(b.machines.filter((m) => !ctx.machines.get(m)?.role));
      const recipes = [...ctx.recipes.values()].filter((r) => recipeMachines.has(r.machine));
      if (recipes.length < 2) ctx.err('too_few_recipes', `factory ${ref} has ${recipes.length} recipes (needs ≥ 2)`, ref);
      const signature = [...recipeMachines].filter((m) => recipes.some((r) => r.machine === m));
      if (signature.length < 2 || signature.length > 6) ctx.warn('signature_machine_count', `factory ${ref} has ${signature.length} signature machines (expected 2–6)`, ref);
    }
  }
  for (let i = 1; i <= factoryCount; i++) if (!factoryIdx.has(i)) ctx.err('missing_factory_index', `no factory has factoryIndex ${i}`);
  for (let i = 1; i <= businessCount; i++) if (!businessIdx.has(i)) ctx.err('missing_business_index', `no business has businessIndex ${i}`);
}

function checkLevels(ctx: Ctx, b: BuildingDef): void {
  const ref = b.id;
  const counted = b.kind === 'factory' || b.kind === 'business';
  if (b.levels.length === 0) ctx.err('too_few_levels', `building ${ref} has no levels`, ref);
  if (counted && b.levels.length < 3) ctx.err('too_few_levels', `${b.kind} ${ref} has ${b.levels.length} levels (needs ≥ 3)`, ref);
  let prev: BuildingDef['levels'][number] | undefined;
  b.levels.forEach((lv, idx) => {
    const lref = `${ref} L${lv.level}`;
    if (lv.level !== idx + 1) ctx.err('level_numbering', `building ${ref}: levels must be numbered 1..n in order`, ref);
    if (!isNonNegInt(lv.cost) || (idx > 0 && lv.cost <= 0)) ctx.err('bad_number', `${lref}: cost must be a positive integer (level 1 may be 0)`, ref);
    const [w, h] = lv.interior;
    if (!isPosInt(w) || !isPosInt(h)) ctx.err('bad_number', `${lref}: interior must be positive integers`, ref);
    if (!(lv.powerCapKw >= 0) || !isNonNegInt(lv.inboundCap) || !isNonNegInt(lv.outboundCap) || !isNonNegInt(lv.staffCap)) {
      ctx.err('bad_number', `${lref}: capacities must be non-negative (integers for docks/staff)`, ref);
    }
    checkUnlockRef(ctx, lv.requires, lref);
    if (idx > 0 && !lv.requires && counted) ctx.warn('level_without_unlock', `${lref} has no requires unlock`, ref);
    for (const mid of lv.unlocksMachines ?? []) {
      if (!ctx.machines.has(mid)) ctx.err('unknown_machine', `${lref} unlocks unknown machine "${mid}"`, ref);
      else if (!b.machines.includes(mid)) ctx.err('machine_building_mismatch', `${lref} unlocks ${mid}, which is not a machine of ${ref}`, ref);
    }
    if (prev) {
      if (w < prev.interior[0] || h < prev.interior[1]) ctx.err('level_not_monotonic', `${lref}: interior ${w}×${h} shrinks from ${prev.interior[0]}×${prev.interior[1]}`, ref);
      if (lv.powerCapKw < prev.powerCapKw || lv.inboundCap < prev.inboundCap || lv.outboundCap < prev.outboundCap || lv.staffCap < prev.staffCap) {
        ctx.warn('level_capacity_shrinks', `${lref}: a capacity decreases from the previous level`, ref);
      }
      for (const pb of prev.bays) {
        if (!lv.bays.some((nb) => nb.machine === pb.machine && nb.x === pb.x && nb.y === pb.y && nb.rot === pb.rot)) {
          ctx.warn('bay_moved', `${lref}: bay ${pb.machine} at (${pb.x},${pb.y}) from the previous level is missing`, ref);
        }
      }
    }
    // bays
    const occupied = new Set<string>();
    let hasIn = false;
    let hasOut = false;
    for (const bay of lv.bays) {
      const m = ctx.machines.get(bay.machine);
      if (!m) {
        ctx.err('unknown_machine', `${lref}: bay uses unknown machine "${bay.machine}"`, ref);
        continue;
      }
      if (!b.machines.includes(m.id)) ctx.err('machine_building_mismatch', `${lref}: bay machine ${m.id} is not in ${ref}.machines`, ref);
      if (!m.fixed || (m.role !== 'receiving' && m.role !== 'shipping')) ctx.err('bay_machine_invalid', `${lref}: bay machine ${m.id} must be fixed with role receiving/shipping`, ref);
      if (m.role === 'receiving') hasIn = true;
      if (m.role === 'shipping') hasOut = true;
      const [bw, bh] = rotatedFootprint(m.footprint, bay.rot);
      if (bay.x < 0 || bay.y < 0 || bay.x + bw > w || bay.y + bh > h) {
        ctx.err('bay_out_of_bounds', `${lref}: bay ${m.id} at (${bay.x},${bay.y}) size ${bw}×${bh} exceeds interior ${w}×${h}`, ref);
      } else if (!(bay.x === 0 || bay.y === 0 || bay.x + bw === w || bay.y + bh === h)) {
        ctx.err('bay_not_on_edge', `${lref}: bay ${m.id} at (${bay.x},${bay.y}) is not on an interior edge`, ref);
      }
      for (let dx = 0; dx < bw; dx++) {
        for (let dy = 0; dy < bh; dy++) {
          const k = `${bay.x + dx},${bay.y + dy}`;
          if (occupied.has(k)) ctx.warn('bay_overlap', `${lref}: bays overlap at tile ${k}`, ref);
          occupied.add(k);
        }
      }
    }
    if (b.kind === 'factory' && (!hasIn || !hasOut)) ctx.err('missing_bays', `${lref}: factory needs at least one receiving and one shipping bay`, ref);
    prev = lv;
  });
}

// ───────────────────────────── sources / unlocks / demand ─────────────────────────────

function checkSources(ctx: Ctx): void {
  for (const s of ctx.sources.values()) {
    if (!ctx.items.has(s.item)) ctx.err('unknown_item', `source ${s.id} supplies unknown item "${s.item}"`, s.id);
    if (s.kind === 'import' && !isPosInt(s.unitPrice)) ctx.err('import_price', `import ${s.id} must have a positive integer unitPrice`, s.id);
    else if (!isNonNegInt(s.unitPrice)) ctx.err('bad_number', `source ${s.id}: unitPrice must be integer cents`, s.id);
    if (!isPosInt(s.ratePerMin)) ctx.err('bad_number', `source ${s.id}: ratePerMin must be a positive integer (finite supply)`, s.id);
    if (s.building !== undefined && !ctx.buildings.has(s.building)) ctx.err('unknown_building', `source ${s.id} references unknown building "${s.building}"`, s.id);
    if (s.kind !== 'import' && s.building === undefined) ctx.warn('source_without_building', `non-import source ${s.id} has no producing building`, s.id);
    checkUnlockRef(ctx, s.unlock, `source ${s.id}`);
  }
}

function checkUnlocks(ctx: Ctx): void {
  for (const u of ctx.unlocks.values()) {
    if (!isNonNegInt(u.cost)) ctx.err('bad_number', `unlock ${u.id}: cost must be integer cents ≥ 0`, u.id);
    if (!Number.isInteger(u.chapter) || u.chapter < 1 || u.chapter > 7) ctx.err('bad_number', `unlock ${u.id}: chapter must be 1..7`, u.id);
    for (const r of u.requires) {
      const req = ctx.unlocks.get(r);
      if (!req) ctx.err('unknown_unlock', `unlock ${u.id} requires unknown unlock "${r}"`, u.id);
      else if (req.chapter > u.chapter) ctx.warn('unlock_chapter_order', `unlock ${u.id} (ch${u.chapter}) requires later-chapter ${r} (ch${req.chapter})`, u.id);
    }
    if (u.requires.length === 0 && u.chapter !== 1) ctx.err('unlock_orphan_root', `unlock ${u.id} (ch${u.chapter}) has no prerequisites, so it is not reachable from the chapter-1 root`, u.id);
    for (const c of u.conditions ?? []) {
      if ((c.t === 'sold' || c.t === 'produced') && (!ctx.items.has(c.item) || !isPosInt(c.qty))) ctx.err('unknown_item', `unlock ${u.id}: condition references unknown item "${c.item}" or bad qty`, u.id);
      if (c.t === 'level' && (!ctx.buildings.has(c.building) || !isPosInt(c.level))) ctx.err('unknown_building', `unlock ${u.id}: level condition references unknown building "${c.building}"`, u.id);
      if (c.t === 'revenue' && !isPosInt(c.cents)) ctx.err('bad_number', `unlock ${u.id}: revenue condition must be positive cents`, u.id);
      if (c.t === 'orders' && !isPosInt(c.count)) ctx.err('bad_number', `unlock ${u.id}: orders condition must be positive`, u.id);
    }
  }
  // cycles (iterative colouring DFS)
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) {
      ctx.err('unlock_cycle', `unlock graph has a cycle: ${[...path.slice(path.indexOf(id)), id].join(' → ')}`, id);
      return;
    }
    state.set(id, 1);
    for (const r of ctx.unlocks.get(id)?.requires ?? []) if (ctx.unlocks.has(r)) visit(r, [...path, id]);
    state.set(id, 2);
  };
  for (const id of ctx.unlocks.keys()) visit(id, []);
  // unused unlocks
  const used = new Set<string>();
  for (const u of ctx.unlocks.values()) u.requires.forEach((r) => used.add(r));
  for (const r of ctx.recipes.values()) if (r.unlock) used.add(r.unlock);
  for (const m of ctx.machines.values()) if (m.unlock) used.add(m.unlock);
  for (const s of ctx.sources.values()) if (s.unlock) used.add(s.unlock);
  for (const b of ctx.buildings.values()) {
    if (b.unlock) used.add(b.unlock);
    for (const l of b.levels) if (l.requires) used.add(l.requires);
  }
  for (const u of ctx.unlocks.values()) {
    if (!used.has(u.id) && u.category !== 'management' && u.category !== 'logistics') ctx.warn('unlock_unused', `unlock ${u.id} gates nothing`, u.id);
  }
}

function checkDemand(ctx: Ctx): void {
  for (const d of ctx.demand.values()) {
    const it = ctx.items.get(d.item);
    if (!it) ctx.err('unknown_item', `demand references unknown item "${d.item}"`, d.item);
    else if (!it.consumer) ctx.warn('demand_not_consumer', `demand defined for non-consumer item ${d.item}`, d.item);
    if (!isPosInt(d.baseMilliPerMinPer1000)) ctx.err('bad_number', `demand ${d.item}: baseMilliPerMinPer1000 must be a positive integer`, d.item);
    if (!isPosInt(d.refPrice)) ctx.err('bad_number', `demand ${d.item}: refPrice must be positive cents`, d.item);
  }
  for (const it of ctx.items.values()) {
    if (it.consumer && !ctx.demand.has(it.id)) ctx.err('missing_demand', `consumer item ${it.id} has no DemandDef`, it.id);
  }
}

// ───────────────────────────── production graph ─────────────────────────────

const expQty = (o: { qty: number; chancePermille?: number }): number => (o.qty * (o.chancePermille ?? 1000)) / 1000;

/**
 * Cheapest known cost per unit: seeded from source prices, propagated through recipes by output value share.
 * Recycling recipes are excluded: allocating a byproduct its small value share and then recycling it back into
 * full-value material would otherwise drive loop costs toward zero. Recycled streams keep their collection price,
 * so the estimate is the conservative virgin-route cost.
 */
export function minCosts(items: Map<string, ItemDef>, recipes: Iterable<RecipeDef>, sources: Iterable<SourceDef>): Map<string, number> {
  const cost = new Map<string, number>();
  for (const s of sources) if (cost.get(s.item) === undefined || s.unitPrice < cost.get(s.item)!) cost.set(s.item, s.unitPrice);
  const rs = [...recipes].filter((r) => !r.recycling);
  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    for (const r of rs) {
      const unit = recipeUnitCosts(r, items, cost);
      if (!unit) continue;
      for (const [item, c] of unit) {
        if (cost.get(item) === undefined || c < cost.get(item)! - 1e-9) {
          cost.set(item, c);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return cost;
}

/** Per-unit cost of each output of `r` given input costs, allocating by output base value. */
function recipeUnitCosts(r: RecipeDef, items: Map<string, ItemDef>, cost: Map<string, number>): Map<string, number> | undefined {
  let inCost = 0;
  for (const i of r.inputs) {
    const c = cost.get(i.item);
    if (c === undefined) return undefined;
    inCost += c * i.qty;
  }
  const outVal = r.outputs.reduce((a, o) => a + (items.get(o.item)?.baseValue ?? 0) * expQty(o), 0);
  const outQty = r.outputs.reduce((a, o) => a + expQty(o), 0);
  const res = new Map<string, number>();
  for (const o of r.outputs) {
    const bv = items.get(o.item)?.baseValue ?? 0;
    res.set(o.item, outVal > 0 ? (inCost * bv) / outVal : inCost / Math.max(outQty, 1e-9));
  }
  return res;
}

function checkGraph(ctx: Ctx): void {
  const producers = new Map<string, RecipeDef[]>();
  const consumers = new Map<string, RecipeDef[]>();
  const sourcesOf = new Map<string, SourceDef[]>();
  for (const r of ctx.recipes.values()) {
    for (const o of r.outputs) producers.set(o.item, [...(producers.get(o.item) ?? []), r]);
    for (const i of r.inputs) consumers.set(i.item, [...(consumers.get(i.item) ?? []), r]);
  }
  for (const s of ctx.sources.values()) sourcesOf.set(s.item, [...(sourcesOf.get(s.item) ?? []), s]);
  const sold = new Set<string>();
  const traded = new Set<string>();
  for (const b of ctx.buildings.values()) {
    for (const i of b.sells ?? []) sold.add(i), traded.add(i);
    for (const i of b.consumes ?? []) traded.add(i);
  }

  // 1. every item has a producer or source; every item is used by something
  for (const it of ctx.items.values()) {
    if (!producers.has(it.id) && !sourcesOf.has(it.id)) ctx.err('missing_source', `item ${it.id} is produced by no recipe and has no source`, it.id);
    const used = consumers.has(it.id) || traded.has(it.id) || ctx.demand.has(it.id) || it.category === 'service';
    if (!used) ctx.err('unused_item', `item ${it.id} is a dead end: no recipe input, business, demand or service use`, it.id);
    if (it.consumer && !sold.has(it.id)) ctx.warn('consumer_not_sold', `consumer item ${it.id} is not sold by any business`, it.id);
  }

  // 2. reachability fixpoint from sources
  const reach = new Set<string>(sourcesOf.keys());
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of ctx.recipes.values()) {
      if (r.inputs.every((i) => reach.has(i.item))) {
        for (const o of r.outputs) if (!reach.has(o.item)) reach.add(o.item), (changed = true);
      }
    }
  }
  const cyclic = cyclicItems(ctx);
  for (const it of ctx.items.values()) {
    if (reach.has(it.id) || !producers.has(it.id)) continue;
    if (cyclic.has(it.id)) ctx.err('unbootstrapped_cycle', `item ${it.id} is only produced inside a recipe cycle with no bootstrap path from any source`, it.id);
    else ctx.err('unreachable_item', `item ${it.id} cannot be produced from any source`, it.id);
  }

  // 3. value-creating loops
  for (const r of ctx.recipes.values()) {
    for (const o of r.outputs) {
      const inp = r.inputs.find((i) => i.item === o.item);
      if (inp && (expQty(o) > inp.qty || (expQty(o) >= inp.qty && r.outputs.length > 1))) {
        ctx.err('value_loop', `recipe ${r.id} outputs at least as much ${o.item} as it consumes, plus more — value from nothing`, r.id);
      }
    }
  }
  findGainCycles(ctx);

  // 4. economics: output value vs input min-cost, import premium
  const cost = minCosts(ctx.items, ctx.recipes.values(), ctx.sources.values());
  for (const r of ctx.recipes.values()) {
    let inCost = 0;
    let known = true;
    for (const i of r.inputs) {
      const c = cost.get(i.item);
      if (c === undefined) known = false;
      else inCost += c * i.qty;
    }
    if (!known) continue;
    const outVal = r.outputs.reduce((a, o) => a + (ctx.items.get(o.item)?.baseValue ?? 0) * expQty(o), 0);
    if (outVal < inCost * 0.999) {
      ctx.warn('value_below_cost', `recipe ${r.id}: output base value ${Math.round(outVal)}¢ < min input cost ${Math.round(inCost)}¢`, r.id);
    }
  }
  for (const s of ctx.sources.values()) {
    if (s.kind !== 'import') continue;
    let internal = Infinity;
    for (const o of sourcesOf.get(s.item) ?? []) if (o.kind !== 'import') internal = Math.min(internal, o.unitPrice);
    for (const r of producers.get(s.item) ?? []) {
      if (r.recycling) continue;
      const u = recipeUnitCosts(r, ctx.items, cost)?.get(s.item);
      if (u !== undefined) internal = Math.min(internal, u);
    }
    if (internal < Infinity && s.unitPrice <= internal) {
      ctx.warn('import_not_premium', `import ${s.id} (${s.unitPrice}¢) is not above internal production cost (${Math.round(internal)}¢)`, s.id);
    }
  }
}

/** Items that sit on a directed cycle of the item→recipe→item graph (Tarjan SCC). */
function cyclicItems(ctx: Ctx): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const r of ctx.recipes.values()) {
    for (const i of r.inputs) {
      const set = adj.get(i.item) ?? new Set<string>();
      for (const o of r.outputs) set.add(o.item);
      adj.set(i.item, set);
    }
  }
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out = new Set<string>();
  const strong = (v: string): void => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || adj.get(v)?.has(v)) comp.forEach((c) => out.add(c));
    }
  };
  for (const v of ctx.items.keys()) if (!idx.has(v)) strong(v);
  return out;
}

/**
 * Bellman–Ford over single-input recipes (the only kind that can form a loop with no other inputs):
 * a cycle whose quantity multiplier exceeds 1 — or equals 1 while emitting extra byproducts — creates goods from nothing.
 */
function findGainCycles(ctx: Ctx): void {
  interface Edge { from: string; to: string; w: number; recipe: string }
  const edges: Edge[] = [];
  for (const r of ctx.recipes.values()) {
    if (r.inputs.length !== 1) continue;
    const inp = r.inputs[0];
    for (const o of r.outputs) {
      if (o.item === inp.item) continue;
      const ratio = expQty(o) / inp.qty;
      if (ratio <= 0) continue;
      edges.push({ from: inp.item, to: o.item, w: -Math.log(ratio) - (r.outputs.length > 1 ? 1e-6 : 0), recipe: r.id });
    }
  }
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  const dist = new Map<string, number>(nodes.map((n) => [n, 0]));
  const pred = new Map<string, Edge>();
  let last: Edge | undefined;
  for (let i = 0; i < nodes.length; i++) {
    last = undefined;
    for (const e of edges) {
      if (dist.get(e.from)! + e.w < dist.get(e.to)! - 1e-12) {
        dist.set(e.to, dist.get(e.from)! + e.w);
        pred.set(e.to, e);
        last = e;
      }
    }
    if (!last) return;
  }
  if (!last) return;
  // walk back into the cycle, then collect it
  let v = last.to;
  for (let i = 0; i < nodes.length; i++) v = pred.get(v)!.from;
  const cycle: string[] = [];
  let cur = v;
  do {
    const e = pred.get(cur)!;
    cycle.push(e.recipe);
    cur = e.from;
  } while (cur !== v && cycle.length <= nodes.length);
  ctx.err('value_loop', `recipe loop ${cycle.reverse().join(' → ')} multiplies goods with no other inputs`, cycle[0]);
}

// ───────────────────────────── progression ─────────────────────────────

function checkProgression(ctx: Ctx): void {
  const uCh = (id?: string): number => (id ? (ctx.unlocks.get(id)?.chapter ?? 99) : 0);
  const bCh = (b: BuildingDef): number => Math.max(b.chapter, uCh(b.unlock));
  const hostsOf = (m: MachineDef): BuildingDef[] => m.buildings.map((id) => ctx.buildings.get(id)).filter((b): b is BuildingDef => !!b);
  const mCh = (m: MachineDef): number => {
    const hosts = hostsOf(m);
    return Math.max(uCh(m.unlock), hosts.length ? Math.min(...hosts.map(bCh)) : 99);
  };
  const rCh = (r: RecipeDef): number => {
    const m = ctx.machines.get(r.machine);
    return Math.max(uCh(r.unlock), m ? mCh(m) : 99);
  };
  const sCh = (s: SourceDef): number => {
    const b = s.building ? ctx.buildings.get(s.building) : undefined;
    return Math.max(uCh(s.unlock), b ? bCh(b) : 1, 1);
  };

  // earliest chapter in which each item can be obtained
  const itemCh = new Map<string, number>();
  for (const s of ctx.sources.values()) itemCh.set(s.item, Math.min(itemCh.get(s.item) ?? 99, sCh(s)));
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of ctx.recipes.values()) {
      if (!r.inputs.every((i) => itemCh.has(i.item))) continue;
      const c = Math.max(rCh(r), ...r.inputs.map((i) => itemCh.get(i.item)!));
      for (const o of r.outputs) if (c < (itemCh.get(o.item) ?? 99)) itemCh.set(o.item, c), (changed = true);
    }
  }
  for (const r of ctx.recipes.values()) {
    for (const i of r.inputs) {
      const c = itemCh.get(i.item);
      if (c !== undefined && c > rCh(r)) ctx.warn('chapter_late_input', `recipe ${r.id} (ch${rCh(r)}) needs ${i.item}, first available in ch${c}`, r.id);
    }
  }

  // bootstrap rule: chapters 1–2 must be playable from imports alone
  const viaImports = new Set([...ctx.sources.values()].filter((s) => s.kind === 'import').map((s) => s.item));
  const early = [...ctx.recipes.values()].filter((r) => rCh(r) <= 2);
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of early) {
      if (r.inputs.every((i) => viaImports.has(i.item))) for (const o of r.outputs) if (!viaImports.has(o.item)) viaImports.add(o.item), (changed = true);
    }
  }
  for (const r of early) {
    for (const i of r.inputs) {
      if (!viaImports.has(i.item)) ctx.err('bootstrap_no_import', `chapter-${rCh(r)} recipe ${r.id} needs ${i.item}, which cannot be obtained from imports alone`, r.id);
    }
  }

  // conditions must reference things that exist by that chapter
  for (const u of ctx.unlocks.values()) {
    for (const c of u.conditions ?? []) {
      if ((c.t === 'sold' || c.t === 'produced') && ctx.items.has(c.item)) {
        const ch = itemCh.get(c.item) ?? 99;
        if (ch > u.chapter) ctx.err('condition_item_too_late', `unlock ${u.id} (ch${u.chapter}) needs ${c.t} ${c.item}, first producible in ch${ch}`, u.id);
      }
      if (c.t === 'level' && ctx.buildings.has(c.building) && bCh(ctx.buildings.get(c.building)!) > u.chapter) {
        ctx.err('condition_item_too_late', `unlock ${u.id} (ch${u.chapter}) needs ${c.building} which arrives later`, u.id);
      }
    }
  }

  // gating closure: what is obtainable once a given set of unlocks is owned
  const ancestorMemo = new Map<string, Set<string>>();
  const ancestors = (id: string, guard = new Set<string>()): Set<string> => {
    const memo = ancestorMemo.get(id);
    if (memo) return memo;
    const out = new Set<string>();
    if (guard.has(id)) return out;
    guard.add(id);
    for (const r of ctx.unlocks.get(id)?.requires ?? []) {
      out.add(r);
      for (const a of ancestors(r, guard)) out.add(a);
    }
    ancestorMemo.set(id, out);
    return out;
  };
  const availCache = new Map<string, Set<string>>();
  const availableUnder = (owned: Set<string>): Set<string> => {
    const key = [...owned].sort().join('|');
    const hit = availCache.get(key);
    if (hit) return hit;
    const gated = (u?: string): boolean => u === undefined || owned.has(u);
    const bOk = (id: string): boolean => gated(ctx.buildings.get(id)?.unlock) && ctx.buildings.has(id);
    const items = new Set<string>();
    for (const s of ctx.sources.values()) if (gated(s.unlock) && (!s.building || bOk(s.building))) items.add(s.item);
    const usable = [...ctx.recipes.values()].filter((r) => {
      const m = ctx.machines.get(r.machine);
      return !!m && gated(r.unlock) && gated(m.unlock) && m.buildings.some(bOk);
    });
    for (let changed = true; changed; ) {
      changed = false;
      for (const r of usable) {
        if (r.inputs.every((i) => items.has(i.item))) for (const o of r.outputs) if (!items.has(o.item)) items.add(o.item), (changed = true);
      }
    }
    availCache.set(key, items);
    return items;
  };

  for (const u of ctx.unlocks.values()) {
    if (!u.conditions?.length) continue;
    const owned = ancestors(u.id);
    const avail = availableUnder(owned);
    for (const c of u.conditions) {
      if ((c.t === 'sold' || c.t === 'produced') && ctx.items.has(c.item) && !avail.has(c.item)) {
        ctx.err('condition_unreachable', `unlock ${u.id} needs ${c.t} ${c.item}, which its prerequisites cannot produce (progression soft-lock)`, u.id);
      }
      if (c.t === 'sold' && ctx.items.has(c.item)) {
        const seller = [...ctx.buildings.values()].some((b) => b.sells?.includes(c.item) && (b.unlock === undefined || owned.has(b.unlock)));
        if (!seller) ctx.err('condition_no_seller', `unlock ${u.id} needs sold ${c.item}, but no business selling it is unlocked by its prerequisites`, u.id);
      }
      if (c.t === 'level') {
        const b = ctx.buildings.get(c.building);
        if (b?.unlock && !owned.has(b.unlock)) ctx.err('condition_unreachable', `unlock ${u.id} needs ${c.building} L${c.level}, which its prerequisites do not unlock`, u.id);
      }
    }
  }

  for (const r of ctx.recipes.values()) {
    const m = ctx.machines.get(r.machine);
    if (!m) continue;
    const host = hostsOf(m).sort((a, b) => bCh(a) - bCh(b))[0];
    const gates = [r.unlock, m.unlock, host?.unlock].filter((g): g is string => !!g && ctx.unlocks.has(g));
    const owned = new Set<string>(gates);
    for (const g of gates) for (const a of ancestors(g)) owned.add(a);
    const avail = availableUnder(owned);
    for (const i of r.inputs) {
      if (!avail.has(i.item)) ctx.warn('recipe_input_gated', `recipe ${r.id}: input ${i.item} needs an unlock that is not a prerequisite of the recipe`, r.id);
    }
  }
}

// ───────────────────────────── i18n ─────────────────────────────

/** All i18n keys the content requires, per the convention in types.ts. */
export function requiredI18nKeys(packs: ContentPack[]): string[] {
  const keys: string[] = [];
  for (const p of packs) {
    for (const x of p.items) keys.push(`item.${x.id}`);
    for (const x of p.recipes) keys.push(`recipe.${x.id}`);
    for (const x of p.machines) keys.push(`machine.${x.id}`);
    for (const x of p.buildings) keys.push(`building.${x.id}`, `building.${x.id}.desc`);
    for (const x of p.unlocks) keys.push(`unlock.${x.id}`, `unlock.${x.id}.desc`);
  }
  return keys;
}

function checkI18n(ctx: Ctx, en: Record<string, string>, he: Record<string, string>): void {
  const pack: ContentPack = {
    items: [...ctx.items.values()],
    recipes: [...ctx.recipes.values()],
    machines: [...ctx.machines.values()],
    buildings: [...ctx.buildings.values()],
    unlocks: [...ctx.unlocks.values()],
    sources: [],
    demand: [],
  };
  const required = new Set(requiredI18nKeys([pack]));
  const HEB = /[֐-׿]/;
  for (const key of required) {
    for (const [lang, table] of [['en', en], ['he', he]] as const) {
      const v = table[key];
      if (typeof v !== 'string' || !v.trim()) {
        ctx.err('missing_i18n', `missing ${lang} string for "${key}"`, key);
        continue;
      }
      if (lang === 'he' && !HEB.test(v)) ctx.warn('i18n_not_hebrew', `he string for "${key}" contains no Hebrew letters`, key);
      if (lang === 'en' && HEB.test(v)) ctx.warn('i18n_hebrew_in_en', `en string for "${key}" contains Hebrew`, key);
      if (/^(item|recipe|machine|building)\.[a-z0-9_]+$/.test(key) && [...v].length > 24) ctx.warn('i18n_long_name', `${lang} name for "${key}" is ${[...v].length} chars (UI chips prefer ≤ 24)`, key);
    }
  }
  for (const [lang, table] of [['en', en], ['he', he]] as const) {
    for (const key of Object.keys(table)) if (!required.has(key)) ctx.warn('i18n_orphan_key', `${lang} key "${key}" matches no content id`, key);
  }
}
