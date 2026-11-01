import { describe, expect, it } from 'vitest';
import { hashState } from '../src/sim/core';
import { START_CASH, Sim } from '../src/sim/game';
import { buildOpeningLine, db, expectedStock, ledgerSum, makeSim, min, ok, sec, STORE, worldStock, WS } from './helpers';

function strip(o: Record<string, number>) {
  const r: Record<string, number> = {};
  for (const k in o) if (o[k]) r[k] = o[k];
  return r;
}

describe('opening production-to-sale loop', () => {
  it('produces, ships, stocks the toy store and sells within a few minutes', () => {
    const sim = makeSim();
    buildOpeningLine(sim);
    let firstSaleTick = -1;
    for (let t = 0; t < min(10) && firstSaleTick < 0; t++) {
      sim.step();
      if ((sim.s.stats.sold.boxed_blocks ?? 0) > 0) firstSaleTick = sim.s.tick;
    }
    expect(firstSaleTick).toBeGreaterThan(0);
    // Playtest target: first sale within ~5 minutes of starting the line.
    expect(firstSaleTick).toBeLessThan(min(5));
    expect(sim.s.stats.produced.block_set).toBeGreaterThan(0);
    expect(sim.s.stats.produced.boxed_blocks).toBeGreaterThan(0);
    expect(sim.s.ledger.total.sales).toBeGreaterThan(0);
  });

  it('advances the tutorial through the first sale', () => {
    const sim = makeSim();
    buildOpeningLine(sim);
    sim.run(min(6));
    expect(sim.s.tutorial.step).toBeGreaterThanOrEqual(9); // past first_sale
  });
});

