/**
 * Full content catalog: chapter 1 first (the playable slice), then every later chapter pack, then the shared
 * in-plant logistics machines (conveyor, pallet rack, splitter) whose building list is derived from the packs.
 * Validated by src/content/validate.ts (`npx tsx tools/validate-content.ts`).
 */
import { ch1 } from './data/ch1_workshop';
import { ch2 } from './data/ch2_wood_paper';
import { ch3a } from './data/ch3_food_staples';
import { ch3b } from './data/ch3_food_processed';
import { ch4a } from './data/ch4_materials';
import { ch4b } from './data/ch4_industry';
import { ch5 } from './data/ch5_textiles_logistics';
import { ch6a } from './data/ch6_electronics';
import { ch6b } from './data/ch6_devices';
import { ch7a } from './data/ch7_mobility';
import { ch7b } from './data/ch7_hightech';
import { LOGISTICS, resources } from './data/resources';
import type { ContentPack, MachineDef } from './types';

const CHAPTER_PACKS: ContentPack[] = [resources, ch2, ch3a, ch3b, ch4a, ch4b, ch5, ch6a, ch6b, ch7a, ch7b];

const logisticsBuildings = CHAPTER_PACKS.flatMap((p) => p.buildings)
  .filter((b) => LOGISTICS.every((m) => b.machines.includes(m)))
  .map((b) => b.id);

const shared = (id: string, extra: Partial<MachineDef>): MachineDef => ({
  id,
  footprint: [1, 1],
  cost: 0,
  powerKw: 0,
  staff: 0,
  maintenancePerMin: 0,
  inputCrafts: 0,
  outputCap: 0,
  speedPct: [100],
  upgradeCost: [0],
  anim: 'splitter',
  model: `mach_${id}`,
  buildings: logisticsBuildings,
  ...extra,
});

/** Conveyor, pallet rack and splitter shared by every factory except the ch1 workshop (which has its own). */
export const sharedLogistics: ContentPack = {
  items: [],
  recipes: [],
  machines: [
    shared('conveyor', { cost: 600, powerKw: 0.05, speedPct: [100, 200], upgradeCost: [0, 900], role: 'belt' }),
    shared('pallet_rack', { cost: 8000, anim: 'storage', role: 'storage', storageCap: 40 }),
    shared('flow_splitter', { cost: 5000, powerKw: 0.1, role: 'splitter' }),
  ],
  buildings: [],
  sources: [],
  unlocks: [],
  demand: [],
};

export const FULL_CATALOG: ContentPack[] = [ch1, ...CHAPTER_PACKS, sharedLogistics];

const all = <K extends keyof ContentPack>(k: K): ContentPack[K][number][] =>
  FULL_CATALOG.flatMap((p) => p[k] as ContentPack[K][number][]);

/** Headline counts (cheap to compute; the validator reports the authoritative stats). */
export const CATALOG_STATS = {
  items: all('items').length,
  recipes: all('recipes').length,
  machines: all('machines').length,
  buildings: all('buildings').length,
  factories: all('buildings').filter((b) => b.kind === 'factory').length,
  businesses: all('buildings').filter((b) => b.kind === 'business').length,
  sources: all('sources').length,
  unlocks: all('unlocks').length,
  demand: all('demand').length,
};
