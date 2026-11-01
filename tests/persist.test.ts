import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashState } from '../src/sim/core';
import { Sim } from '../src/sim/game';
import { catchUpSync, OFFLINE_HORIZON_SEC, planCatchUp } from '../src/sim/offline';
import { makeEnvelope, MemoryBackend, parseEnvelope, SaveManager, serialize } from '../src/persist/saves';
import { buildOpeningLine, db, makeSim, min } from './helpers';

describe('save system', () => {
  it('round-trips a running game through a backend with identical continuation', async () => {
    const a = makeSim(21);
    buildOpeningLine(a);
    a.run(min(3));
    const mgr = new SaveManager(new MemoryBackend());
    await mgr.save(a.s, 0);
    const r = await mgr.load(0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = new Sim(db, r.env.state);
    a.run(min(2));
    b.run(min(2));
    expect(hashState(b.s)).toBe(hashState(a.s));
  });

  it('recovers from the backup when the primary save is corrupted (interrupted write)', async () => {
    const a = makeSim(22);
    buildOpeningLine(a);
    const mem = new MemoryBackend();
    const mgr = new SaveManager(mem);
    a.run(min(1));
    await mgr.save(a.s, 1);
    const firstHash = hashState(a.s);
    a.run(min(1));
    await mgr.save(a.s, 1); // previous save rotates into slot1.bak
    mem.poke('slot1', '{"format":"tftc-save","version":1,"state":{"trunc'); // torn write
    const r = await mgr.load(1);
    expect(r.ok && r.recovered).toBe(true);
    if (r.ok) expect(hashState(r.env.state)).toBe(firstHash);
  });

  it('detects tampering/bit-rot via checksum', () => {
    const a = makeSim(23);
    const env = makeEnvelope(a.s, 0, 1000);
    const text = serialize(env).replace('"cash":150000', '"cash":999999999');
    const r = parseEnvelope(text);
    expect(r.ok).toBe(false);
  });

  it('refuses saves from a newer, unknown version instead of corrupting them', () => {
    const a = makeSim(24);
    const env = makeEnvelope(a.s, 0, 1000);
    env.version = 999;
    const r = parseEnvelope(serialize(env));
    expect(r.ok === false && r.reason).toBe('unsupported');
  });

  it('migrates the committed v0 fixture to the current version and keeps playing', () => {
    const path = new URL('./fixtures/save_v0.json', import.meta.url);
    expect(existsSync(path)).toBe(true);
    const r = parseEnvelope(readFileSync(path, 'utf8'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(0);
    const sim = new Sim(db, r.env.state);
    sim.run(min(2));
    expect(sim.s.stats.consumed).toBeDefined();
    expect(sim.s.cash).toBeGreaterThan(0);
  });
});

describe('offline catch-up', () => {
  it('equals online stepping for the same elapsed time (same simulation, no shortcuts)', () => {
    const online = makeSim(31);
    buildOpeningLine(online);
    online.s.wallMs = 1_000_000;
    online.run(min(1));
    const offline = new Sim(db, JSON.parse(JSON.stringify(online.s)));
    online.run(min(10));
    const plan = catchUpSync(offline, offline.s.wallMs + 10 * 60 * 1000);
    expect(plan.ticks).toBe(min(10));
    offline.s.wallMs = online.s.wallMs; // wall clock is bookkeeping, not simulation
    offline.s.meta.offlineTicksGranted = 0;
    expect(hashState(offline.s)).toBe(hashState(online.s));
  });

  it('never grants the same interval twice and ignores clocks moving backwards', () => {
    const sim = makeSim(32);
    sim.s.wallMs = 10_000_000;
    const now = sim.s.wallMs + 60_000;
    expect(catchUpSync(sim, now).ticks).toBe(600);
    expect(catchUpSync(sim, now).ticks).toBe(0);
    const back = planCatchUp(sim, now - 3_600_000);
    expect(back.ticks).toBe(0);
    expect(back.clockSkew).toBe(true);
  });

  it('clamps to the disclosed horizon', () => {
    const sim = makeSim(33);
    sim.s.wallMs = 1;
    const plan = planCatchUp(sim, 1 + 3 * OFFLINE_HORIZON_SEC * 1000);
    expect(plan.clamped).toBe(true);
    expect(plan.ticks).toBe(OFFLINE_HORIZON_SEC * 10);
  });

  it('offline time respects stock: an idle line earns nothing but still pays wages', () => {
    const sim = makeSim(34);
    sim.s.wallMs = 5_000;
    const cash0 = sim.s.cash;
    catchUpSync(sim, 5_000 + 30 * 60 * 1000);
    expect(sim.s.ledger.total.sales ?? 0).toBe(0);
    expect(sim.s.cash).toBeLessThan(cash0);
  });
});

describe('offline compute budget', () => {
  it('limits catch-up on slow devices / large cities and says so', () => {
    const sim = makeSim(35);
    sim.s.wallMs = 1;
    const plan = planCatchUp(sim, 1 + 4 * 3600 * 1000, 1.0); // 1 ms per tick measured
    expect(plan.budgetClamped).toBe(true);
    expect(plan.ticks).toBeLessThanOrEqual(15000);
    expect(planCatchUp(sim, 1 + 4 * 3600 * 1000, 0.01).budgetClamped).toBe(false);
  });
});