describe('conservation and accounting invariants', () => {
  it('never creates or destroys goods (world stock == flow balance) over a long run with commands', () => {
    const sim = makeSim(99);
    buildOpeningLine(sim);
    for (let i = 0; i < 40; i++) {
      sim.run(sec(30));
      expect(strip(worldStock(sim.s))).toEqual(expectedStock(sim.s));
      // Disruptive commands mid-run must also conserve goods.
      if (i === 5) {
        const bench = sim.s.factories[WS].entities.find((e) => e.def === 'assembly_bench')!;
        ok(sim, { t: 'setRecipe', f: WS, e: bench.id, recipe: 'make_block_set' });
      }
      if (i === 8) {
        const belt = sim.s.factories[WS].entities.find((e) => e.kind === 'belt' && e.items.length > 0);
        if (belt) ok(sim, { t: 'remove', f: WS, e: belt.id });
        ok(sim, { t: 'placeBelts', f: WS, tiles: [{ x: 6, y: 2, rot: 0 }] });
      }
      if (i % 6 === 0) sim.exec({ t: 'import', f: WS, items: { wood_pieces: 40, carton_flat: 20 } });
      if (i === 12) {
        const o = sim.s.orders.find((x) => x.status === 'offered');
        if (o) ok(sim, { t: 'acceptOrder', id: o.id });
      }
    }
    expect(sim.s.stats.sold.boxed_blocks ?? 0).toBeGreaterThan(10);
  });

  it('keeps the ledger reconciled with cash, and never goes negative on inventory', () => {
    const sim = makeSim(5);
    buildOpeningLine(sim);
    sim.run(min(15));
    expect(sim.s.cash).toBe(START_CASH + ledgerSum(sim.s));
    const all = [
      ...Object.values(sim.s.factories).flatMap((f) => [f.inbound, f.outbound, f.reserved, f.incoming]),
      ...Object.values(sim.s.stores).flatMap((s) => [s.backroom, s.incoming]),
    ];
    for (const rec of all) for (const k in rec) expect(rec[k]).toBeGreaterThan(0);
  });

  it('internal transfers (workshop -> own store) create no revenue; only customer sales do', () => {
    const sim = makeSim(7);
    buildOpeningLine(sim);
    // Run until the first restock delivery lands but before any sale can be checked out.
    let delivered = false;
    for (let t = 0; t < min(8) && !delivered; t++) {
      sim.step();
      for (const e of sim.ev.drain()) if (e.t === 'delivered' && e.kind === 'restock') delivered = true;
    }
    expect(delivered).toBe(true);
    const sales = sim.s.ledger.total.sales ?? 0;
    const soldUnits = Object.values(sim.s.stats.sold).reduce((a, b) => a + b, 0);
    const pricesSum = soldUnits * sim.s.stores[STORE].prices.boxed_blocks;
    expect(sales).toBe(pricesSum);
  });

  it('shipments reserve stock: reserved never exceeds outbound', () => {
    const sim = makeSim(11);
    buildOpeningLine(sim);
    for (let t = 0; t < min(12); t++) {
      sim.step();
      if (t % 50 === 0) {
        const f = sim.s.factories[WS];
        for (const k in f.reserved) expect(f.reserved[k]).toBeLessThanOrEqual(f.outbound[k] ?? 0);
      }
    }
  });

  it('a full output stops the machine with a blocked reason (not silent)', () => {
    const sim = makeSim(3);
    ok(sim, { t: 'import', f: WS, items: { wood_pieces: 60 } });
    ok(sim, { t: 'place', f: WS, def: 'assembly_bench', x: 3, y: 1, rot: 0 });
    const bench = sim.s.factories[WS].entities.find((e) => e.def === 'assembly_bench')!;
    ok(sim, { t: 'setRecipe', f: WS, e: bench.id, recipe: 'make_block_set' });
    ok(sim, { t: 'placeBelts', f: WS, tiles: [{ x: 1, y: 1, rot: 0 }, { x: 2, y: 1, rot: 0 }, { x: 5, y: 1, rot: 0 }] });
    sim.run(min(3));
    const b = sim.s.factories[WS].entities.find((e) => e.id === bench.id)!;
    expect(b.kind === 'machine' && b.status).toBe('blocked');
  });

  it('missing input starves with the missing item named', () => {
    const sim = makeSim(3);
    ok(sim, { t: 'place', f: WS, def: 'packing_station', x: 3, y: 1, rot: 0 });
    const p = sim.s.factories[WS].entities.find((e) => e.def === 'packing_station')!;
    ok(sim, { t: 'setRecipe', f: WS, e: p.id, recipe: 'pack_blocks' });
    sim.run(5);
    const m = sim.s.factories[WS].entities.find((e) => e.id === p.id)!;
    expect(m.kind === 'machine' && m.status).toBe('starved');
    expect(m.kind === 'machine' && m.statusItem).toBe('block_set');
  });

  it('power cap prevents starting machines beyond grid capacity', () => {
    const sim = makeSim(4);
    const f = sim.s.factories[WS];
    f.staff = 4;
    f.inbound = { wood_pieces: 100 };
    // 3 benches (0.5 kW each) + capacity 8 kW: fits. Force a tiny cap to test.
    const lvl = db.buildings.get('toy_workshop')!.levels[0];
    const saved = lvl.powerCapKw;
    lvl.powerCapKw = 0.6;
    try {
      for (const y of [1, 3, 5]) {
        ok(sim, { t: 'place', f: WS, def: 'assembly_bench', x: 4, y, rot: 0 });
      }
      for (const e of f.entities) if (e.def === 'assembly_bench' && e.kind === 'machine') { e.recipe = 'make_block_set'; e.inv = { wood_pieces: 8 }; }
      sim.run(3);
      const st = f.entities.filter((e) => e.def === 'assembly_bench').map((e) => (e.kind === 'machine' ? e.status : ''));
      expect(st.filter((x) => x === 'working').length).toBe(1);
      expect(st.filter((x) => x === 'no_power').length).toBe(2);
    } finally {
      lvl.powerCapKw = saved;
    }
  });
});

