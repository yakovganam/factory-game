/**
 * Panel renderers. Each returns { title, body } built from current state; the app re-renders
 * them a few times per second. Every visible control performs its stated function or shows why
 * it is locked.
 */
import { footprintOf } from '../content/db';
import type { MachineDef } from '../content/types';
import { duration, itemName, machineName, money, num, t } from '../i18n';
import { beltBlockReason, levelDef, WAGE_PER_MIN } from '../sim/factory';
import { HIRE_FEE, maxVans, refundFor, totalHired, VAN_COST } from '../sim/commands';
import { availableOutbound, importQuote, orderRemaining, shelfQty, storeWants } from '../sim/logistics';
import { demandMilliPerMin } from '../sim/market';
import { conditionMet, grantAvailable, GRANT_CENTS, unlockState } from '../sim/progression';
import { sumQty } from '../sim/core';
import type { BeltEntity, Entity, FactoryState, MachineEntity, StoreState } from '../sim/types';
import { TICKS_PER_MIN, TPS } from '../sim/types';
import type { Selection, UiCtx } from './ctx';
import { bdi, h } from './dom';

export interface PanelOut {
  title: string;
  body: HTMLElement;
  wide?: boolean;
}

const STATUS_SYM: Record<string, string> = { idle: '○', working: '▶', starved: '⏳', blocked: '⛔', no_power: '⚡', no_worker: '👷', no_recipe: '？' };
export function statusSym(s: string) {
  return STATUS_SYM[s] ?? '•';
}

function section(title: string, ...children: (Node | null | false | undefined)[]) {
  return h('div', { class: 'section' }, h('h3', null, title), ...children);
}

function itemRow(ctx: UiCtx, item: string, right: Node | string, sub?: string) {
  return h('div', { class: 'row' }, ctx.icon(item), h('div', { class: 'grow' }, h('div', null, itemName(item)), sub ? h('div', { class: 'small muted' }, sub) : null), typeof right === 'string' ? h('span', { class: 'qty' }, right) : right);
}

function btn(label: string, onClick: () => void, opts: { cls?: string; disabled?: boolean; title?: string; tut?: string } = {}) {
  return h('button', { class: `btn ${opts.cls ?? ''}`, onclick: opts.disabled ? undefined : onClick, disabled: opts.disabled, title: opts.title, 'aria-disabled': opts.disabled, 'data-tut': opts.tut }, label);
}

// ============================================================================== selection panels
export function selectionPanel(ctx: UiCtx, sel: Selection): PanelOut | null {
  const s = ctx.sim.s;
  if (sel.type === 'building') {
    if (s.factories[sel.id]) return workshopPanel(ctx, s.factories[sel.id]);
    if (s.stores[sel.id]) return storePanel(ctx, s.stores[sel.id]);
    const b = s.buildings.find((x) => x.id === sel.id);
    if (!b) return null;
    if (b.role === 'depot') return importsSheet(ctx);
    if (b.role === 'house' || b.role === 'civic') {
      const name = b.nameKey ? t(b.nameKey) : t('sel.house');
      return { title: name, body: h('div', null, h('p', { class: 'sub' }, t('sel.house_desc', { n: Math.round(s.population / 18) }))) };
    }
    if (b.role === 'utility') return { title: t('sel.substation'), body: h('div', null, h('p', { class: 'sub' }, t('sel.substation_desc'))) };
    return null;
  }
  if (sel.type === 'entity') {
    const f = s.factories[sel.f];
    const e = f?.entities.find((x) => x.id === sel.id);
    if (!f || !e) return null;
    return e.kind === 'belt' ? beltPanel(ctx, f, e) : machinePanel(ctx, f, e);
  }
  if (sel.type === 'vehicle') {
    const v = s.vehicles.find((x) => x.id === sel.id);
    if (!v) return null;
    const sh = v.shipment !== null ? s.shipments.find((x) => x.id === v.shipment) : undefined;
    const body = h('div', null, h('p', { class: 'sub' }, t(`log.state.${v.state}`)));
    if (sh) {
      body.append(section(t(`log.kind.${sh.kind}`), ...Object.keys(sh.items).map((k) => itemRow(ctx, k, num(sh.items[k]))), h('div', { class: 'small muted' }, t('log.to', { to: destName(ctx, sh.to) }))));
    }
    body.append(h('div', { class: 'small muted' }, t('log.capacity', { n: v.capacity })));
    return { title: t(v.kind === 'van' ? 'log.van' : 'log.truck'), body };
  }
  return null;
}

function destName(ctx: UiCtx, id: string) {
  const b = ctx.sim.s.buildings.find((x) => x.id === id);
  if (!b) return id;
  if (b.nameKey) return t(b.nameKey);
  if (b.role === 'store') return t('sel.store');
  if (b.role === 'factory') return t('sel.workshop');
  if (b.role === 'house') return t('cust.house', { n: 3 + (parseInt(b.id.replace(/\D/g, ''), 10) || 0) * 2 });
  return t(`building.${b.def}`);
}

