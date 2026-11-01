/**
 * Foundational resources — raw items, resource/utility/recycling buildings and every raw source
 * (farms, forests, mines, recycling collection, imports) — plus the compact builder helpers the
 * chapter files use. Builders only expand shorthand into plain ContentPack data; they hold no state.
 *
 * Pricing rule of thumb: an internal source (farm, mine, recycling) is cheaper than the matching
 * import, so building the supply chain pays off, while imports keep every chapter bootstrappable.
 */
import type {
  BayDef,
  BuildingDef,
  BuildingKind,
  BuildingLevelDef,
  ContentPack,
  ItemCategory,
  ItemDef,
  MachineAnim,
  MachineDef,
  MechanicTag,
  OutputStack,
  RecipeDef,
  SourceDef,
  SourceKind,
  Stack,
  StorageClass,
  UnlockCondition,
  UnlockDef,
} from '../types';

// ───────────────────────────── builders ─────────────────────────────

const round100 = (n: number): number => Math.round(n / 100) * 100;

/** Parse `"a*2,b,c*3@500"` → stacks (qty defaults to 1, `@` = chance in permille). */
export function stacks(spec: string): OutputStack[] {
  if (!spec.trim()) return [];
  return spec.split(',').map((part) => {
    const [main, chance] = part.trim().split('@');
    const [item, qty] = main.split('*');
    const s: OutputStack = { item: item.trim(), qty: qty ? Number(qty) : 1 };
    if (chance) s.chancePermille = Number(chance);
    return s;
  });
}

export function item(
  id: string,
  category: ItemCategory,
  tier: number,
  baseValue: number,
  storage: StorageClass = 'dry',
  extra: Partial<ItemDef> = {},
): ItemDef {
  return { id, category, tier, baseValue, volume: 1, storage, ...extra };
}

export function recipe(
  id: string,
  machine: string,
  ins: string,
  outs: string,
  durationSec: number,
  extra: Partial<RecipeDef> = {},
): RecipeDef {
  const inputs: Stack[] = stacks(ins).map(({ item: i, qty }) => ({ item: i, qty }));
  return { id, machine, inputs, outputs: stacks(outs), durationSec, ...extra };
}

export function machine(
  id: string,
  buildings: string[],
  anim: MachineAnim,
  footprint: [number, number],
  cost: number,
  powerKw: number,
  staff: number,
  maintenancePerMin: number,
  extra: Partial<MachineDef> = {},
): MachineDef {
  return {
    id,
    footprint,
    cost,
    powerKw,
    staff,
    maintenancePerMin,
    inputCrafts: 2,
    outputCap: 8,
    speedPct: [100, 140, 180],
    upgradeCost: [0, round100(cost * 1.2), round100(cost * 2.8)],
    anim,
    model: `mach_${id}`,
    buildings,
    ...extra,
  };
}

/** Fixed receiving (`<prefix>_in`) and shipping (`<prefix>_out`) loading bays. */
export function bays(prefix: string, buildings: string[]): MachineDef[] {
  const base = {
    footprint: [1, 2] as [number, number],
    cost: 0,
    powerKw: 0.5,
    staff: 0,
    maintenancePerMin: 0,
    inputCrafts: 0,
    outputCap: 0,
    speedPct: [100],
    upgradeCost: [0],
    anim: 'dock' as MachineAnim,
    buildings,
    fixed: true,
  };
  return [
    { ...base, id: `${prefix}_in`, model: `mach_${prefix}_in`, role: 'receiving' },
    { ...base, id: `${prefix}_out`, model: `mach_${prefix}_out`, role: 'shipping' },
  ];
}

/** Shared in-plant logistics available in every factory except the ch1 workshop (see catalog.ts). */
export const LOGISTICS = ['conveyor', 'pallet_rack', 'flow_splitter'];