describe('determinism, save/load and offline equivalence', () => {
  it('same seed + same commands => identical state hash', () => {
    const a = makeSim(42);
    const b = makeSim(42);
    buildOpeningLine(a);
    buildOpeningLine(b);
    a.run(min(8));
    b.run(min(8));
    expect(hashState(a.s)).toBe(hashState(b.s));
  });

  it('save -> JSON -> load mid-run continues identically to an uninterrupted run', () => {
    const a = makeSim(77);
    buildOpeningLine(a);
    a.run(min(4));
    const json = JSON.stringify(a.s);
    const b = new Sim(db, JSON.parse(json));
    a.run(min(6));
    b.run(min(6));
    expect(hashState(b.s)).toBe(hashState(a.s));
  });

  it('chunked stepping equals continuous stepping', () => {
    const a = makeSim(8);
    const b = makeSim(8);
    buildOpeningLine(a);
    buildOpeningLine(b);
    a.run(min(5));
    for (let i = 0; i < 300; i++) b.run(10);
    expect(hashState(a.s)).toBe(hashState(b.s));
  });
});

describe('recovery paths', () => {
  it('grant is offered only when cash is low, and has a cooldown', () => {
    const sim = makeSim(1);
    expect(sim.exec({ t: 'claimGrant' }).ok).toBe(false);
    sim.s.cash = 1000;
    expect(sim.exec({ t: 'claimGrant' }).ok).toBe(true);
    sim.s.cash = 1000;
    expect(sim.exec({ t: 'claimGrant' }).ok).toBe(false);
  });

  it('early construction is fully refundable', () => {
    const sim = makeSim(1);
    const cash0 = sim.s.cash;
    const r = ok(sim, { t: 'place', f: WS, def: 'assembly_bench', x: 3, y: 1, rot: 0 });
    ok(sim, { t: 'remove', f: WS, e: r.id! });
    expect(sim.s.cash).toBe(cash0);
  });

  it('rejects impossible commands with explainable reasons', () => {
    const sim = makeSim(1);
    const r1 = sim.exec({ t: 'place', f: WS, def: 'assembly_bench', x: 9, y: 6, rot: 0 });
    expect(r1.ok === false && r1.reason).toBe('err.out_of_bounds');
    const r2 = sim.exec({ t: 'import', f: WS, items: { wood_pieces: 100000 } });
    expect(r2.ok === false && r2.reason).toBe('err.receiving_full');
    const r3 = sim.exec({ t: 'place', f: WS, def: 'robot_assembler', x: 3, y: 3, rot: 0 });
    expect(r3.ok === false && r3.reason).toBe('err.locked');
    const r4 = sim.exec({ t: 'remove', f: WS, e: sim.s.factories[WS].entities[0].id });
    expect(r4.ok === false && r4.reason).toBe('err.fixed_bay');
  });
});

describe('regressions', () => {
  it('a workshop expansion completing mid-operation does not teleport goods between belts', async () => {
    const { buildOpeningLine: open } = await import('./helpers');
    const sim = makeSim(1);
    open(sim);
    sim.run(min(2));
    sim.s.unlocked.push('ch1_workshop_l2');
    sim.s.cash += 300000;
    ok(sim, { t: 'upgradeBuilding', id: WS });
    for (let i = 0; i < min(2); i++) {
      sim.step();
      const f = sim.s.factories[WS];
      for (const e of f.entities) {
        if (e.kind !== 'belt') continue;
        const onBlockPath = (e.x === 5 && e.y === 1) || (e.x === 6 && e.y <= 2) || (e.x === 7 && e.y === 2);
        if (onBlockPath) for (const it of e.items) expect(it.item).not.toBe('wood_pieces');
      }
    }
    expect(sim.s.factories[WS].level).toBe(2);
    expect(strip(worldStock(sim.s))).toEqual(expectedStock(sim.s));
  });

  it('contract offers are rate-limited and active contracts are capped', () => {
    const sim = makeSim(2);
    sim.s.tutorial.skipped = true;
    let accepted = 0;
    for (let i = 0; i < min(20); i++) {
      sim.step();
      for (const o of sim.s.orders) if (o.status === 'offered' && sim.exec({ t: 'acceptOrder', id: o.id }).ok) accepted++;
    }
    // 20 minutes at one offer per 90 s at most => <= 14 offers; at most 3 active at once.
    expect(sim.s.orders.length).toBeLessThanOrEqual(15);
    expect(sim.s.orders.filter((o) => o.status === 'accepted' || o.status === 'dispatched').length).toBeLessThanOrEqual(3);
    expect(accepted).toBeLessThanOrEqual(3);
  });
});
