import { buildDB } from '../src/content/db';
import { ch1 } from '../src/content/data/ch1_workshop';
import { factoryContents } from '../src/sim/factory';
import { newGame, Sim } from '../src/sim/game';
import type { Command } from '../src/sim/commands';
import type { Dir, GameState } from '../src/sim/types';
import { TPS } from '../src/sim/types';

export const db = buildDB([ch1]);

export function makeSim(seed = 1234): Sim {
  return new Sim(db, newGame(db, seed));
}

export function ok(sim: Sim, cmd: Command) {
  const r = sim.exec(cmd);
  if (!r.ok) throw new Error(`command ${cmd.t} failed: ${r.reason} ${JSON.stringify(r.params ?? {})}`);
  return r;
}

export const WS = 'ws1';
export const STORE = 'store1';

/** The reference opening layout used by balance + regression tests (fits the 10×7 level-1 hall). */
export function buildOpeningLine(sim: Sim) {
  ok(sim, { t: 'tutorialFlag', flag: 'viewed_interior' });
  ok(sim, { t: 'import', f: WS, items: { wood_pieces: 40, carton_flat: 20 } });
  const docks = sim.s.factories[WS].entities.filter((e) => e.def === 'receiving_dock');
  ok(sim, { t: 'setFilter', f: WS, e: docks.find((d) => d.y === 1)!.id, item: 'wood_pieces' });
  ok(sim, { t: 'setFilter', f: WS, e: docks.find((d) => d.y === 4)!.id, item: 'carton_flat' });
  ok(sim, { t: 'place', f: WS, def: 'assembly_bench', x: 3, y: 1, rot: 0 });
  const bench = sim.s.factories[WS].entities.find((e) => e.def === 'assembly_bench')!;
  ok(sim, { t: 'setRecipe', f: WS, e: bench.id, recipe: 'make_block_set' });
  ok(sim, { t: 'placeBelts', f: WS, tiles: [{ x: 1, y: 1, rot: 0 }, { x: 2, y: 1, rot: 0 }] });
  ok(sim, { t: 'placeBelts', f: WS, tiles: [{ x: 5, y: 1, rot: 0 }, { x: 6, y: 1, rot: 1 }, { x: 6, y: 2, rot: 0 }, { x: 7, y: 2, rot: 0 }] });
  ok(sim, { t: 'place', f: WS, def: 'packing_station', x: 8, y: 2, rot: 1 });
  const packer = sim.s.factories[WS].entities.find((e) => e.def === 'packing_station')!;
  ok(sim, { t: 'setRecipe', f: WS, e: packer.id, recipe: 'pack_blocks' });
  ok(sim, {
    t: 'placeBelts', f: WS,
    tiles: [
      ...[1, 2, 3, 4, 5, 6].map((x) => ({ x, y: 4, rot: 0 as Dir })),
      { x: 7, y: 4, rot: 3 as Dir },
      { x: 7, y: 3, rot: 0 as Dir },
    ],
  });
  ok(sim, { t: 'placeBelts', f: WS, tiles: [{ x: 8, y: 1, rot: 3 }] });
}

/** Units of each item physically present anywhere in the world. */
export function worldStock(s: GameState): Record<string, number> {
  const r: Record<string, number> = {};
  const add = (k: string, n: number) => (r[k] = (r[k] ?? 0) + n);
  for (const f of Object.values(s.factories)) {
    const c = factoryContents(f);
    for (const k in c) add(k, c[k]);
  }
  for (const v of s.vehicles) for (const k in v.cargo) add(k, v.cargo[k]);
  for (const st of Object.values(s.stores)) {
    for (const sl of st.shelves) if (sl.item) add(sl.item, sl.qty);
    for (const k in st.backroom) add(k, st.backroom[k]);
    for (const q of st.queue) add(q.item, 1);
  }
  return r;
}

/** Expected stock from flow counters: imported + produced − consumed − sold − order deliveries − sold back. */
export function expectedStock(s: GameState): Record<string, number> {
  const r: Record<string, number> = {};
  const keys = new Set([...Object.keys(s.stats.imported), ...Object.keys(s.stats.produced)]);
  for (const k of keys) {
    const n =
      (s.stats.imported[k] ?? 0) + (s.stats.produced[k] ?? 0) - (s.stats.consumed[k] ?? 0) - (s.stats.sold[k] ?? 0) - (s.stats.shipped[k] ?? 0) - (s.stats.soldBack[k] ?? 0);
    if (n !== 0) r[k] = n;
  }
  return r;
}

export function ledgerSum(s: GameState): number {
  let n = 0;
  for (const v of Object.values(s.ledger.total)) n += v ?? 0;
  return n;
}

export const sec = (n: number) => n * TPS;
export const min = (n: number) => n * TPS * 60;