function workshopPanel(ctx: UiCtx, f: FactoryState): PanelOut {
  const s = ctx.sim.s;
  const db = ctx.db;
  const lv = levelDef(db, f.def, f.level);
  const def = db.buildings.get(f.def)!;
  const next = def.levels[f.level];
  const body = h('div', null);
  body.append(h('p', { class: 'sub' }, t(`building.${f.def}.desc`)));
  if (ctx.interiorOf() !== f.id) body.append(h('div', { class: 'row' }, btn(t('tb.enter'), () => ctx.enterInterior(f.id), { cls: 'primary', tut: 'enter' })));
  // Staff
  const free = s.workforce - totalHired(s);
  body.append(
    section(
      t('fac.staff', { n: f.staff, cap: lv.staffCap }),
      h('div', { class: 'row' }, h('div', { class: 'grow small muted' }, t('fac.wage', { v: money(WAGE_PER_MIN) })), btn(t('fac.dismiss'), () => ctx.run({ t: 'hire', f: f.id, n: -1 }), { cls: 'small', disabled: f.staff <= 0 }), btn(t('fac.hire', { cost: money(HIRE_FEE) }), () => ctx.run({ t: 'hire', f: f.id, n: 1 }, 'ui_purchase'), { cls: 'small primary', disabled: f.staff >= lv.staffCap || free <= 0 })),
    ),
  );
  // Power + storage
  const pw = f.powerW / 1000;
  body.append(
    section(
      t('fac.power', { used: num(pw, 1), cap: lv.powerCapKw }),
      h('div', { class: 'bar' }, h('i', { style: { width: `${Math.min(100, (f.powerW / Math.max(1, lv.powerCapKw * 1000)) * 100)}%`, background: pw >= lv.powerCapKw * 0.95 ? 'var(--bad)' : 'var(--good)' } })),
    ),
  );
  const inb = sumQty(f.inbound);
  const outb = sumQty(f.outbound);
  body.append(section(t('fac.inbound', { n: inb, cap: lv.inboundCap }), h('div', { class: 'bar' }, h('i', { style: { width: `${(inb / lv.inboundCap) * 100}%` } })), ...Object.keys(f.inbound).sort().map((k) => itemRow(ctx, k, num(f.inbound[k])))));
  body.append(section(t('fac.outbound', { n: outb, cap: lv.outboundCap }), h('div', { class: 'bar' }, h('i', { style: { width: `${(outb / lv.outboundCap) * 100}%`, background: outb >= lv.outboundCap ? 'var(--bad)' : undefined } })), ...Object.keys(f.outbound).sort().map((k) => itemRow(ctx, k, num(f.outbound[k])))));
  // Vans
  const vans = s.vehicles.filter((v) => v.owner === 'player' && v.home === f.id).length;
  const cap = maxVans(s, f);
  body.append(section(t('fac.vans', { n: vans, cap }), h('div', { class: 'row' }, h('div', { class: 'grow small muted' }, vans >= cap ? (s.unlocked.includes('ch1_second_van') ? '' : t('build.needs', { what: t('unlock.ch1_second_van') })) : ''), btn(t('fac.buy_van', { cost: money(VAN_COST) }), () => ctx.run({ t: 'buyVan', f: f.id }, 'ui_purchase'), { cls: 'small', disabled: vans >= cap }))));
  // Expansion
  if (f.upgradeTicks > 0) body.append(section(t('fac.upgrade', { n: f.level + 1 }), h('div', { class: 'small' }, t('fac.upgrading', { s: Math.ceil(f.upgradeTicks / TPS) }))));
  else if (next) {
    const locked = next.requires && !s.unlocked.includes(next.requires);
    body.append(
      section(
        t('fac.upgrade', { n: next.level }),
        h('div', { class: 'small muted', style: { marginBlockEnd: '.4rem' } }, next.visualChange),
        h('div', { class: 'small' }, `${next.interior[0]}×${next.interior[1]} · ${next.powerCapKw} kW · ${t('fac.staff', { n: next.staffCap, cap: next.staffCap })}`),
        h('div', { class: 'row' }, locked ? h('div', { class: 'grow small warn' }, t('err.locked', { what: `unlock.${next.requires}` })) : h('div', { class: 'grow' }), btn(money(next.cost), () => ctx.run({ t: 'upgradeBuilding', id: f.id }, 'ui_purchase'), { cls: 'primary', disabled: !!locked })),
      ),
    );
  } else body.append(h('div', { class: 'small muted' }, t('fac.max_level')));
  if (grantAvailable(s)) body.append(grantBox(ctx));
  return { title: `${t(`building.${f.def}`)} · ${t('fac.level', { n: f.level })}`, body };
}

export function grantBox(ctx: UiCtx) {
  return h('div', { class: 'status starved', style: { marginBlockStart: '1rem' } }, h('div', { class: 'sym' }, '🤝'), h('div', { class: 'grow' }, h('b', null, t('grant.title')), h('div', { class: 'small' }, t('grant.body', { v: money(GRANT_CENTS) })), h('div', { style: { marginBlockStart: '.4rem' } }, btn(t('grant.claim', { v: money(GRANT_CENTS) }), () => ctx.run({ t: 'claimGrant' }, 'ui_purchase'), { cls: 'small primary' }))));
}