/** Receiving bays on the west wall (x = 0), shipping bays on the north wall (y = 0). Existing bays never move. */
function bayLayout(prefix: string, sizes: [number, number][], lvl: number): BayDef[] {
  const out: BayDef[] = [];
  const h = sizes[lvl][1];
  for (const y of [1, 4, 7, 10, 13].filter((v) => v + 2 <= h).slice(0, lvl + 1)) {
    out.push({ machine: `${prefix}_in`, x: 0, y, rot: 0 });
  }
  const xs = new Set<number>();
  for (let i = 0; i <= lvl; i++) xs.add(sizes[i][0] - 2);
  for (const x of xs) out.push({ machine: `${prefix}_out`, x, y: 0, rot: 3 });
  return out;
}

export interface SiteSpec {
  id: string;
  kind: 'factory' | 'business';
  index: number;
  chapter: number;
  plot: [number, number];
  unlock: string;
  machines: string[];
  mechanics: MechanicTag[];
  identity: string;
  /** Level-1 interior; later levels add `grow` (default [4, 2]) per level toward +x/+y. */
  interior: [number, number];
  grow?: [number, number];
  /** Level-1 construction cost (cents); level 2 = ×3, level 3 = ×8. */
  cost: number;
  /** Level-1 grid capacity (kW); ×2.2 and ×4.5 for levels 2–3. */
  kw: number;
  staff: number;
  /** Level-1 dock storage (units); ×2 and ×4 for levels 2–3. */
  dock?: number;
  /** Bay machine prefix (`<bay>_in` / `<bay>_out`). Omit for counter-service shops. */
  bay?: string;
  visual: [string, string, string];
  l2: UnlockCondition[];
  l3: UnlockCondition[];
  /** Extra prerequisites (beyond the building / previous level) for the level-2 and level-3 unlocks. */
  l2Req?: string[];
  l3Req?: string[];
  l2Machines?: string[];
  l3Machines?: string[];
  sells?: string[];
  consumes?: string[];
}

/** Expand a 3-level factory/business spec and generate its `<id>_l2` / `<id>_l3` unlocks. */
export function site(s: SiteSpec): { building: BuildingDef; unlocks: UnlockDef[] } {
  const [dx, dy] = s.grow ?? [4, 2];
  const sizes: [number, number][] = [0, 1, 2].map((i) => [s.interior[0] + dx * i, s.interior[1] + dy * i]);
  const costMul = [1, 3, 8];
  const kwMul = [1, 2.2, 4.5];
  const staffMul = [1, 2, 3];
  const dockMul = [1, 2, 4];
  const levels: BuildingLevelDef[] = sizes.map((interior, i) => {
    const lvl: BuildingLevelDef = {
      level: i + 1,
      cost: round100(s.cost * costMul[i]),
      interior,
      powerCapKw: Math.round(s.kw * kwMul[i]),
      inboundCap: (s.dock ?? 0) * dockMul[i],
      outboundCap: (s.dock ?? 0) * dockMul[i],
      staffCap: s.staff * staffMul[i],
      bays: s.bay ? bayLayout(s.bay, sizes, i) : [],
      visualChange: s.visual[i],
    };
    if (i > 0) lvl.requires = `${s.id}_l${i + 1}`;
    const um = i === 1 ? s.l2Machines : i === 2 ? s.l3Machines : undefined;
    if (um) lvl.unlocksMachines = um;
    return lvl;
  });
  const machines = [...(s.bay ? [`${s.bay}_in`, `${s.bay}_out`] : []), ...s.machines];
  if (s.kind === 'factory') machines.push(...LOGISTICS);
  const building: BuildingDef = {
    id: s.id,
    kind: s.kind,
    ...(s.kind === 'factory' ? { factoryIndex: s.index } : { businessIndex: s.index }),
    chapter: s.chapter,
    plot: s.plot,
    levels,
    machines,
    mechanics: s.mechanics,
    identity: s.identity,
    unlock: s.unlock,
    model: `bld_${s.id}`,
    ...(s.sells ? { sells: s.sells } : {}),
    ...(s.consumes ? { consumes: s.consumes } : {}),
  };
  const unlocks: UnlockDef[] = [
    { id: `${s.id}_l2`, chapter: s.chapter, cost: round100(s.cost * 0.4), requires: [s.unlock, ...(s.l2Req ?? [])], conditions: s.l2, category: 'building' },
    { id: `${s.id}_l3`, chapter: s.chapter, cost: round100(s.cost), requires: [`${s.id}_l2`, ...(s.l3Req ?? [])], conditions: s.l3, category: 'building' },
  ];
  return { building, unlocks };
}

