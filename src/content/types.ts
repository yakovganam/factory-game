/**
 * Content contract — the single schema for all data-driven game content.
 *
 * Conventions (enforced by src/content/validate.ts):
 *  - Money is integer cents. Never floats.
 *  - Durations are integer seconds of simulation time at 1x speed.
 *  - Quantities are integer units.
 *  - Every id is lower_snake_case and globally unique within its table.
 *  - Display text is never stored here: only i18n keys (see src/i18n/<lang>/content.json).
 *    Key convention: `item.<id>`, `recipe.<id>`, `machine.<id>`, `building.<id>`,
 *    `building.<id>.desc`, `unlock.<id>`, `unlock.<id>.desc`.
 */

export type ItemId = string;
export type RecipeId = string;
export type MachineId = string;
export type BuildingId = string;
export type UnlockId = string;
export type SourceId = string;

/** Storage class determines which storage a unit can occupy and how it spoils. */
export type StorageClass = 'dry' | 'cold' | 'frozen' | 'liquid' | 'bulk' | 'fragile';

export type ItemCategory =
  | 'raw' // extracted or harvested foundational resource
  | 'material' // processed bulk material (lumber, steel, flour)
  | 'component' // part used in further assembly
  | 'product' // finished, unpackaged consumer or industrial good
  | 'packaged' // finished good ready for retail/freight
  | 'packaging' // cartons, bottles, cans used to package other goods
  | 'byproduct' // offcuts, scrap, waste streams
  | 'service'; // non-physical deliverable (construction progress, parcels)

export interface ItemDef {
  id: ItemId;
  category: ItemCategory;
  /** 0 = raw … 6 = advanced high tech. Used for progression placement. */
  tier: number;
  /** Reference market value per unit in cents (anchor for pricing and stock valuation). */
  baseValue: number;
  /** Storage/freight volume per unit, in crate slots (1 = one small crate). */
  volume: number;
  storage: StorageClass;
  /** Game seconds until a unit spoils. Omitted = non-perishable. */
  shelfLifeSec?: number;
  /** True if residents/visitors buy it through retail. */
  consumer?: boolean;
  /** Visual model id for the item (src/render/models). Defaults to `item_<id>`. */
  model?: string;
  tags?: string[];
}

export interface Stack {
  item: ItemId;
  qty: number;
}

export interface OutputStack extends Stack {
  /** Optional deterministic chance in permille (0..1000) for byproducts/grades. Default 1000. */
  chancePermille?: number;
}

export interface RecipeDef {
  id: RecipeId;
  /** Machine class that executes the recipe. */
  machine: MachineId;
  inputs: Stack[];
  outputs: OutputStack[];
  /** Processing time in integer seconds at Mk1 speed. */
  durationSec: number;
  /** Water use per cycle in litres (optional utility). */
  waterL?: number;
  /** Unlock that enables this recipe. Omitted = available when its machine is available. */
  unlock?: UnlockId;
  /** Marks legitimate recycling/recovery recipes so cycle validation treats them explicitly. */
  recycling?: boolean;
  tags?: string[];
}

/** Generic animation archetypes the presentation layer knows how to drive from sim state. */
export type MachineAnim =
  | 'dock'
  | 'bench'
  | 'arm'
  | 'booth'
  | 'packer'
  | 'press'
  | 'saw'
  | 'mixer'
  | 'oven'
  | 'kiln'
  | 'furnace'
  | 'loom'
  | 'extruder'
  | 'molder'
  | 'tester'
  | 'tank'
  | 'storage'
  | 'splitter'
  | 'cnc'
  | 'cleanroom'
  | 'winder'
  | 'filler';

export interface MachineDef {
  id: MachineId;
  /** Footprint in interior tiles [along local X (front axis), along local Z] at rotation 0. */
  footprint: [number, number];
  /** Build cost in cents. */
  cost: number;
  /** Power draw in kW while working (idle draw is 10%). */
  powerKw: number;
  /** Workers required to operate. 0 = automated. */
  staff: number;
  /** Maintenance in cents per minute of operation. */
  maintenancePerMin: number;
  /** Input buffer capacity, measured in recipe crafts that may be pre-loaded. */
  inputCrafts: number;
  /** Output buffer capacity in units. */
  outputCap: number;
  /** Speed multiplier in percent per upgrade tier, index 0 = Mk1 (100). */
  speedPct: number[];
  /** Upgrade cost in cents to reach tier index i (index 0 unused). */
  upgradeCost: number[];
  anim: MachineAnim;
  /** Render model id. */
  model: string;
  /** Building types this machine may be placed in. */
  buildings: BuildingId[];
  /** Unlock gating placement. Omitted = available with the building. */
  unlock?: UnlockId;
  /** Special roles handled by the simulation rather than by recipes. */
  role?: 'receiving' | 'shipping' | 'storage' | 'splitter' | 'belt';
  /** Storage capacity in units for role 'storage'. */
  storageCap?: number;
  /** If true the machine is structural (a loading bay) and cannot be placed/removed by the player. */
  fixed?: boolean;
}

export type BuildingKind =
  | 'factory' // counts toward the 50 manufacturing types
  | 'business' // counts toward the 10 retail/logistics/service businesses
  | 'resource' // farms, forests, mines (do not count)
  | 'utility' // power, water (do not count)
  | 'supplier' // import depot / contracts (do not count)
  | 'residential'
  | 'civic'
  | 'decoration';

/** A structural loading bay at a fixed interior position for a building level. */
export interface BayDef {
  machine: MachineId;
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
}