function statusBox(ctx: UiCtx, f: FactoryState, e: MachineEntity, def: MachineDef) {
  let line = t(`status.${e.status}`);
  let hint = '';
  if (def.role === 'receiving') {
    if (e.status === 'no_recipe') hint = t('hint.dock_choose');
    else if (e.status === 'starved') hint = t('hint.dock_starved', { item: `item.${e.statusItem}` });
    else if (e.status === 'blocked') hint = t('hint.dock_blocked');
  } else if (e.status === 'starved' && e.statusItem) {
    line = t('status.starved_item', { item: `item.${e.statusItem}` });
    hint = t('hint.starved', { item: `item.${e.statusItem}` });
  } else if (e.status === 'blocked') {
    line = e.statusItem ? t('status.blocked_item', { item: `item.${e.statusItem}` }) : line;
    hint = def.role === 'shipping' ? t('block.shipping_full') : t('hint.blocked');
  } else if (e.status === 'no_power') hint = t('hint.no_power');
  else if (e.status === 'no_worker') hint = t('hint.no_worker');
  else if (e.status === 'no_recipe') hint = t('hint.no_recipe');
  return h('div', { class: `status ${e.status}`, role: 'status' }, h('div', { class: 'sym', 'aria-hidden': 'true' }, statusSym(e.status)), h('div', { class: 'grow' }, h('b', null, line), hint ? h('div', { class: 'small' }, hint) : null));
}

function machinePanel(ctx: UiCtx, f: FactoryState, e: MachineEntity): PanelOut {
  const s = ctx.sim.s;
  const db = ctx.db;
  const def = db.machines.get(e.def)!;
  const body = h('div', null);
  body.append(statusBox(ctx, f, e, def));

  if (def.role === 'receiving') {
    const items = [...db.sources.values()].flat().filter((x) => x.kind === 'import' && (!x.unlock || s.unlocked.includes(x.unlock))).map((x) => x.item).sort();
    body.append(section(t('panel.unloads'), h('div', { class: 'chips', 'data-tut': 'dockfilter' }, ...items.map((it) => h('button', { class: `choice ${e.filter === it ? 'on' : ''}`, onclick: () => ctx.run({ t: 'setFilter', f: f.id, e: e.id, item: it }, 'ui_toggle') }, ctx.icon(it), itemName(it), h('span', { class: 'small muted' }, `(${num(f.inbound[it] ?? 0)})`))))));
    return { title: machineName(e.def), body };
  }
  if (def.role === 'shipping') {
    body.append(section(t('panel.shipping_stock'), ...Object.keys(f.outbound).sort().map((k) => itemRow(ctx, k, num(f.outbound[k]), f.reserved[k] ? t('imp.on_order', { n: f.reserved[k] }) : undefined))));
    return { title: machineName(e.def), body };
  }
  if (def.role === 'storage' || def.role === 'splitter') {
    const q = e.queue ?? [];
    const counts: Record<string, number> = {};
    for (const k of q) counts[k] = (counts[k] ?? 0) + 1;
    body.append(section(t('panel.storage_contents', { n: q.length, cap: def.storageCap ?? 1 }), ...Object.keys(counts).map((k) => itemRow(ctx, k, num(counts[k])))));
  } else {
    // Recipe selection
    const recs = db.recipesByMachine.get(e.def) ?? [];
    body.append(
      section(
        t('panel.recipe'),
        h('div', { class: 'chips', 'data-tut': 'recipe' }, ...recs.map((r) => {
          const locked = r.unlock && !s.unlocked.includes(r.unlock);
          return h('button', { class: `choice ${e.recipe === r.id ? 'on' : ''} ${locked ? 'locked' : ''}`, title: locked ? t('err.locked', { what: `unlock.${r.unlock}` }) : '', onclick: () => ctx.run({ t: 'setRecipe', f: f.id, e: e.id, recipe: r.id }, 'ui_toggle') }, ctx.icon(r.outputs[0].item), t(`recipe.${r.id}`), locked ? '🔒' : '');
        })),
      ),
    );
    const r = e.recipe ? db.recipes.get(e.recipe) : undefined;
    if (r) {
      const speed = def.speedPct[e.tier] ?? 100;
      body.append(
        section(
          `${t('panel.inputs')} → ${t('panel.outputs')} · ${t('panel.time', { s: num((r.durationSec * 100) / speed, 1) })}`,
          ...r.inputs.map((i) =>
            i.feed === 'stock'
              ? itemRow(ctx, i.item, `${num((e.inv[i.item] ?? 0) + (f.inbound[i.item] ?? 0))} / ${num(i.qty)}`, t('panel.stock_fed'))
              : itemRow(ctx, i.item, `${num(e.inv[i.item] ?? 0)} / ${num(i.qty)}`, t('panel.belt_fed')),
          ),
          ...r.outputs.map((o) => itemRow(ctx, o.item, `×${o.qty}`, e.out[o.item] ? `${t('panel.buffer')}: ${e.out[o.item]}` : undefined)),
          e.working ? h('div', { class: 'bar', style: { marginBlockStart: '.4rem' } }, h('i', { style: { width: `${Math.min(100, (e.progress / (r.durationSec * 1000)) * 100)}%` } })) : null,
        ),
      );
    }
    const util = s.tick - e.placedTick > 0 ? Math.round((e.workTicks / (s.tick - e.placedTick)) * 100) : 0;
    body.append(h('div', { class: 'small muted' }, `${t('panel.tier', { n: e.tier + 1 })} · ${t('panel.utilisation', { pct: util })} · ${def.staff ? t('build.staff', { n: def.staff }) : t('build.automated')} · ${t('build.power', { kw: def.powerKw })}`));
  }
  body.append(entityActions(ctx, f, e, def));
  return { title: machineName(e.def), body };
}