/** Merge site() results into pack tables. */
export function collect(sites: { building: BuildingDef; unlocks: UnlockDef[] }[]): { buildings: BuildingDef[]; unlocks: UnlockDef[] } {
  return { buildings: sites.map((x) => x.building), unlocks: sites.flatMap((x) => x.unlocks) };
}

/** Single-level outdoor building (farm, mine, utility) with no interior layout. */
export function yard(
  id: string,
  kind: BuildingKind,
  chapter: number,
  plot: [number, number],
  cost: number,
  identity: string,
  visualChange: string,
  unlock?: string,
): BuildingDef {
  return {
    id,
    kind,
    chapter,
    plot,
    machines: [],
    mechanics: [],
    identity,
    model: `bld_${id}`,
    ...(unlock ? { unlock } : {}),
    levels: [{ level: 1, cost, interior: [1, 1], powerCapKw: 0, inboundCap: 0, outboundCap: 0, staffCap: 0, bays: [], visualChange }],
  };
}

export function source(
  id: string,
  itemId: string,
  kind: SourceKind,
  unitPrice: number,
  ratePerMin: number,
  building?: string,
  unlock?: string,
): SourceDef {
  return { id, item: itemId, kind, unitPrice, ratePerMin, ...(building ? { building } : {}), ...(unlock ? { unlock } : {}) };
}

// ───────────────────────────── data ─────────────────────────────

const RC = 'recycling_center';

