/**
 * Scripted "reasonable player" balance run for the opening (chapter 1).
 * Measures pacing milestones and writes docs/qa/balance-report.md.
 * Run: npx tsx tools/balance.ts [minutes] [seed]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildDB } from '../src/content/db';
import { ch1 } from '../src/content/data/ch1_workshop';
import { newGame, Sim } from '../src/sim/game';
import { unlockState } from '../src/sim/progression';
import { sumQty } from '../src/sim/core';
import { TPS } from '../src/sim/types';
import type { Command } from '../src/sim/commands';

export interface BalanceResult {
  seed: number;
  minutes: number;
  milestones: Record<string, number | null>;
  timeline: { min: number; cash: number; revenue: number; sold: Record<string, number>; level: number; staff: number }[];
  finalCash: number;
  revenue: number;
  log: string[];
}

export function runBalance(minutes = 40, seed = 1): BalanceResult {
  const db = buildDB([ch1]);
  const sim = new Sim(db, newGame(db, seed));
  const s = sim.s;
  const F = 'ws1';
  const log: string[] = [];
  const ms: Record<string, number | null> = { firstImport: null, firstProduct: null, firstSale: null, toyCar: null, firstOrderDone: null, carLine: null, l2Research: null, level2: null, robot: null };
  const T = () => +(s.tick / TPS / 60).toFixed(2);
  const run = (c: Command) => {
    const r = sim.exec(c);
    if (!r.ok) log.push(`${T()}m FAIL ${c.t}: ${r.reason} ${JSON.stringify(r.params ?? {})}`);
    return r;
  };
  const f = () => s.factories[F];
  const ent = (def: string) => f().entities.filter((e) => e.def === def);
  // Opening: player takes ~40 s to read and order, ~90 s to build the first line.
  sim.run(TPS * 40);
  run({ t: 'tutorialFlag', flag: 'viewed_interior' });
  run({ t: 'import', f: F, items: { wood_pieces: 40 } });
  ms.firstImport = T();
  sim.run(TPS * 30);
  const docks = ent('receiving_dock');
  run({ t: 'place', f: F, def: 'assembly_bench', x: 3, y: 1, rot: 0 });
  run({ t: 'placeBelts', f: F, tiles: [{ x: 1, y: 1, rot: 0 }, { x: 2, y: 1, rot: 0 }] });
  sim.run(TPS * 30);
  run({ t: 'placeBelts', f: F, tiles: [{ x: 5, y: 1, rot: 0 }, { x: 6, y: 1, rot: 1 }, { x: 6, y: 2, rot: 0 }, { x: 7, y: 2, rot: 0 }] });
  run({ t: 'place', f: F, def: 'packing_station', x: 8, y: 2, rot: 1 });
  run({ t: 'setRecipe', f: F, e: ent('packing_station')[0].id, recipe: 'pack_blocks' });
  run({ t: 'import', f: F, items: { carton_flat: 20 } });
  sim.run(TPS * 20);
  run({ t: 'placeBelts', f: F, tiles: [{ x: 8, y: 1, rot: 3 }] });

  const timeline: BalanceResult['timeline'] = [];
  let carLineBuilt = false;
  for (let tick = 0; s.tick < minutes * 60 * TPS; tick++) {
    sim.step();
    if (s.tick % (TPS * 5) !== 0) continue;
    const fac = f();
    const inv = (k: string) => (fac.inbound[k] ?? 0) + (fac.incoming[k] ?? 0);
    // Imports: keep a working buffer (a player checking every ~5 s while playing).
    const want: Record<string, number> = {};
    if (inv('wood_pieces') < 24) want.wood_pieces = carLineBuilt ? 60 : 40;
    if (inv('carton_flat') < 10) want.carton_flat = 20;
    if (carLineBuilt && inv('toy_wheels') < 8) want.toy_wheels = 20;
    if (carLineBuilt && inv('paint_can') < 8) want.paint_can = 20;
    if (Object.keys(want).length && s.cash > 3000) run({ t: 'import', f: F, items: want });
    // Orders.
    for (const o of s.orders) if (o.status === "offered" && s.tick % 600 < 50 && Object.keys(o.items).every((k) => k === 'boxed_blocks' || (carLineBuilt && k === 'boxed_car'))) run({ t: 'acceptOrder', id: o.id });
    // Research.
    if (!s.unlocked.includes('ch1_toy_car') && unlockState(s, db, 'ch1_toy_car') === 'available' && s.cash > 25000) {
      run({ t: 'research', id: 'ch1_toy_car' });
      ms.toyCar = T();
    }
    if (s.unlocked.includes('ch1_toy_car') && !carLineBuilt && s.cash > 72000) {
      // Second line in the same hall (fits at level 1).
      run({ t: 'hire', f: F, n: 3 });
      run({ t: 'setFilter', f: F, e: docks.find((d) => d.y === 4)!.id, item: 'wood_pieces' });
      run({ t: 'placeBelts', f: F, tiles: [{ x: 1, y: 4, rot: 0 }, { x: 2, y: 4, rot: 0 }] });
      run({ t: 'place', f: F, def: 'assembly_bench', x: 3, y: 4, rot: 0 });
      run({ t: 'setRecipe', f: F, e: ent('assembly_bench')[1].id, recipe: 'make_toy_car_raw' });
      run({ t: 'placeBelts', f: F, tiles: [{ x: 5, y: 4, rot: 0 }] });
      run({ t: 'place', f: F, def: 'paint_booth', x: 6, y: 4, rot: 0 });
      run({ t: 'setRecipe', f: F, e: ent('paint_booth')[0].id, recipe: 'paint_toy_car' });
      run({ t: 'placeBelts', f: F, tiles: [{ x: 8, y: 4, rot: 0 }, { x: 9, y: 4, rot: 3 }] });
      run({ t: 'place', f: F, def: 'packing_station', x: 9, y: 2, rot: 1 });
      const p2 = ent("packing_station")[1]; if (!p2) { console.log(log.join("\n")); throw new Error("no packer2"); }
      run({ t: "setRecipe", f: F, e: p2.id, recipe: "pack_car" });
      run({ t: 'placeBelts', f: F, tiles: [{ x: 9, y: 1, rot: 3 }] });
      run({ t: 'import', f: F, items: { toy_wheels: 20, paint_can: 20 } });
      carLineBuilt = true;
      ms.carLine = T();
    }
    if (ms.firstProduct === null && (s.stats.produced.boxed_blocks ?? 0) > 0) ms.firstProduct = T();
    if (ms.firstSale === null && Object.values(s.stats.sold).some((n) => n > 0)) ms.firstSale = T();
    if (ms.firstOrderDone === null && s.stats.ordersCompleted > 0) ms.firstOrderDone = T();
    if (!s.unlocked.includes('ch1_workshop_l2') && unlockState(s, db, 'ch1_workshop_l2') === 'available' && s.cash > 45000) {
      run({ t: 'research', id: 'ch1_workshop_l2' });
      ms.l2Research = T();
    }
    if (s.unlocked.includes('ch1_workshop_l2') && fac.level === 1 && fac.upgradeTicks === 0 && s.cash > 165000) run({ t: 'upgradeBuilding', id: F });
    if (ms.level2 === null && fac.level >= 2) ms.level2 = T();
    if (s.tick % (TPS * 60) === 0) {
      timeline.push({ min: T(), cash: s.cash, revenue: (s.ledger.total.sales ?? 0) + (s.ledger.total.contracts ?? 0), sold: { ...s.stats.sold }, level: fac.level, staff: fac.staff });
    }
    void sumQty;
  }
  if (process.env.BAL_DEBUG) {
    const st = s.stores.store1;
    console.log('produced', s.stats.produced, '\nsold', s.stats.sold, '\nlost', s.stats.lostSales, '\norders', s.stats.ordersCompleted, s.orders.map((o) => o.status + JSON.stringify(o.items)).join(' '), '\nshelves', JSON.stringify(st.shelves), 'back', st.backroom, 'inc', st.incoming, 'queue', st.queue.length, 'staff', st.staff, '\nfactory out', f().outbound, 'res', f().reserved, 'inb', f().inbound, '\nvans', s.vehicles.map((v) => v.state));
    for (const e of f().entities) if (e.kind === 'machine') console.log(e.def, e.x, e.y, e.rot, e.status, e.statusItem ?? '', e.recipe, JSON.stringify(e.inv), JSON.stringify(e.out)); else console.log('belt', e.x, e.y, e.rot, e.items.map((i) => i.item + '@' + i.pos).join(','));
  }
  return { seed, minutes, milestones: ms, timeline, finalCash: s.cash, revenue: (s.ledger.total.sales ?? 0) + (s.ledger.total.contracts ?? 0), log };
}

if (process.argv[1]?.endsWith('balance.ts')) {
  const minutes = Number(process.argv[2] ?? 40);
  const seeds = [1, 2, 3, 4, 5];
  const results = seeds.map((sd) => runBalance(minutes, sd));
  const fmt = (c: number) => `$${(c / 100).toFixed(0)}`;
  let md = `# Opening balance report (scripted player)\n\nGenerated by \`npx tsx tools/balance.ts ${minutes}\` on ${new Date().toISOString().slice(0, 10)}.\n\n`;
  md += `This is a simulation of a *reasonable scripted player* (it reacts every 5 s, never makes mistakes, and builds a known-good layout). It checks that the opening economy is coherent and has no dead ends. **It is not a substitute for real playtesting**; humans will be slower and less efficient.\n\n`;
  md += `| Seed | First import | First boxed product | First sale | Toy car research | Car line | First order done | L2 research | Level 2 | Revenue @${minutes}m | Cash @${minutes}m |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    const m = r.milestones;
    const v = (x: number | null) => (x === null ? '—' : `${x.toFixed(1)} min`);
    md += `| ${r.seed} | ${v(m.firstImport)} | ${v(m.firstProduct)} | ${v(m.firstSale)} | ${v(m.toyCar)} | ${v(m.carLine)} | ${v(m.firstOrderDone)} | ${v(m.l2Research)} | ${v(m.level2)} | ${fmt(r.revenue)} | ${fmt(r.finalCash)} |\n`;
  }
  md += `\n## Timeline (seed 1)\n\n| Minute | Cash | Revenue | Sold (blocks / cars) | Level | Staff |\n|---|---|---|---|---|---|\n`;
  for (const p of results[0].timeline.filter((_, i) => i % 2 === 0)) md += `| ${p.min.toFixed(0)} | ${fmt(p.cash)} | ${fmt(p.revenue)} | ${p.sold.boxed_blocks ?? 0} / ${p.sold.boxed_car ?? 0} | ${p.level} | ${p.staff} |\n`;
  const fails = results.flatMap((r) => r.log.map((l) => `seed ${r.seed}: ${l}`));
  md += `\n## Rejected commands during the run\n\n${fails.length ? fails.slice(0, 30).map((l) => `- ${l}`).join('\n') : 'None.'}\n`;
  mkdirSync('docs/qa', { recursive: true });
  writeFileSync('docs/qa/balance-report.md', md);
  console.log(md);
}