function entityActions(ctx: UiCtx, f: FactoryState, e: Entity, def: MachineDef) {
  const s = ctx.sim.s;
  const next = e.tier + 1;
  const canUp = next < def.speedPct.length;
  const gate = def.tierUnlocks?.[next];
  const beltLocked = !!gate && !s.unlocked.includes(gate);
  return h(
    'div',
    { class: 'section chips' },
    canUp ? btn(`${t('panel.upgrade', { n: next + 1 })} · ${money(def.upgradeCost[next] ?? 0)}`, () => ctx.run({ t: 'upgradeMachine', f: f.id, e: e.id }, 'upgrade_complete'), { cls: 'small', disabled: beltLocked, title: beltLocked ? t('err.locked', { what: `unlock.${gate}` }) : `${t('panel.upgrade_speed', { pct: (def.speedPct[next] ?? 100) - (def.speedPct[e.tier] ?? 100) })}` }) : null,
    btn(t('panel.rotate'), () => ctx.run({ t: 'rotate', f: f.id, e: e.id }, 'build_rotate'), { cls: 'small' }),
    e.kind === 'machine' ? btn(t('panel.move'), () => ctx.startMove(f.id, e.id), { cls: 'small' }) : null,
    btn(t('panel.remove_refund', { v: money(refundFor(s, e, ctx.db)) }), () => {
      if (ctx.run({ t: 'remove', f: f.id, e: e.id }, 'build_remove')) ctx.select(null);
    }, { cls: 'small danger' }),
  );
}

function beltPanel(ctx: UiCtx, f: FactoryState, e: BeltEntity): PanelOut {
  const db = ctx.db;
  const def = db.machines.get(e.def)!;
  const body = h('div', null);
  const block = beltBlockReason(f, db, e);
  if (block) body.append(h('div', { class: 'status blocked' }, h('div', { class: 'sym' }, '⛔'), h('div', { class: 'grow' }, h('b', null, t(block.key, { item: block.item ? `item.${block.item}` : undefined, target: block.target ? (db.recipes.has(block.target) ? `recipe.${block.target}` : `machine.${block.target}`) : undefined })))));
  if (e.items.length) body.append(section(t('panel.carrying', { item: '' }), ...e.items.map((it) => itemRow(ctx, it.item, ''))));
  else body.append(h('p', { class: 'sub' }, t('panel.empty_belt')));
  body.append(h('div', { class: 'small muted' }, `${t('panel.belt_dir')}: ${['→ E', '↓ S', '← W', '↑ N'][e.rot]} · ${t('panel.tier', { n: e.tier + 1 })}`));
  body.append(entityActions(ctx, f, e, def));
  return { title: t('build.belt'), body };
}

