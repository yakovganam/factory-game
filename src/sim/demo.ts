/**
 * A reference opening layout (the same one the balance tests use). Used for the title-screen
 * backdrop and deterministic screenshot scenes; never applied to a player's city.
 */
import type { Sim } from './game';

export function applyDemoLayout(sim: Sim, f = 'ws1') {
  const run = (c: Parameters<Sim['exec']>[0]) => sim.exec(c);
  run({ t: 'tutorialFlag', flag: 'viewed_interior' });
  run({ t: 'import', f, items: { wood_pieces: 60, carton_flat: 30 } });
  const docks = sim.s.factories[f].entities.filter((e) => e.def === 'receiving_dock');
  run({ t: 'setFilter', f, e: docks.find((d) => d.y === 1)!.id, item: 'wood_pieces' });
  // Cartons are stock-fed into the packer from receiving storage (no belt needed).
  run({ t: 'setFilter', f, e: docks.find((d) => d.y === 4)!.id, item: 'wood_pieces' });
  run({ t: 'place', f, def: 'assembly_bench', x: 3, y: 1, rot: 0 });
  run({ t: 'placeBelts', f, tiles: [{ x: 1, y: 1, rot: 0 }, { x: 2, y: 1, rot: 0 }] });
  run({ t: 'placeBelts', f, tiles: [{ x: 5, y: 1, rot: 0 }, { x: 6, y: 1, rot: 1 }, { x: 6, y: 2, rot: 0 }, { x: 7, y: 2, rot: 0 }] });
  run({ t: 'place', f, def: 'packing_station', x: 8, y: 2, rot: 1 });
  const packer = sim.s.factories[f].entities.find((e) => e.def === 'packing_station')!;
  run({ t: 'setRecipe', f, e: packer.id, recipe: 'pack_blocks' });
  run({ t: 'placeBelts', f, tiles: [{ x: 8, y: 1, rot: 3 }] });
}