const rawItems: ItemDef[] = [
  // Farms & forests
  item('log', 'raw', 0, 50, 'bulk', { volume: 2, tags: ['wood'] }),
  item('wheat', 'raw', 0, 8, 'bulk', { tags: ['food'] }),
  item('raw_milk', 'raw', 0, 10, 'cold', { shelfLifeSec: 900, tags: ['food', 'dairy'] }),
  item('fruit', 'raw', 0, 15, 'cold', { shelfLifeSec: 1800, tags: ['food'] }),
  item('potato', 'raw', 0, 6, 'dry', { shelfLifeSec: 3600, tags: ['food'] }),
  item('tomato', 'raw', 0, 8, 'cold', { shelfLifeSec: 1200, tags: ['food'] }),
  item('vegetables', 'raw', 0, 10, 'cold', { shelfLifeSec: 1200, tags: ['food'] }),
  item('cotton', 'raw', 0, 20, 'dry', { tags: ['textile'] }),
  item('natural_rubber', 'raw', 0, 40, 'liquid', { tags: ['rubber'] }),
  // Pits, quarries & mines
  item('clay', 'raw', 0, 4, 'bulk'),
  item('limestone', 'raw', 0, 5, 'bulk'),
  item('aggregate', 'raw', 0, 3, 'bulk'),
  item('sand', 'raw', 0, 3, 'bulk'),
  item('iron_ore', 'raw', 0, 12, 'bulk', { tags: ['metal'] }),
  item('bauxite', 'raw', 0, 10, 'bulk', { tags: ['metal'] }),
  // Imported commodities
  item('polymer_feedstock', 'raw', 1, 30, 'liquid', { tags: ['plastic'] }),
  item('sugar', 'raw', 0, 12, 'dry', { tags: ['food'] }),
  item('salt', 'raw', 0, 4, 'dry', { tags: ['food'] }),
  item('vegetable_oil', 'raw', 0, 25, 'liquid', { tags: ['food'] }),
  item('cocoa_beans', 'raw', 1, 60, 'dry', { tags: ['food', 'exotic'] }),
  item('coffee_beans', 'raw', 1, 50, 'dry', { tags: ['food', 'exotic'] }),
  item('flavor_concentrate', 'raw', 1, 80, 'liquid', { tags: ['food'] }),
  item('soda_ash', 'raw', 1, 15, 'bulk'),
  item('coke', 'raw', 1, 20, 'bulk'),
  item('pigment', 'raw', 1, 50, 'dry', { tags: ['paint'] }),
  item('copper_cathode', 'material', 1, 120, 'dry', { tags: ['metal'] }),
  item('tin_ingot', 'material', 1, 200, 'dry', { tags: ['metal'] }),
  item('carbon_black', 'raw', 1, 30, 'dry', { tags: ['rubber'] }),
  item('leather', 'material', 1, 180, 'dry', { tags: ['textile'] }),
  // Recycling collection streams (also factory byproducts)
  item('waste_paper', 'byproduct', 0, 3, 'bulk', { tags: ['recycled', 'paper'] }),
  item('mixed_scrap_metal', 'byproduct', 0, 8, 'bulk', { tags: ['recycled', 'metal'] }),
  item('cullet', 'byproduct', 0, 4, 'bulk', { tags: ['recycled', 'glass'] }),
  item('plastic_scrap', 'byproduct', 0, 10, 'bulk', { tags: ['recycled', 'plastic'] }),
  item('cable_scrap', 'byproduct', 1, 40, 'bulk', { tags: ['recycled', 'metal'] }),
  // Exotic high-tech imports (import-only by design)
  item('silicon_wafer', 'component', 5, 6000, 'fragile', { tags: ['electronics', 'exotic'] }),
  item('specialty_gas', 'material', 5, 500, 'liquid', { tags: ['electronics', 'exotic'] }),
  item('display_panel', 'component', 5, 4000, 'fragile', { tags: ['electronics', 'exotic'] }),
  item('lens_blank', 'component', 5, 600, 'fragile', { tags: ['optics', 'exotic'] }),
  item('mems_sensor', 'component', 5, 300, 'fragile', { tags: ['electronics', 'exotic'] }),
  item('lithium_salt', 'material', 4, 150, 'dry', { tags: ['battery', 'exotic'] }),
  item('graphite', 'material', 4, 60, 'dry', { tags: ['battery', 'exotic'] }),
  item('rare_earth_magnet', 'component', 4, 250, 'dry', { tags: ['electrical', 'exotic'] }),
  item('solar_wafer', 'component', 5, 300, 'fragile', { tags: ['electronics', 'exotic'] }),
];

const recyclingMachines: MachineDef[] = [
  ...bays('bay_recycle', [RC]),
  machine('scrap_sorter', [RC], 'splitter', [3, 2], 45000, 8, 1, 4, { unlock: 'ch4_bulk_freight' }),
  machine('cable_stripper', [RC], 'saw', [2, 2], 38000, 5, 1, 3, { unlock: 'ch4_cable' }),
];

const recyclingRecipes: RecipeDef[] = [
  recipe('sort_mixed_scrap', 'scrap_sorter', 'mixed_scrap_metal*10', 'steel_scrap*6,aluminum_scrap*2', 12, { recycling: true }),
  recipe('strip_cable_scrap', 'cable_stripper', 'cable_scrap*4', 'copper_cathode*1,plastic_scrap*1', 15, { recycling: true }),
];