function storePanel(ctx: UiCtx, st: StoreState): PanelOut {
  const s = ctx.sim.s;
  const db = ctx.db;
  const def = db.buildings.get(st.def)!;
  const lv = levelDef(db, st.def, st.level);
  const body = h('div', null, h('p', { class: 'sub' }, t(`building.${st.def}.desc`)));
  if (s.trend.item) body.append(h('div', { class: 'status working' }, h('div', { class: 'sym' }, '🔥'), h('div', { class: 'grow' }, t('store.trend', { item: `item.${s.trend.item}` }))));
  else if (s.trend.next) body.append(h('div', { class: 'status' }, h('div', { class: 'sym' }, '📣'), h('div', { class: 'grow' }, t('store.trend_soon', { item: `item.${s.trend.next}` }))));
  // Shelves
  const sells = (def.sells ?? []).filter((it) => [...db.recipes.values()].some((r) => r.outputs.some((o) => o.item === it) && (!r.unlock || s.unlocked.includes(r.unlock))));
  body.append(
    section(
      t('store.shelves'),
      ...st.shelves.map((sl, i) =>
        h(
          'div',
          { class: 'row', style: { flexWrap: 'wrap' } },
          h('div', { class: 'small muted', style: { minWidth: '4rem' } }, t('store.shelf', { n: i + 1 })),
          h('div', { class: 'chips grow' }, ...sells.map((it) => h('button', { class: `choice ${sl.item === it ? 'on' : ''}`, onclick: () => ctx.run({ t: 'setShelf', store: st.id, shelf: i, item: sl.item === it ? null : it }, 'ui_toggle') }, ctx.icon(it), sl.item === it ? `${sl.qty}/${sl.cap}` : ''))),
          !sl.item ? h('div', { class: 'small warn', style: { flexBasis: '100%' } }, t('store.shelf_empty')) : null,
        ),
      ),
    ),
  );
  // Pricing per offered product
  const offered = [...new Set(st.shelves.map((x) => x.item).filter(Boolean) as string[])];
  body.append(
    section(
      t('store.price'),
      h('div', { class: 'small muted' }, t('store.price_hint')),
      ...offered.map((it) => {
        const d = db.demand.get(it)!;
        const p = st.prices[it] ?? d.refPrice;
        const step = Math.max(10, Math.round(d.refPrice / 20 / 10) * 10);
        const dem = demandMilliPerMin(s, db, st, it) / 1000;
        return h(
          'div',
          { class: 'row', style: { flexWrap: 'wrap' } },
          ctx.icon(it),
          h('div', { class: 'grow' }, h('div', null, itemName(it)), h('div', { class: 'small muted' }, `${t('store.demand', { v: num(dem, 1) })} · ${t('store.ref_price', { v: money(d.refPrice) })}`)),
          h('div', { class: 'stepper' }, btn('−', () => ctx.run({ t: 'setPrice', store: st.id, item: it, price: Math.max(Math.ceil((d.refPrice * 30) / 100), p - step) }, 'ui_tap'), { cls: 'small', title: '-' }), h('span', { class: 'val' }, bdi(money(p, true))), btn('+', () => ctx.run({ t: 'setPrice', store: st.id, item: it, price: Math.min(d.refPrice * 3, p + step) }, 'ui_tap'), { cls: 'small' })),
          h('div', { class: 'small muted', style: { flexBasis: '100%' } }, `${shelfQty(st, it)} · ${t('store.backroom', { n: st.backroom[it] ?? 0 })}${st.incoming[it] ? ' · ' + t('store.incoming', { n: st.incoming[it] }) : ''}`),
        );
      }),
    ),
  );
  body.append(
    section(
      t('stats.title'),
      h('div', { class: 'small' }, t('store.sold_min', { n: st.lastMinute.sold })),
      h('div', { class: `small ${st.lastMinute.lost ? 'warn' : 'muted'}` }, t('store.lost_stock', { n: st.lastMinute.lost })),
      h('div', { class: `small ${st.lastMinute.lostQueue ? 'warn' : 'muted'}` }, t('store.lost_queue', { n: st.lastMinute.lostQueue })),
    ),
  );
  const free = s.workforce - totalHired(s);
  body.append(section(t('store.staff', { n: st.staff, cap: lv.staffCap }), h('div', { class: 'row' }, h('div', { class: 'grow small muted' }, t('fac.wage', { v: money(100) })), btn(t('fac.dismiss'), () => ctx.run({ t: 'storeStaff', store: st.id, n: -1 }), { cls: 'small', disabled: st.staff <= 0 }), btn(t('fac.hire', { cost: money(HIRE_FEE) }), () => ctx.run({ t: 'storeStaff', store: st.id, n: 1 }, 'ui_purchase'), { cls: 'small primary', disabled: st.staff >= lv.staffCap || free <= 0 }))));
  body.append(h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: st.restock, onchange: (ev: Event) => ctx.run({ t: 'setRestock', store: st.id, on: (ev.target as HTMLInputElement).checked }, 'ui_toggle') }), t('store.restock')));
  const next = def.levels[st.level];
  if (next) {
    const locked = next.requires && !s.unlocked.includes(next.requires);
    body.append(section(t('store.upgrade', { n: next.level }), h('div', { class: 'small muted' }, next.visualChange), h('div', { class: 'row' }, locked ? h('div', { class: 'grow small warn' }, t('err.locked', { what: `unlock.${next.requires}` })) : h('div', { class: 'grow' }), btn(money(next.cost), () => ctx.run({ t: 'upgradeBuilding', id: st.id }, 'ui_purchase'), { cls: 'primary', disabled: !!locked }))));
  }
  void storeWants;
  return { title: `${t(`building.${st.def}`)} · ${t('fac.level', { n: st.level })}`, body };
}

// ============================================================================== sheets
export function buildSheet(ctx: UiCtx): PanelOut {
  const s = ctx.sim.s;
  const db = ctx.db;
  const fid = ctx.interiorOf();
  const body = h('div', null);
  if (!fid) {
    body.append(h('p', { class: 'sub' }, t('build.enter_first')));
    const ws = Object.keys(s.factories)[0];
    body.append(btn(t('tb.enter'), () => ctx.enterInterior(ws), { cls: 'primary' }));
    return { title: t('build.title'), body };
  }
  const f = s.factories[fid];
  const bdef = db.buildings.get(f.def)!;
  body.append(h('p', { class: 'sub' }, t('build.tip_ports')));
  const list = h('div', { class: 'chips', style: { flexDirection: 'column', alignItems: 'stretch' } });
  for (const id of bdef.machines) {
    const m = db.machines.get(id)!;
    if (m.fixed) continue;
    const lockedU = m.unlock && !s.unlocked.includes(m.unlock);
    const lvNeed = bdef.levels.find((l) => l.unlocksMachines?.includes(id));
    const lockedL = lvNeed && f.level < lvNeed.level;
    const locked = lockedU || lockedL;
    const [fw, fh] = footprintOf(m, 0);
    const why = lockedU ? t('err.locked', { what: `unlock.${m.unlock}` }) : lockedL ? t('err.needs_level', { level: lvNeed!.level }) : '';
    list.append(
      h(
        'button',
        { class: `choice ${locked ? 'locked' : ''}`, style: { justifyContent: 'flex-start', minHeight: '56px', textAlign: 'start' }, 'data-tut': `build:${id}`, onclick: () => (locked ? ctx.toast(why, 'warn') : ctx.startBuild(id)), 'aria-disabled': !!locked },
        h('span', { class: 'icon', style: { fontSize: '1.4rem' } }, m.role === 'belt' ? '➡️' : m.role === 'storage' ? '📦' : m.role === 'splitter' ? '🔀' : '🛠️'),
        h('div', { class: 'grow' }, h('div', null, h('b', null, m.role === 'belt' ? t('build.belt') : machineName(id)), ' ', h('span', { class: 'muted small' }, money(m.cost))), h('div', { class: 'small muted' }, locked ? why : m.role === 'belt' ? t('build.belt_desc') : `${t('build.footprint', { w: fw, h: fh })} · ${t('build.power', { kw: m.powerKw })} · ${m.staff ? t('build.staff', { n: m.staff }) : t('build.automated')}`)),
        locked ? '🔒' : '',
      ),
    );
  }
  body.append(list);
  return { title: t('build.title'), body };
}

