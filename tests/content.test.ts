import { describe, expect, it } from 'vitest';
import { FULL_CATALOG } from '../src/content/catalog';
import type { BuildingDef, ContentPack, ItemDef, MachineDef, RecipeDef } from '../src/content/types';
import { validateContent } from '../src/content/validate';

// ───────────── tiny builders for deliberately broken packs ─────────────
const pack = (p: Partial<ContentPack>): ContentPack => ({ items: [], recipes: [], machines: [], buildings: [], sources: [], unlocks: [], demand: [], ...p });
const item = (id: string, extra: Partial<ItemDef> = {}): ItemDef => ({ id, category: 'material', tier: 1, baseValue: 10, volume: 1, storage: 'dry', ...extra });
const machine = (id: string, buildings: string[], extra: Partial<MachineDef> = {}): MachineDef => ({
  id, footprint: [1, 1], cost: 100, powerKw: 1, staff: 0, maintenancePerMin: 0, inputCrafts: 1, outputCap: 4,
  speedPct: [100], upgradeCost: [0], anim: 'bench', model: `mach_${id}`, buildings, ...extra,
});
const recipe = (id: string, m: string, inputs: [string, number][], outputs: [string, number][]): RecipeDef => ({
  id, machine: m, durationSec: 5, inputs: inputs.map(([i, qty]) => ({ item: i, qty })), outputs: outputs.map(([i, qty]) => ({ item: i, qty })),
});
const building = (id: string, machines: string[], extra: Partial<BuildingDef> = {}): BuildingDef => ({
  id, kind: 'resource', chapter: 1, plot: [10, 10], machines, mechanics: [], identity: 'test', model: `bld_${id}`,
  levels: [{ level: 1, cost: 0, interior: [10, 6], powerCapKw: 10, inboundCap: 10, outboundCap: 10, staffCap: 2, bays: [], visualChange: 'x' }],
  ...extra,
});
const codes = (p: ContentPack[], opts: Parameters<typeof validateContent>[1] = { i18n: false, factoryCount: 0, businessCount: 0 }): string[] =>
  validateContent(p, opts).errors.map((e) => e.code);