const buildings: BuildingDef[] = [
  yard('tree_farm', 'resource', 2, [30, 30], 60000, 'Managed forest plots that grow and fell logs on a replanting cycle.', 'Rows of young pines, a log deck and a skidder.', 'ch2_sawmill'),
  yard('grain_farm', 'resource', 3, [32, 32], 50000, 'Wheat fields harvested in seasonal waves.', 'Golden fields, a combine and twin grain bins.', 'ch3_grain_mill'),
  yard('dairy_farm', 'resource', 3, [28, 24], 80000, 'Milking parlour supplying chilled raw milk that spoils quickly.', 'Red barn, cows, and a steel milk tank.', 'ch3_dairy'),
  yard('orchard', 'resource', 3, [28, 28], 55000, 'Fruit orchard with a strong seasonal harvest peak.', 'Apple trees in rows with stacked picking crates.', 'ch3_grain_mill'),
  yard('veg_farm', 'resource', 3, [30, 26], 45000, 'Field vegetables, potatoes and tomatoes for food processing.', 'Striped crop rows, polytunnels and a packing shed.', 'ch3_grain_mill'),
  yard('cotton_farm', 'resource', 5, [32, 28], 70000, 'Cotton fields with a once-a-season harvest.', 'White cotton rows and a bale press.', 'ch5_textile'),
  yard('rubber_plantation', 'resource', 4, [30, 30], 90000, 'Tapped rubber trees yielding natural latex.', 'Tall trees with tapping cups and a latex shed.', 'ch4_tire'),
  yard('clay_pit', 'resource', 4, [24, 24], 40000, 'Open clay pit for bricks, tiles and cement.', 'Terraced orange pit with an excavator.', 'ch4_bulk_freight'),
  yard('quarry', 'resource', 4, [30, 30], 90000, 'Limestone and aggregate quarry for glass, steel and concrete.', 'Grey benches, crusher and conveyor stockpiles.', 'ch4_bulk_freight'),
  yard('sand_pit', 'resource', 4, [24, 24], 35000, 'Washed sand for glass and concrete.', 'Sand dunes, a wash plant and a loader.', 'ch4_bulk_freight'),
  yard('iron_mine', 'resource', 4, [30, 30], 150000, 'Open-cut iron ore mine feeding the blast furnace.', 'Rust-red pit, haul trucks and a headframe.', 'ch4_steelworks'),
  yard('bauxite_mine', 'resource', 4, [28, 28], 130000, 'Bauxite strip mine for alumina refining.', 'Ochre terraces and a conveyor to a stockpile.', 'ch4_aluminum'),
  yard('power_plant', 'utility', 2, [26, 22], 300000, 'Gas-fired power plant that raises the city grid capacity.', 'Turbine hall with twin cooling stacks.', 'ch2_sawmill'),
  yard('water_works', 'utility', 2, [22, 20], 160000, 'Treats and pumps process water for mills and food plants.', 'Settling ponds, pump house and a water tower.', 'ch2_paper_mill'),
  yard('solar_farm', 'utility', 7, [30, 26], 400000, 'Field of tracking solar arrays feeding the grid.', 'Rows of blue panels on steel trackers.', 'ch7_solar'),
  {
    id: RC,
    kind: 'resource',
    chapter: 2,
    plot: [22, 16],
    machines: recyclingMachines.map((m) => m.id),
    mechanics: ['material_recovery'],
    identity: 'Collects city waste streams and sorts mixed scrap and cable so recovered material can re-enter production.',
    model: `bld_${RC}`,
    unlock: 'ch2_recycling',
    levels: [
      {
        level: 1, cost: 90000, interior: [10, 6], powerCapKw: 20, inboundCap: 200, outboundCap: 200, staffCap: 4,
        bays: [{ machine: 'bay_recycle_in', x: 0, y: 1, rot: 0 }, { machine: 'bay_recycle_out', x: 8, y: 0, rot: 3 }],
        visualChange: 'Sorting shed with colour-coded bins and a baler.',
      },
      {
        level: 2, cost: 260000, interior: [14, 8], powerCapKw: 45, inboundCap: 400, outboundCap: 400, staffCap: 8, requires: 'ch4_bulk_freight',
        bays: [
          { machine: 'bay_recycle_in', x: 0, y: 1, rot: 0 },
          { machine: 'bay_recycle_in', x: 0, y: 4, rot: 0 },
          { machine: 'bay_recycle_out', x: 8, y: 0, rot: 3 },
          { machine: 'bay_recycle_out', x: 12, y: 0, rot: 3 },
        ],
        visualChange: 'Second hall with magnetic separator and scrap pile.',
      },
    ],
  },
];