export const IMPORT_STEPS = [10, 20, 40];

export function importsSheet(ctx: UiCtx): PanelOut {
  const s = ctx.sim.s;
  const db = ctx.db;
  const fid = Object.keys(s.factories)[0];
  const f = s.factories[fid];
  const lv = levelDef(db, f.def, f.level);
  const free = lv.inboundCap - sumQty(f.inbound) - sumQty(f.incoming);
  const body = h('div', null, h('p', { class: 'sub' }, t('imp.desc')), h('div', { class: 'small' }, t('imp.capacity', { free: Math.max(0, free) })));
  const srcs = [...db.sources.values()].flat().filter((x) => x.kind === 'import').sort((a, b) => (a.unlock ? 1 : 0) - (b.unlock ? 1 : 0) || a.unitPrice - b.unitPrice);
  for (const src of srcs) {
    const locked = src.unlock && !s.unlocked.includes(src.unlock);
    const row = h('div', { class: 'section', 'data-tut': `import:${src.item}` });
    row.append(itemRow(ctx, src.item, locked ? '🔒' : t('imp.unit', { v: money(src.unitPrice) }), locked ? t('err.locked', { what: `unlock.${src.unlock}` }) : `${t('imp.stock', { n: f.inbound[src.item] ?? 0 })}${f.incoming[src.item] ? ' · ' + t('imp.on_order', { n: f.incoming[src.item] }) : ''}`));
    if (!locked) {
      row.append(
        h('div', { class: 'chips' }, ...IMPORT_STEPS.map((q) => {
          const quote = importQuote(s, db, { [src.item]: q });
          return btn(`${q} · ${money(quote.goods + quote.freight)}`, () => ctx.run({ t: 'import', f: fid, items: { [src.item]: q } }, 'ui_purchase'), { cls: 'small', disabled: q > free, title: t('imp.total', { goods: money(quote.goods), freight: money(quote.freight) }) });
        }), (f.inbound[src.item] ?? 0) >= 10 ? btn(t('imp.sell_back'), () => ctx.run({ t: 'sellInbound', f: fid, item: src.item, qty: 10 }), { cls: 'small ghost' }) : null),
      );
      if (s.unlocked.includes('ch1_auto_import')) {
        const p = f.autoImport[src.item] ?? { enabled: false, threshold: 20, qty: 40 };
        row.append(h('label', { class: 'toggle small' }, h('input', { type: 'checkbox', checked: p.enabled, onchange: (ev: Event) => ctx.run({ t: 'autoImport', f: fid, item: src.item, policy: { ...p, enabled: (ev.target as HTMLInputElement).checked } }, 'ui_toggle') }), t('imp.auto_desc', { qty: p.qty, threshold: p.threshold })));
      }
    }
    body.append(row);
  }
  if (!s.unlocked.includes('ch1_auto_import')) body.append(h('div', { class: 'small muted' }, t('imp.auto_locked')));
  return { title: t('imp.title'), body };
}

export function ordersSheet(ctx: UiCtx): PanelOut {
  const s = ctx.sim.s;
  const body = h('div', null, h('p', { class: 'sub' }, t('ord.desc')), h('div', { class: 'small muted' }, t('ord.auto')));
  const fid = Object.keys(s.factories)[0];
  const f = s.factories[fid];
  const list = s.orders.filter((o) => o.status !== 'withdrawn').sort((a, b) => order(a.status) - order(b.status) || b.id - a.id).slice(0, 12);
  if (!list.length) body.append(h('p', { class: 'muted' }, s.tutorial.done || s.tutorial.skipped || s.tutorial.step >= 9 ? t('ord.none') : t('ord.locked')));
  for (const o of list) {
    const rem = orderRemaining(o);
    const total = Object.values(o.items).reduce((a, b) => a + b, 0);
    const done = total - Object.values(rem).reduce((a, b) => a + b, 0);
    const card = h('div', { class: 'slot', style: { flexDirection: 'column', alignItems: 'stretch' }, 'data-tut': o.status === 'offered' ? 'order' : undefined });
    card.append(h('div', { class: 'row' }, h('b', { class: 'grow' }, destName(ctx, o.customer)), h('span', { class: 'small muted' }, t(`ord.status.${o.status}`))));
    for (const k of Object.keys(o.items)) card.append(itemRow(ctx, k, `${o.shipped[k] ?? 0}/${o.items[k]}`, `${t('imp.stock', { n: availableOutbound(f, k) })}`));
    const reward = h('div', { class: 'small' }, t('ord.reward', { v: money(o.reward) }), ' · ');
    if (o.status === 'offered') reward.append(t('ord.bonus', { v: money(o.bonus), time: duration(o.bonusTick / TPS) }));
    else if (o.status !== 'fulfilled') reward.append(s.tick <= o.bonusTick ? t('ord.bonus', { v: money(o.bonus), time: duration((o.bonusTick - s.tick) / TPS) }) : t('ord.bonus_missed', { v: money(o.reward) }));
    card.append(reward);
    if (o.status !== 'offered') card.append(h('div', { class: 'small muted' }, t('ord.progress', { done, total })));
    if (o.status === 'offered') card.append(h('div', { class: 'row' }, h('div', { class: 'grow small muted' }, t('ord.expires', { time: duration((o.expireTick - s.tick) / TPS) })), btn(t('ord.accept'), () => ctx.run({ t: 'acceptOrder', id: o.id }, 'ui_confirm'), { cls: 'primary small' })));
    body.append(card);
  }
  return { title: t('ord.title'), body };
}
function order(st: string) {
  return { offered: 0, accepted: 1, dispatched: 1, fulfilled: 3, withdrawn: 4 }[st] ?? 5;
}