describe('full catalog', () => {
  const result = validateContent(FULL_CATALOG);

  it('validates with zero errors', () => {
    expect(result.errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
  });

  it('meets the scale targets', () => {
    expect(result.stats.items).toBeGreaterThanOrEqual(150);
    expect(result.stats.recipes).toBeGreaterThanOrEqual(200);
    expect(result.stats.factories).toBe(50);
    expect(result.stats.businesses).toBe(10);
    expect(result.stats.unlocks).toBeGreaterThan(100);
  });

  it('assigns factoryIndex 1..50 and businessIndex 1..10 exactly once', () => {
    const blds = FULL_CATALOG.flatMap((p) => p.buildings);
    const f = blds.filter((b) => b.kind === 'factory').map((b) => b.factoryIndex).sort((a, b) => a! - b!);
    const bz = blds.filter((b) => b.kind === 'business').map((b) => b.businessIndex).sort((a, b) => a! - b!);
    expect(f).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(bz).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it('gives every chapter-1 import an internal production route', () => {
    const recipes = FULL_CATALOG.flatMap((p) => p.recipes);
    for (const id of ['wood_pieces', 'carton_flat', 'plastic_parts', 'toy_wheels', 'paint_can', 'mini_motor', 'control_chip']) {
      expect(recipes.some((r) => r.outputs.some((o) => o.item === id)), id).toBe(true);
    }
  });

  it('keeps chapter 1 as the first pack', () => {
    expect(FULL_CATALOG[0].buildings.some((b) => b.id === 'toy_workshop')).toBe(true);
  });
});

describe('validator negative cases', () => {
  const B = 'test_plant';
  const M = 'test_machine';
  const host = (extraItems: ItemDef[], recipes: RecipeDef[], sources: ContentPack['sources'] = []): ContentPack =>
    pack({ items: extraItems, recipes, machines: [machine(M, [B])], buildings: [building(B, [M])], sources });

  it('flags an item with no source and no producer', () => {
    const p = host([item('ghost'), item('thing')], [recipe('make_thing', M, [['ghost', 1]], [['thing', 1]])]);
    expect(codes([p])).toContain('missing_source');
  });

  it('flags an unknown item reference', () => {
    const p = host([item('thing')], [recipe('make_thing', M, [['nope', 1]], [['thing', 1]])]);
    expect(codes([p])).toContain('unknown_item');
  });

  it('flags a recipe cycle with no bootstrap path', () => {
    const p = host([item('a'), item('b')], [recipe('a_to_b', M, [['a', 1]], [['b', 1]]), recipe('b_to_a', M, [['b', 1]], [['a', 1]])]);
    expect(codes([p])).toContain('unbootstrapped_cycle');
  });

  it('flags a value-creating loop from nothing', () => {
    const p = host(
      [item('x'), item('y')],
      [recipe('x_to_y', M, [['x', 1]], [['y', 2]]), recipe('y_to_x', M, [['y', 1]], [['x', 1]])],
      [{ id: 'imp_x', item: 'x', kind: 'import', unitPrice: 10, ratePerMin: 10 }],
    );
    expect(codes([p])).toContain('value_loop');
  });

  it('does not flag a lossy recycling loop', () => {
    const p = host(
      [item('x'), item('scrap', { category: 'byproduct', baseValue: 1 })],
      [recipe('use_x', M, [['x', 2]], [['scrap', 1]]), { ...recipe('recycle', M, [['scrap', 5]], [['x', 4]]), recycling: true }],
      [{ id: 'imp_x', item: 'x', kind: 'import', unitPrice: 10, ratePerMin: 10 }],
    );
    expect(codes([p])).not.toContain('value_loop');
  });

  it('flags a bay outside the interior', () => {
    const bay = machine('bay_test_out', [B], { footprint: [1, 2], role: 'shipping', fixed: true, anim: 'dock' });
    const b = building(B, ['bay_test_out']);
    b.levels[0].bays = [{ machine: 'bay_test_out', x: 9, y: 0, rot: 3 }];
    expect(codes([pack({ machines: [bay], buildings: [b] })])).toContain('bay_out_of_bounds');
  });

  it('flags a bay that is not on an edge', () => {
    const bay = machine('bay_test_in', [B], { footprint: [1, 2], role: 'receiving', fixed: true, anim: 'dock' });
    const b = building(B, ['bay_test_in']);
    b.levels[0].bays = [{ machine: 'bay_test_in', x: 4, y: 2, rot: 0 }];
    expect(codes([pack({ machines: [bay], buildings: [b] })])).toContain('bay_not_on_edge');
  });

  it('flags a duplicate factoryIndex', () => {
    const a = building('fac_a', [], { kind: 'factory', factoryIndex: 1 });
    const b = building('fac_b', [], { kind: 'factory', factoryIndex: 1 });
    expect(codes([pack({ buildings: [a, b] })], { i18n: false, factoryCount: 2, businessCount: 0 })).toContain('duplicate_factory_index');
  });

  it('flags shrinking interiors and too few levels', () => {
    const b = building('fac_c', [], { kind: 'factory', factoryIndex: 1 });
    b.levels.push({ ...b.levels[0], level: 2, cost: 100, interior: [8, 6] });
    const c = codes([pack({ buildings: [b] })], { i18n: false, factoryCount: 1, businessCount: 0 });
    expect(c).toContain('level_not_monotonic');
    expect(c).toContain('too_few_levels');
  });

  it('flags an unlock cycle and an orphan root', () => {
    const p = pack({
      unlocks: [
        { id: 'u_a', chapter: 2, cost: 0, requires: ['u_b'], category: 'product' },
        { id: 'u_b', chapter: 2, cost: 0, requires: ['u_a'], category: 'product' },
        { id: 'u_orphan', chapter: 3, cost: 0, requires: [], category: 'product' },
      ],
    });
    const c = codes([p]);
    expect(c).toContain('unlock_cycle');
    expect(c).toContain('unlock_orphan_root');
  });

  it('flags a chapter-2 input that cannot be bootstrapped from imports', () => {
    const p = host(
      [item('farmed'), item('goods')],
      [recipe('make_goods', M, [['farmed', 1]], [['goods', 1]])],
      [{ id: 'farm_farmed', item: 'farmed', kind: 'farm', unitPrice: 1, ratePerMin: 10, building: B }],
    );
    p.buildings[0].chapter = 2;
    expect(codes([p])).toContain('bootstrap_no_import');
  });

  it('flags a consumer item without demand', () => {
    const p = host([item('toy', { consumer: true })], [], [{ id: 'imp_toy', item: 'toy', kind: 'import', unitPrice: 5, ratePerMin: 5 }]);
    expect(codes([p])).toContain('missing_demand');
  });

  it('flags a missing i18n key', () => {
    const extra = pack({ items: [item('untranslated_widget')], sources: [{ id: 'imp_untranslated_widget', item: 'untranslated_widget', kind: 'import', unitPrice: 5, ratePerMin: 5 }] });
    const { errors } = validateContent([...FULL_CATALOG, extra]);
    expect(errors.filter((e) => e.code === 'missing_i18n').map((e) => e.ref)).toContain('item.untranslated_widget');
    expect(errors.map((e) => e.code)).toContain('unused_item');
  });
});