const F = 'farm';
const sources: SourceDef[] = [
  source('forest_log', 'log', 'forest', 25, 120, 'tree_farm', 'ch2_sawmill'),
  source('imp_log', 'log', 'import', 60, 200, undefined, 'ch2_sawmill'),
  source('farm_wheat', 'wheat', F, 4, 300, 'grain_farm', 'ch3_grain_mill'),
  source('imp_wheat', 'wheat', 'import', 10, 400, undefined, 'ch3_grain_mill'),
  source('farm_raw_milk', 'raw_milk', F, 5, 240, 'dairy_farm', 'ch3_dairy'),
  source('imp_raw_milk', 'raw_milk', 'import', 13, 200, undefined, 'ch3_dairy'),
  source('farm_fruit', 'fruit', F, 8, 180, 'orchard', 'ch3_grain_mill'),
  source('imp_fruit', 'fruit', 'import', 20, 200, undefined, 'ch3_grain_mill'),
  source('farm_potato', 'potato', F, 3, 300, 'veg_farm', 'ch3_grain_mill'),
  source('imp_potato', 'potato', 'import', 8, 300, undefined, 'ch3_grain_mill'),
  source('farm_tomato', 'tomato', F, 4, 240, 'veg_farm', 'ch3_grain_mill'),
  source('imp_tomato', 'tomato', 'import', 11, 200, undefined, 'ch3_grain_mill'),
  source('farm_vegetables', 'vegetables', F, 5, 240, 'veg_farm', 'ch3_grain_mill'),
  source('imp_vegetables', 'vegetables', 'import', 13, 200, undefined, 'ch3_grain_mill'),
  source('farm_cotton', 'cotton', F, 10, 150, 'cotton_farm', 'ch5_textile'),
  source('imp_cotton', 'cotton', 'import', 26, 200, undefined, 'ch5_textile'),
  source('farm_natural_rubber', 'natural_rubber', F, 22, 90, 'rubber_plantation', 'ch4_tire'),
  source('imp_natural_rubber', 'natural_rubber', 'import', 50, 120, undefined, 'ch4_tire'),
  source('mine_clay', 'clay', 'mine', 2, 400, 'clay_pit', 'ch4_bulk_freight'),
  source('imp_clay', 'clay', 'import', 6, 400, undefined, 'ch4_bulk_freight'),
  source('mine_limestone', 'limestone', 'mine', 2, 400, 'quarry', 'ch4_bulk_freight'),
  source('imp_limestone', 'limestone', 'import', 7, 400, undefined, 'ch4_bulk_freight'),
  source('mine_aggregate', 'aggregate', 'mine', 1, 600, 'quarry', 'ch4_bulk_freight'),
  source('imp_aggregate', 'aggregate', 'import', 5, 600, undefined, 'ch4_bulk_freight'),
  source('mine_sand', 'sand', 'mine', 1, 600, 'sand_pit', 'ch4_bulk_freight'),
  source('imp_sand', 'sand', 'import', 5, 600, undefined, 'ch4_bulk_freight'),
  source('mine_iron_ore', 'iron_ore', 'mine', 6, 300, 'iron_mine', 'ch4_steelworks'),
  source('imp_iron_ore', 'iron_ore', 'import', 16, 300, undefined, 'ch4_bulk_freight'),
  source('mine_bauxite', 'bauxite', 'mine', 5, 300, 'bauxite_mine', 'ch4_aluminum'),
  source('imp_bauxite', 'bauxite', 'import', 14, 300, undefined, 'ch4_bulk_freight'),
  source('imp_polymer_feedstock', 'polymer_feedstock', 'import', 30, 400, undefined, 'ch4_bulk_freight'),
  source('imp_sugar', 'sugar', 'import', 12, 400, undefined, 'ch3_grain_mill'),
  source('imp_salt', 'salt', 'import', 4, 400, undefined, 'ch3_grain_mill'),
  source('imp_vegetable_oil', 'vegetable_oil', 'import', 25, 300, undefined, 'ch3_grain_mill'),
  source('imp_cocoa_beans', 'cocoa_beans', 'import', 60, 200, undefined, 'ch3_chocolate'),
  source('imp_coffee_beans', 'coffee_beans', 'import', 50, 200, undefined, 'ch3_cafe'),
  source('imp_flavor_concentrate', 'flavor_concentrate', 'import', 80, 120, undefined, 'ch3_beverage'),
  source('imp_soda_ash', 'soda_ash', 'import', 15, 300, undefined, 'ch4_bulk_freight'),
  source('imp_coke', 'coke', 'import', 20, 300, undefined, 'ch4_bulk_freight'),
  source('imp_pigment', 'pigment', 'import', 50, 200, undefined, 'ch4_bulk_freight'),
  source('imp_copper_cathode', 'copper_cathode', 'import', 120, 200, undefined, 'ch4_bulk_freight'),
  source('imp_tin_ingot', 'tin_ingot', 'import', 200, 100, undefined, 'ch4_bulk_freight'),
  source('imp_carbon_black', 'carbon_black', 'import', 30, 200, undefined, 'ch4_bulk_freight'),
  source('imp_leather', 'leather', 'import', 180, 120, undefined, 'ch5_textile'),
  source('rec_waste_paper', 'waste_paper', 'recycling', 2, 300, RC, 'ch2_recycling'),
  source('rec_mixed_scrap_metal', 'mixed_scrap_metal', 'recycling', 3, 200, RC, 'ch4_bulk_freight'),
  source('rec_cullet', 'cullet', 'recycling', 2, 200, RC, 'ch4_bulk_freight'),
  source('rec_plastic_scrap', 'plastic_scrap', 'recycling', 4, 200, RC, 'ch4_bulk_freight'),
  source('rec_cable_scrap', 'cable_scrap', 'recycling', 15, 60, RC, 'ch4_cable'),
  source('imp_silicon_wafer', 'silicon_wafer', 'import', 6000, 20, undefined, 'ch6_semiconductor'),
  source('imp_specialty_gas', 'specialty_gas', 'import', 500, 60, undefined, 'ch6_semiconductor'),
  source('imp_display_panel', 'display_panel', 'import', 4000, 40, undefined, 'ch6_pcb'),
  source('imp_lens_blank', 'lens_blank', 'import', 600, 60, undefined, 'ch6_camera'),
  source('imp_mems_sensor', 'mems_sensor', 'import', 300, 80, undefined, 'ch6_pcb'),
  source('imp_lithium_salt', 'lithium_salt', 'import', 150, 120, undefined, 'ch6_battery'),
  source('imp_graphite', 'graphite', 'import', 60, 120, undefined, 'ch6_battery'),
  source('imp_rare_earth_magnet', 'rare_earth_magnet', 'import', 250, 80, undefined, 'ch6_pcb'),
  source('imp_solar_wafer', 'solar_wafer', 'import', 300, 80, undefined, 'ch7_solar'),
];

export const resources: ContentPack = {
  items: rawItems,
  recipes: recyclingRecipes,
  machines: recyclingMachines,
  buildings,
  sources,
  unlocks: [],
  demand: [],
};