export function researchSheet(ctx: UiCtx): PanelOut {
  const s = ctx.sim.s;
  const db = ctx.db;
  const body = h('div', null);
  const items = [...db.unlocks.values()].filter((u) => u.chapter === 1).sort((a, b) => rank(unlockState(s, db, a.id)) - rank(unlockState(s, db, b.id)) || a.cost - b.cost);
  for (const u of items) {
    const st = unlockState(s, db, u.id);
    const card = h('div', { class: 'slot', style: { flexDirection: 'column', alignItems: 'stretch', opacity: st === 'owned' ? '0.7' : '1' }, 'data-tut': `research:${u.id}` });
    card.append(h('div', { class: 'row' }, h('b', { class: 'grow' }, t(`unlock.${u.id}`)), h('span', { class: 'small muted' }, t(`res.cat.${u.category}`))));
    card.append(h('div', { class: 'small muted' }, t(`unlock.${u.id}.desc`)));
    for (const r of u.requires) card.append(h('div', { class: `small ${s.unlocked.includes(r) ? 'good' : 'warn'}` }, `${s.unlocked.includes(r) ? '✓' : '○'} ${t('res.requires', { what: `unlock.${r}` })}`));
    for (const c of u.conditions ?? []) {
      const met = conditionMet(s, c);
      let txt = '';
      if (c.t === 'sold') txt = t('res.cond.sold', { qty: c.qty, item: `item.${c.item}`, have: Math.min(c.qty, s.stats.sold[c.item] ?? 0) });
      else if (c.t === 'produced') txt = t('res.cond.produced', { qty: c.qty, item: `item.${c.item}`, have: Math.min(c.qty, s.stats.produced[c.item] ?? 0) });
      else if (c.t === 'revenue') txt = t('res.cond.revenue', { v: money(c.cents), have: money((s.ledger.total.sales ?? 0) + (s.ledger.total.contracts ?? 0)) });
      else if (c.t === 'orders') txt = t('res.cond.orders', { count: c.count, have: Math.min(c.count, s.stats.ordersCompleted) });
      else if (c.t === 'level') txt = t('res.cond.level', { building: `building.${c.building}`, level: c.level });
      card.append(h('div', { class: `small ${met ? 'good' : 'warn'}` }, `${met ? '✓' : '○'} ${txt}`));
    }
    card.append(h('div', { class: 'row' }, h('div', { class: 'grow' }), st === 'owned' ? h('span', { class: 'good' }, `✓ ${t('res.owned')}`) : btn(t('res.research', { cost: money(u.cost) }), () => ctx.run({ t: 'research', id: u.id }, 'unlock'), { cls: st === 'available' ? 'primary small' : 'small', disabled: st !== 'available' })));
    body.append(card);
  }
  return { title: t('res.title'), body };
}
function rank(st: string) {
  return st === 'available' ? 0 : st === 'locked' ? 1 : 2;
}