export interface BuildingLevelDef {
  level: number;
  /** Cost in cents to reach this level (level 1 = construction cost). */
  cost: number;
  /** Interior grid size in tiles [w, h]. Expansion only grows toward +x/+y so existing layouts survive. */
  interior: [number, number];
  /** Grid connection capacity in kW. */
  powerCapKw: number;
  /** Units of inbound (receiving) and outbound (shipping) dock storage. */
  inboundCap: number;
  outboundCap: number;
  /** Max hired staff. */
  staffCap: number;
  bays: BayDef[];
  /** Machines that become placeable at this level. */
  unlocksMachines?: MachineId[];
  /** Unlock required before this level can be purchased. */
  requires?: UnlockId;
  /** Short design note of what physically changes (for art + completion matrix). */
  visualChange: string;
}

/** Special management mechanics; each maps to a simulation module (see docs/factory-matrix.md). */
export type MechanicTag =
  | 'assembly_balance'
  | 'cutting_layout'
  | 'batch_press'
  | 'drying_capacity'
  | 'water_use'
  | 'freight_dimensions'
  | 'changeover'
  | 'color_batches'
  | 'cutting_waste'
  | 'paired_items'
  | 'curing'
  | 'furnace_flow'
  | 'cooling'
  | 'input_mix'
  | 'heat_stages'
  | 'bulk_transport'
  | 'energy_intensive'
  | 'spec_variants'
  | 'spool_capacity'
  | 'mold_change'
  | 'material_recovery'
  | 'delivery_timing'
  | 'kiln_loading'
  | 'contamination'
  | 'tolerance'
  | 'tool_specialization'
  | 'performance_test'
  | 'extraction_yield'
  | 'storage_segregation'
  | 'freshness'
  | 'shaping_choice'
  | 'cold_chain'
  | 'shelf_life'
  | 'aging'
  | 'synchronization'
  | 'seasonal'
  | 'sterilization'
  | 'freezing'
  | 'tempering'
  | 'flavor_variants'
  | 'inspection'
  | 'yield'
  | 'clean_production'
  | 'formation'
  | 'quality_sorting'
  | 'configurable_spec'
  | 'precision'
  | 'feature_tradeoff'
  | 'acoustic_test'
  | 'product_tiers'
  | 'bulky_assembly'
  | 'calibration'
  | 'burn_in'
  | 'task_modules'
  | 'test_flight'
  | 'customization'
  | 'charging_test'
  | 'multi_line'
  | 'load_test'
  | 'efficiency_grading'
  | 'traceability'
  | 'large_orders'
  | 'site_coordination'
  // businesses
  | 'shelf_allocation'
  | 'checkout_queue'
  | 'assortment'
  | 'trends'
  | 'display_space'
  | 'delivery_schedule'
  | 'occupancy'
  | 'service_quality'
  | 'routes'
  | 'parcel_capacity'
  | 'dispatch_policy'
  | 'picking'
  | 'order_batching'
  | 'project_materials';

export interface BuildingDef {
  id: BuildingId;
  kind: BuildingKind;
  /** 1..50 for manufacturing types (matches the design catalog). */
  factoryIndex?: number;
  /** 1..10 for the required non-manufacturing businesses. */
  businessIndex?: number;
  /** Progression chapter (1 = workshop … 7 = high tech city). */
  chapter: number;
  /** City footprint in metres [w, d] of the plot at max level. */
  plot: [number, number];
  levels: BuildingLevelDef[];
  /** Machine classes placeable inside. */
  machines: MachineId[];
  mechanics: MechanicTag[];
  /** One-sentence production identity and distinguishing decision (design reference, English). */
  identity: string;
  /** Unlock gating construction. Omitted = available from the start. */
  unlock?: UnlockId;
  /** Exterior render model id. */
  model: string;
  /** For businesses: items it sells or consumes. */
  sells?: ItemId[];
  consumes?: ItemId[];
}

export type SourceKind = 'import' | 'farm' | 'forest' | 'mine' | 'recycling' | 'utility' | 'well' | 'fishery';

/**
 * How a foundational item enters the economy. Every item that no recipe produces
 * must have at least one source; bootstrap-critical items need an 'import' source.
 */
export interface SourceDef {
  id: SourceId;
  item: ItemId;
  kind: SourceKind;
  /** Purchase price per unit in cents for imports (always > 0). */
  unitPrice: number;
  /** Max units per minute the source can supply (finite supply). */
  ratePerMin: number;
  /** Resource building that produces it (for non-import kinds). */
  building?: BuildingId;
  unlock?: UnlockId;
}

export type UnlockCondition =
  | { t: 'sold'; item: ItemId; qty: number }
  | { t: 'produced'; item: ItemId; qty: number }
  | { t: 'level'; building: BuildingId; level: number }
  | { t: 'revenue'; cents: number }
  | { t: 'orders'; count: number };

export interface UnlockDef {
  id: UnlockId;
  chapter: number;
  /** Research cost in cents (0 = free once conditions are met). */
  cost: number;
  requires: UnlockId[];
  conditions?: UnlockCondition[];
  /** Icon/category for the research UI. */
  category: 'product' | 'machine' | 'building' | 'logistics' | 'management' | 'city';
}

/** A retail demand profile: how much the city wants a consumer item. */
export interface DemandDef {
  item: ItemId;
  /** Units per minute per 1000 residents at reference price. Stored as milli-units (1000 = 1/min). */
  baseMilliPerMinPer1000: number;
  /** Reference consumer price in cents. */
  refPrice: number;
}

export interface ContentPack {
  items: ItemDef[];
  recipes: RecipeDef[];
  machines: MachineDef[];
  buildings: BuildingDef[];
  sources: SourceDef[];
  unlocks: UnlockDef[];
  demand: DemandDef[];
}