export function statsSheet(ctx: UiCtx): PanelOut {
  const s = ctx.sim.s;
  const db = ctx.db;
  const hour: Record<string, number> = {};
  for (const m of s.ledger.minutes) for (const k in m.a) hour[k] = (hour[k] ?? 0) + (m.a[k as keyof typeof m.a] ?? 0);
  const life = s.ledger.total as Record<string, number>;
  const mins = Math.max(1, s.ledger.minutes.length);
  const rows = (src: Record<string, number>) => {
    const rev = (src.sales ?? 0) + (src.contracts ?? 0);
    const opex = ['imports', 'wages', 'energy', 'maintenance', 'freight'].reduce((a, k) => a + (src[k] ?? 0), 0);
    const capex = ['construction', 'research', 'hiring'].reduce((a, k) => a + (src[k] ?? 0), 0);
    return { rev, opex, capex, margin: rev + opex, other: (src.grants ?? 0) + (src.refunds ?? 0) };
  };
  const H = rows(hour);
  const L = rows(life);
  const line = (label: string, a: number, b: number, cls = '') => h('tr', { class: cls }, h('td', null, label), h('td', { class: 'num' }, bdi(money(a))), h('td', { class: 'num' }, bdi(money(b))));
  const table = h(
    'table',
    { class: 'fin' },
    h('tr', null, h('td', null, ''), h('td', { class: 'num small muted' }, t('stats.last_hour')), h('td', { class: 'num small muted' }, t('stats.lifetime'))),
    line(t('stats.sales'), hour.sales ?? 0, life.sales ?? 0),
    line(t('stats.contracts'), hour.contracts ?? 0, life.contracts ?? 0),
    line(t('stats.revenue'), H.rev, L.rev, 'total'),
    ...['imports', 'wages', 'energy', 'maintenance', 'freight'].map((k) => line(t(`stats.${k}`), hour[k] ?? 0, life[k] ?? 0)),
    line(t('stats.expenses'), H.opex, L.opex, 'total'),
    line(t('stats.margin'), H.margin, L.margin, 'total'),
    line(t('stats.investment'), H.capex, L.capex),
    line(`${t('stats.grants')} / ${t('stats.refunds')}`, H.other, L.other),
  );
  // Stock value at standard cost.
  let stock = 0;
  for (const f of Object.values(s.factories)) {
    for (const k in f.inbound) stock += (db.standardCost.get(k) ?? 0) * f.inbound[k];
    for (const k in f.outbound) stock += (db.standardCost.get(k) ?? 0) * f.outbound[k];
  }
  for (const st of Object.values(s.stores)) {
    for (const sl of st.shelves) if (sl.item) stock += (db.standardCost.get(sl.item) ?? 0) * sl.qty;
    for (const k in st.backroom) stock += (db.standardCost.get(k) ?? 0) * st.backroom[k];
  }
  const sales = life.sales ?? 0;
  const est = sales + (life.contracts ?? 0) - s.ledger.cogs + ['wages', 'energy', 'maintenance', 'freight'].reduce((a, k) => a + (life[k] ?? 0), 0);
  const body = h('div', null, table);
  body.append(h('div', { class: 'section' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, t('stats.est_profit')), h('b', null, bdi(money(est)))), h('div', { class: 'row' }, h('div', { class: 'grow' }, t('stats.cash_flow')), h('b', null, bdi(money(H.rev + H.opex + H.capex + H.other)))), h('div', { class: 'row' }, h('div', { class: 'grow' }, t('stats.stock_value')), h('b', null, bdi(money(stock))))));
  // Products table
  const goods = [...db.demand.keys()].filter((k) => (s.stats.produced[k] ?? 0) + (s.stats.sold[k] ?? 0) + (s.stats.lostSales[k] ?? 0) > 0);
  if (goods.length) {
    const tb = h('table', { class: 'fin' }, h('tr', null, h('td', null, t('stats.products')), h('td', { class: 'num small muted' }, t('stats.throughput')), h('td', { class: 'num small muted' }, t('stats.sold')), h('td', { class: 'num small muted' }, t('stats.unmet'))));
    for (const k of goods) tb.append(h('tr', null, h('td', null, itemName(k)), h('td', { class: 'num' }, num(s.stats.produced[k] ?? 0)), h('td', { class: 'num' }, num(s.stats.sold[k] ?? 0)), h('td', { class: `num ${(s.stats.lostSales[k] ?? 0) > 0 ? 'warn' : ''}` }, num(s.stats.lostSales[k] ?? 0))));
    body.append(h('div', { class: 'section' }, tb));
  }
  body.append(h('div', { class: 'small muted' }, `${mins} min`));
  void TICKS_PER_MIN;
  return { title: t('stats.title'), body, wide: true };
}

export function logisticsSheet(ctx: UiCtx): PanelOut {
  const s = ctx.sim.s;
  const body = h('div', null);
  body.append(section(t('log.vehicles'), ...s.vehicles.map((v) => {
    const sh = v.shipment !== null ? s.shipments.find((x) => x.id === v.shipment) : undefined;
    return h('div', { class: 'row', onclick: () => ctx.select({ type: 'vehicle', id: v.id }), style: { cursor: 'pointer' } }, h('span', { class: 'icon' }, v.kind === 'van' ? '🚐' : '🚚'), h('div', { class: 'grow' }, h('div', null, t(v.kind === 'van' ? 'log.van' : 'log.truck')), h('div', { class: 'small muted' }, `${t(`log.state.${v.state}`)}${sh ? ' · ' + t('log.to', { to: destName(ctx, sh.to) }) : ''}`)), h('span', { class: 'qty small' }, `${sumQty(v.cargo)}/${v.capacity}`));
  })));
  const active = s.shipments.filter((x) => x.status !== 'delivered');
  body.append(section(t('log.shipments'), ...(active.length ? active.map((sh) => h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', null, t(`log.kind.${sh.kind}`)), h('div', { class: 'small muted' }, `${Object.keys(sh.items).map((k) => `${sh.items[k]}× ${itemName(k)}`).join(', ')} ${t('log.to', { to: destName(ctx, sh.to) })}`)), h('span', { class: 'small muted' }, money(sh.freight)))) : [h('div', { class: 'muted small' }, t('log.none'))])));
  return { title: t('log.title'), body };
}
