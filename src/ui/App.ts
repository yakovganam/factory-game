/**
 * Application controller: title → play flow, fixed-step loop, input → commands, sim events →
 * audio/effects/notifications, panels, tutorial, saves and platform lifecycle.
 */
import * as THREE from 'three';
import { AudioManager } from './audioShim';
import type { ListenerContext } from '../audio/types';
import type { ContentDB } from '../content/db';
import { footprintOf } from '../content/db';
import { duration, getLang, itemName, LANGS, machineName, money, setLang, t, type Lang } from '../i18n';
import { makeEnvelope, MemoryBackend, parseEnvelope, SaveManager, serialize, SLOT_COUNT } from '../persist/saves';
import { checkPlacement, entityAt } from '../sim/factory';
import type { Command } from '../sim/commands';
import { applyDemoLayout } from '../sim/demo';
import { newGame, Sim } from '../sim/game';
import { OFFLINE_HORIZON_SEC, planCatchUp, runCatchUp } from '../sim/offline';
import { grantAvailable, TUTORIAL } from '../sim/progression';
import type { Dir, GameState } from '../sim/types';
import { DX, DY, TPS } from '../sim/types';
import { IconRenderer } from '../render/icons';
import { clockOf, View, type Pick } from '../render/View';
import { InputController } from '../render/camera';
import type { Selection, SheetName, UiCtx } from './ctx';
import { bdi, clear, h } from './dom';
import { buildSheet, grantBox, importsSheet, logisticsSheet, ordersSheet, researchSheet, selectionPanel, statsSheet, statusSym, type PanelOut } from './panels';
import { loadSettings, saveSettings, type Settings } from './settings';

const VERSION = '0.1.0';
const AUTOSAVE_MS = 30000;
const ANIM_SOUND: Record<string, string> = { bench: 'bench_work', packer: 'packer_work', booth: 'paint_spray', arm: 'arm_servo' };
const LOOP_SOUND: Record<string, string> = { booth: 'loop_paint_booth', arm: 'loop_motor_hum', bench: '', packer: 'loop_motor_hum' };

interface Tool {
  def: string;
  /** When set, the tool relocates this existing entity instead of buying a new one. */
  moveId?: number;
  rot: Dir;
  x: number;
  y: number;
  hasPos: boolean;
  valid: boolean;
  reason: string;
}

export class App implements UiCtx {
  db: ContentDB;
  settings: Settings;
  saves!: SaveManager;
  audio = new AudioManager();
  view!: View;
  icons!: IconRenderer;
  sim!: Sim;
  slot = 0;
  mode: 'title' | 'playing' | 'photo' = 'title';
  private interior: string | null = null;
  selection: Selection | null = null;
  sheet: SheetName | null = null;
  tool: Tool | null = null;
  drawing: { sx: number; sy: number; tiles: { x: number; y: number; rot: Dir }[]; valid: boolean } | null = null;
  speed = 1;
  private lastSpeed = 1;
  private acc = 0;
  private last = performance.now();
  private lastUi = 0;
  private lastSave = Date.now();
  private catchingUp = false;
  private firstSaleShown = false;
  private lostSaleNote = 0;
  private frames: number[] = [];
  private pickerInput = document.createElement('input');
  private tutDoneShown = false;
  /** Measured simulation cost on this device (EMA), used to budget offline catch-up. */
  msPerTick = 0.25;
  private grantNote = -1e9;

  // DOM
  root: HTMLElement;
  ui!: HTMLElement;
  hud!: HTMLElement;
  toolbar!: HTMLElement;
  panel!: HTMLElement;
  tutorial!: HTMLElement;
  toasts!: HTMLElement;
  markers!: HTMLElement;
  buildbar!: HTMLElement;
  modalHost!: HTMLElement;
  fps!: HTMLElement;
  private markerPool: HTMLElement[] = [];

  constructor(root: HTMLElement, db: ContentDB) {
    this.root = root;
    this.db = db;
    this.settings = loadSettings();
    setLang(this.settings.lang);
  }

  // ======================================================================== boot
  async boot() {
    this.applyUiSettings();
    try {
      this.view = new View(this.root, this.db, this.settings.quality);
    } catch (e) {
      this.fatal(t('menu.webgl_fail'));
      return;
    }
    this.view.rig.reducedMotion = this.settings.reducedMotion;
    this.view.rig.shakeEnabled = this.settings.cameraShake;
    this.view.reducedEffects = this.settings.reducedEffects;
    this.view.onContextChange = (lost) => (lost ? this.toast(t('menu.context_lost'), 'warn') : undefined);
    this.icons = new IconRenderer(this.view.renderer);
    this.buildDom();
    this.saves = await SaveManager.detect();
    // Title backdrop: a deterministic demo workshop running behind the menu.
    this.sim = new Sim(this.db, newGame(this.db, 7));
    applyDemoLayout(this.sim);
    this.sim.run(TPS * 50);
    this.view.build(this.sim);
    this.view.rig.setGoal({ x: 14, z: 10, dist: 62, yaw: 0.75, pitch: 0.78 }, true);
    this.audio.applySettings(this.settings.audio);
    this.setupLifecycle();
    this.bindInput();
    await this.showTitle();
    requestAnimationFrame(this.frame);
  }

  private fatal(msg: string) {
    this.root.append(h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('div', { class: 'body' }, h('h2', null, t('app.title')), h('p', null, msg)))));
  }

  private buildDom() {
    this.ui = h('div', { class: 'ui' });
    this.markers = h('div', { class: 'markers', 'aria-hidden': 'true' });
    this.hud = h('div', { class: 'hud' });
    this.toolbar = h('nav', { class: 'toolbar', 'aria-label': 'Main' });
    this.panel = h('aside', { class: 'panel hidden', 'aria-live': 'polite' });
    this.tutorial = h('div', { class: 'tutorial hidden', role: 'dialog' });
    this.toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    this.buildbar = h('div', { class: 'buildbar hidden' });
    this.modalHost = h('div', { class: 'hidden' });
    this.fps = h('div', { class: 'fps hidden' });
    this.ui.append(this.markers, this.hud, this.toolbar, this.panel, this.tutorial, this.buildbar, this.toasts, this.fps, this.modalHost);
    // Never rebuild a panel under the player's finger (a rebuild between pointerdown and pointerup drops the click).
    this.panel.addEventListener('pointerdown', () => (this.panelPointer = true));
    window.addEventListener('pointerup', () => setTimeout(() => (this.panelPointer = false), 0), { capture: true });
    window.addEventListener('pointercancel', () => (this.panelPointer = false));
    this.root.append(this.ui);
    // First interaction unlocks audio (browser autoplay policy).
    const unlock = () => {
      this.audio.unlock().catch(() => undefined);
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    this.pickerInput.type = 'file';
    this.pickerInput.accept = 'application/json,.json';
    this.pickerInput.onchange = () => this.importFile();
  }

  applyUiSettings() {
    document.documentElement.style.setProperty('--ui-scale', String(this.settings.textScale));
    document.body.classList.toggle('hc', this.settings.highContrast);
    document.body.classList.toggle('reduced-motion', this.settings.reducedMotion);
  }

  // ======================================================================== title & slots
  async showTitle() {
    this.mode = 'title';
    this.interior = null;
    this.selection = null;
    this.sheet = null;
    this.cancelTool();
    this.hud.classList.add('hidden');
    this.toolbar.classList.add('hidden');
    this.panel.classList.add('hidden');
    this.tutorial.classList.add('hidden');
    const sums = await this.saves.summaries();
    const last = sums[this.settings.lastSlot];
    const menu = h('div', { class: 'menu' });
    if (last) menu.append(h('button', { class: 'btn primary', onclick: () => this.startSlot(this.settings.lastSlot) }, `▶ ${t('menu.continue')}`));
    menu.append(h('button', { class: `btn ${last ? '' : 'primary'}`, onclick: () => this.slotPicker('new') }, t('menu.new')));
    if (sums.some(Boolean)) menu.append(h('button', { class: 'btn', onclick: () => this.slotPicker('load') }, t('menu.load')));
    menu.append(h('button', { class: 'btn', onclick: () => this.settingsModal() }, t('menu.settings')));
    menu.append(h('button', { class: 'btn', onclick: () => this.helpModal() }, t('menu.help')));
    menu.append(h('button', { class: 'btn ghost', style: { color: '#fff' }, onclick: () => this.pickerInput.click() }, t('menu.import')));
    const title = h('div', { class: 'title', id: 'title' }, h('div', { class: 'logo' }, h('h1', null, t('app.title')), h('div', { class: 'tag' }, t('app.subtitle')), h('div', { class: 'wt' }, `${t('app.working_title')} · ${t('menu.version', { v: VERSION })}`)), menu);
    if (this.saves.backend.name === 'memory') title.append(h('div', { class: 'chip small', style: { maxWidth: '520px' } }, t('menu.storage_memory')));
    this.showModal(title, false);
  }

  private async slotPicker(kind: 'new' | 'load') {
    const sums = await this.saves.summaries();
    const body = h('div', { class: 'body' });
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = sums[i];
      const info = s
        ? h('div', { class: 'grow' }, h('b', null, t('menu.slot', { n: i + 1 })), h('div', { class: 'small muted' }, t('menu.slot_summary', { cash: money(s.cash), day: clockOf(s.tick).day, level: s.level })), h('div', { class: 'small muted' }, t('menu.saved_at', { when: new Date(s.savedAt).toLocaleString(LANGS.find((l) => l.id === getLang())!.locale) })))
        : h('div', { class: 'grow' }, h('b', null, t('menu.slot', { n: i + 1 })), h('div', { class: 'small muted' }, t('menu.empty_slot')));
      const row = h('div', { class: 'slot' }, info);
      if (kind === 'load' && s) row.append(h('button', { class: 'btn primary small', onclick: () => this.startSlot(i) }, t('menu.load')));
      if (kind === 'new') row.append(h('button', { class: 'btn primary small', onclick: () => (s && !confirm(t('menu.confirm_overwrite')) ? undefined : this.startSlot(i, true)) }, t('menu.new')));
      if (s) row.append(h('button', { class: 'btn small danger', onclick: async () => { if (confirm(t('menu.confirm_delete'))) { await this.saves.remove(i); this.slotPicker(kind); } } }, t('menu.delete')));
      body.append(row);
    }
    this.showModal(h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('header', null, h('h2', null, t('menu.choose_slot')), h('button', { class: 'btn small', onclick: () => this.showTitle() }, t('tb.back'))), body)));
  }

  async startSlot(slot: number, fresh = false) {
    this.slot = slot;
    this.settings.lastSlot = slot;
    saveSettings(this.settings);
    let state: GameState | null = null;
    let recovered = false;
    if (!fresh) {
      const r = await this.saves.load(slot);
      if (r.ok) {
        state = r.env.state;
        recovered = r.recovered;
      } else if (r.reason === 'unsupported') return this.toast(t('menu.unsupported_save'), 'warn');
      else if (r.reason === 'corrupt') return this.toast(t('menu.corrupt_save'), 'warn');
    }
    if (!state) state = newGame(this.db, (Date.now() & 0x7fffffff) ^ (slot * 7919), Date.now());
    this.sim = new Sim(this.db, state);
    this.firstSaleShown = (state.stats.sold.boxed_blocks ?? 0) > 0;
    for (const id of Object.keys(state.stores)) this.view.refreshStore(this.sim, id);
    this.mode = 'playing'; // before closeModal(): closing a modal on the title screen re-opens the title
    this.closeModal();
    this.hud.classList.remove('hidden');
    this.toolbar.classList.remove('hidden');
    this.speed = 1;
    this.view.rig.setGoal({ x: 12, z: 6, dist: fresh ? 46 : 60, yaw: Math.PI / 4, pitch: 0.9 }, false);
    if (recovered) this.toast(t('menu.recovered'), 'warn');
    await this.offlineCatchUp();
    this.renderToolbar();
    this.renderHud();
    this.saveNow();
  }

  private async offlineCatchUp() {
    const now = Date.now();
    const plan = planCatchUp(this.sim, now, this.msPerTick * 1.5);
    if (plan.ticks <= 0) {
      this.sim.s.wallMs = now;
      return;
    }
    const s = this.sim.s;
    const sales0 = (s.ledger.total.sales ?? 0) + (s.ledger.total.contracts ?? 0);
    const exp0 = ['imports', 'wages', 'energy', 'maintenance', 'freight'].reduce((a, k) => a + ((s.ledger.total as any)[k] ?? 0), 0);
    this.catchingUp = true;
    const bar = h('i', { style: { width: '0%' } });
    const label = h('div', null, t('menu.offline_working', { pct: 0 }));
    this.showModal(h('div', { class: 'modal-back' }, h('div', { class: 'loading' }, h('h2', null, t('menu.offline_title')), label, h('div', { class: 'progress' }, bar))), false);
    await runCatchUp(this.sim, plan, now, (p) => {
      bar.style.width = `${Math.round(p * 100)}%`;
      label.textContent = t('menu.offline_working', { pct: Math.round(p * 100) });
    });
    this.catchingUp = false;
    const sales = (s.ledger.total.sales ?? 0) + (s.ledger.total.contracts ?? 0) - sales0;
    const exp = ['imports', 'wages', 'energy', 'maintenance', 'freight'].reduce((a, k) => a + ((s.ledger.total as any)[k] ?? 0), 0) - exp0;
    const body = h('div', { class: 'body' }, h('p', null, t('menu.offline_body', { time: duration(plan.ticks / TPS), sales: money(sales), expenses: money(-exp) })));
    if (plan.clamped) body.append(h('p', { class: 'small muted' }, t('menu.offline_clamped', { hours: OFFLINE_HORIZON_SEC / 3600 })));
    if (plan.budgetClamped) body.append(h('p', { class: 'small muted' }, t('menu.offline_budget', { time: duration(plan.ticks / TPS) })));
    body.append(h('button', { class: 'btn primary', onclick: () => this.closeModal() }, t('common.ok')));
    this.showModal(h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('header', null, h('h2', null, t('menu.offline_title'))), body)));
    await this.saveNow();
  }

  // ======================================================================== capture/debug hooks
  /**
   * Deterministic scenes for automated screenshots and QA (used by tools/capture.mjs).
   * Uses an in-memory save backend so it never touches a player's saves.
   */
  async debugScene(opts: { scene: string; lang?: Lang; seconds?: number; hour?: number; tutorial?: boolean }) {
    if (opts.lang) {
      this.settings.lang = opts.lang;
      setLang(opts.lang);
    }
    this.saves = new SaveManager(new MemoryBackend());
    await this.startSlot(0, true);
    this.closeModal();
    if (opts.scene !== 'fresh') {
      applyDemoLayout(this.sim);
      if (!opts.tutorial) this.sim.s.tutorial.skipped = true;
      const secs = opts.seconds ?? 120;
      // Keep the line supplied like an attentive player would (reorders every 30 s).
      for (let t0 = 0; t0 < secs; t0 += 30) {
        const f = this.sim.s.factories[Object.keys(this.sim.s.factories)[0]];
        const want: Record<string, number> = {};
        if ((f.inbound.wood_pieces ?? 0) + (f.incoming.wood_pieces ?? 0) < 30) want.wood_pieces = 40;
        if ((f.inbound.carton_flat ?? 0) + (f.incoming.carton_flat ?? 0) < 10) want.carton_flat = 20;
        if (Object.keys(want).length) this.sim.exec({ t: 'import', f: f.id, items: want });
        this.sim.run(TPS * Math.min(30, secs - t0));
      }
      this.sim.ev.drain();
    }
    if (opts.hour !== undefined) this.view.hourOverride = opts.hour;
    const ws = Object.keys(this.sim.s.factories)[0];
    if (opts.scene === 'interior' || opts.scene === 'build' || opts.scene === 'machine') this.enterInterior(ws);
    if (opts.scene === 'build') {
      this.startBuild('assembly_bench');
      this.moveTool(3, 4);
    }
    if (opts.scene === 'machine') {
      const e = this.sim.s.factories[ws].entities.find((x) => x.def === 'packing_station');
      if (e) this.select({ type: 'entity', f: ws, id: e.id });
    }
    if (opts.scene === 'store') this.select({ type: 'building', id: Object.keys(this.sim.s.stores)[0] });
    if (opts.scene === 'research') this.openSheet('research');
    if (opts.scene === 'stats') this.openSheet('stats');
    if (opts.scene === 'orders') this.openSheet('orders');
    if (opts.scene === 'imports') this.openSheet('imports');
    if (opts.scene === 'street') this.view.rig.setGoal({ x: 30, z: -4, dist: 34, yaw: 0.55, pitch: 0.62 });
    if (opts.scene === 'city') this.view.rig.setGoal({ x: 5, z: 10, dist: 150, yaw: 0.7, pitch: 0.95 });
    this.renderHud();
    this.renderPanel(true);
    this.renderToolbar();
    return true;
  }

  /** Screen position of an interior tile centre (automation/QA helper). */
  tileScreen(fid: string, x: number, y: number) {
    const b = this.sim.s.buildings.find((q) => q.id === fid)!;
    return this.view.project(new THREE.Vector3(b.x + x + 0.5, 0, b.z + y + 0.5));
  }

  // ======================================================================== saves
  async saveNow() {
    if (this.mode === 'title' || !this.sim) return;
    this.sim.s.wallMs = Date.now();
    await this.saves.save(this.sim.s, this.slot);
    this.lastSave = Date.now();
    if (this.saves.lastError) this.toast(t(this.saves.lastError), 'warn');
    this.renderHud();
  }

  private exportFile() {
    const env = makeEnvelope(this.sim.s, this.slot, Date.now());
    const blob = new Blob([serialize(env)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tiny-factory-slot${this.slot + 1}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.toast(t('note.saved_export'), 'good');
  }

  private async importFile() {
    const file = this.pickerInput.files?.[0];
    this.pickerInput.value = '';
    if (!file) return;
    const text = await file.text();
    const r = parseEnvelope(text);
    if (!r.ok) return this.toast(t('menu.import_fail'), 'warn');
    const slot = this.mode === 'playing' ? this.slot : this.settings.lastSlot;
    await this.saves.save(r.env.state, slot);
    this.toast(t('menu.import_ok', { n: slot + 1 }), 'good');
    await this.startSlot(slot);
  }

  private setupLifecycle() {
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        this.audio.suspend();
        await this.saveNow();
      } else {
        this.audio.resume();
        this.last = performance.now();
        if (this.mode === 'playing' && this.speed > 0 && !this.catchingUp) await this.offlineCatchUp();
      }
    });
    window.addEventListener('pagehide', () => {
      if (this.mode === 'playing') {
        this.sim.s.wallMs = Date.now();
        this.saves.save(this.sim.s, this.slot);
      }
    });
    // Native (Capacitor) app lifecycle.
    import('@capacitor/core')
      .then(({ Capacitor }) => {
        if (!Capacitor.isNativePlatform()) return;
        return import('@capacitor/app').then(({ App: CapApp }) => {
          CapApp.addListener('pause', () => {
            this.audio.suspend();
            this.saveNow();
          });
          CapApp.addListener('resume', () => {
            this.audio.resume();
            if (this.mode === 'playing') this.offlineCatchUp();
          });
          CapApp.addListener('backButton', () => this.back());
        });
      })
      .catch(() => undefined);
  }

  // ======================================================================== main loop
  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const running = this.mode === 'title' || (this.speed > 0 && !this.catchingUp);
    const speed = this.mode === 'title' ? 1 : this.speed;
    if (running) {
      this.acc += dt * speed * TPS;
      const n = Math.min(Math.floor(this.acc), 60);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) this.sim.step();
      if (n > 0) this.msPerTick = this.msPerTick * 0.98 + ((performance.now() - t0) / n) * 0.02;
      this.acc -= n;
      if (this.acc > 10) this.acc = 0; // device too slow: slow down rather than spiral
    }
    if (this.mode !== 'title' && this.speed > 0) this.sim.s.wallMs = Date.now();
    else if (this.mode !== 'title') this.sim.s.wallMs = Date.now(); // paused: time does not accrue offline either
    const events = this.sim.ev.drain();
    if (this.mode !== 'title') this.handleEvents(events);
    this.input?.tick(dt);
    this.view.frame(this.sim, dt, running ? this.acc : 0, speed, this.interior);
    this.updateAudio(dt);
    if (this.mode !== 'title') {
      this.updateMarkers();
      if (now - this.lastUi > 250) {
        this.lastUi = now;
        this.renderHud();
        this.renderPanel();
        this.renderTutorial();
        this.renderToolbarBadges();
      }
      if (Date.now() - this.lastSave > AUTOSAVE_MS) this.saveNow();
    } else if (this.mode === 'title') {
      // Slow orbit behind the title.
      this.view.rig.goal.yaw += dt * 0.03;
    }
    if (this.settings.showFps) {
      this.frames.push(dt);
      if (this.frames.length > 60) this.frames.shift();
      if (Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500)) {
        const sorted = [...this.frames].sort((a, b) => a - b);
        const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? avg;
        const st = this.view.stats();
        this.fps.textContent = `${Math.round(1 / Math.max(1e-3, avg))} fps · p95 ${(p95 * 1000).toFixed(1)} ms · ${st.calls} calls · ${(st.tris / 1000).toFixed(0)}k tris`;
      }
    }
  };

  private input: InputController | null = null;

  // ======================================================================== events → feedback
  private handleEvents(events: ReturnType<Sim['ev']['drain']>) {
    const s = this.sim.s;
    const tmp = new THREE.Vector3();
    for (const e of events) {
      switch (e.t) {
        case 'start': {
          if (this.interior !== e.f) break;
          const ent = s.factories[e.f]?.entities.find((x) => x.id === e.e);
          if (!ent) break;
          const m = this.db.machines.get(ent.def)!;
          const snd = ANIM_SOUND[m.anim];
          const p = this.view.factories.get(e.f)!.entityWorld(ent, tmp);
          if (snd) this.audio.play(snd, { pos: p });
          if (m.anim === 'booth') for (let i = 0; i < 3; i++) this.view.steam(p.clone().add(new THREE.Vector3(0, 1.6, 0)));
          break;
        }
        case 'craft': {
          if (this.interior !== e.f) break;
          const ent = s.factories[e.f]?.entities.find((x) => x.id === e.e);
          if (!ent) break;
          const p = this.view.factories.get(e.f)!.entityWorld(ent, tmp);
          this.audio.play('craft_done', { pos: p });
          this.view.sparkle(p.clone().add(new THREE.Vector3(0, 0.1, 0)), 4);
          break;
        }
        case 'stall': {
          if (this.interior !== e.f) break;
          const ent = s.factories[e.f]?.entities.find((x) => x.id === e.e);
          if (ent) this.audio.play(e.status === 'starved' ? 'alert_starved' : 'alert_blocked', { pos: this.view.factories.get(e.f)!.entityWorld(ent, tmp) });
          break;
        }
        case 'dock':
          if (this.interior === e.f && e.dir === 'out') {
            const ent = s.factories[e.f]?.entities.find((x) => x.id === e.e);
            if (ent) this.audio.play('item_drop', { pos: this.view.factories.get(e.f)!.entityWorld(ent, tmp), gain: 0.5 });
          }
          break;
        case 'sale': {
          const b = s.buildings.find((x) => x.id === e.store)!;
          const p = new THREE.Vector3(b.x, 3.5, b.z);
          this.audio.play('cash_register', { pos: p });
          this.popup(p, `+${money(e.price)}`);
          const door = new THREE.Vector3(b.x, 0.15, b.z - 5.5);
          this.view.people.spawnShopper(door, new THREE.Vector3(b.x + (s.tick % 2 ? 22 : -22), 0.15, b.z - 9.6), s.tick);
          if (!this.firstSaleShown) {
            this.firstSaleShown = true;
            this.toast(t('note.first_sale', { item: `item.${e.item}`, price: money(e.price) }), 'good');
            this.audio.play('milestone');
          }
          break;
        }
        case 'lostSale':
          if (s.tick - this.lostSaleNote > 2 * 60 * TPS && s.stores[e.store].minute.lost + s.stores[e.store].minute.lostQueue >= 3) {
            this.lostSaleNote = s.tick;
            this.toast(t('note.lost_sales', { reason: t(e.reason === 'queue' ? 'store.lost_queue' : 'store.lost_stock', { n: '' }) }), 'warn');
          }
          break;
        case 'vehicle': {
          const p = this.view.vehicles.worldPos(e.v);
          if (!p) break;
          if (e.what === 'arrive') this.audio.play('van_door', { pos: p });
          if (e.what === 'unloaded' || e.what === 'loaded') this.audio.play('unload_thud', { pos: p });
          break;
        }
        case 'orderOffered':
          this.toast(t('note.order_new'), 'info');
          this.audio.play('notify');
          break;
        case 'orderDone':
          this.toast(e.bonus ? t('note.order_bonus', { reward: money(e.reward), bonus: money(e.bonus) }) : t('note.order_done', { reward: money(e.reward) }), 'good');
          this.audio.play('order_complete');
          break;
        case 'unlock':
          this.toast(t('note.unlock', { what: `unlock.${e.id}` }), 'good');
          break;
        case 'level': {
          const b = s.buildings.find((x) => x.id === e.building)!;
          this.toast(t('note.level', { building: `building.${b.def}`, level: e.level }), 'good');
          this.audio.play('level_up');
          this.audio.play('construct_complete', { pos: new THREE.Vector3(b.x + 8, 2, b.z + 5) });
          if (b.role === 'store') this.view.refreshStore(this.sim, b.id);
          else this.view.puff(new THREE.Vector3(b.x + s.factories[b.id].w / 2, 3, b.z + s.factories[b.id].h / 2), 24);
          this.view.rig.shake = 0.6;
          break;
        }
        case 'tutorial':
          this.audio.play('tutorial_step');
          break;
        case 'trend':
          this.toast(t(e.phase === 'soon' ? 'note.trend_soon' : e.phase === 'start' ? 'note.trend_start' : 'note.trend_end', { item: `item.${e.item}` }), e.phase === 'end' ? 'info' : 'good');
          if (e.phase === 'start') this.audio.play('notify');
          break;
        case 'notify':
          this.toast(t(e.key, e.params), e.sev);
          break;
      }
    }
  }

  private updateAudio(dt: number) {
    const s = this.sim.s;
    const c = this.view.rig.cur;
    const zoom01 = this.view.rig.zoom01();
    const fid = this.interior;
    let activity = 0;
    if (fid) {
      const f = s.factories[fid];
      const machines = f.entities.filter((e) => e.kind === 'machine' && !this.db.machines.get(e.def)!.role);
      activity = machines.length ? machines.filter((e) => e.kind === 'machine' && e.status === 'working').length / machines.length : 0;
      const fv = this.view.factories.get(fid)!;
      const tmp = new THREE.Vector3();
      for (const e of f.entities) {
        if (e.kind !== 'machine') continue;
        const m = this.db.machines.get(e.def)!;
        const loop = LOOP_SOUND[m.anim];
        if (loop) this.audio.setLoop(`m:${fid}:${e.id}`, loop, fv.entityWorld(e, tmp).clone(), e.status === 'working' ? 0.5 : 0);
      }
      const moving = f.entities.filter((e) => e.kind === 'belt' && e.items.length).length;
      this.audio.setLoop(`belts:${fid}`, 'loop_belt', new THREE.Vector3(fv.b.x + f.w / 2, 0.5, fv.b.z + f.h / 2), Math.min(1, moving / 8));
      this.audio.setLoop('amb:interior', 'loop_amb_interior', new THREE.Vector3(fv.b.x + f.w / 2, 1, fv.b.z + f.h / 2), 0.6);
    } else {
      this.audio.setLoop('amb:interior', 'loop_amb_interior', new THREE.Vector3(c.x, 1, c.z), 0);
      for (const id of Object.keys(s.factories)) this.audio.setLoop(`belts:${id}`, 'loop_belt', new THREE.Vector3(c.x, 0, c.z), 0);
    }
    for (const v of s.vehicles) {
      const p = this.view.vehicles.worldPos(v.id);
      if (!p) continue;
      const moving = v.state === 'to_pickup' || v.state === 'to_dropoff' || v.state === 'returning';
      this.audio.setLoop(`veh:${v.id}`, v.kind === 'van' ? 'loop_van_engine' : 'loop_truck_engine', p, moving ? 0.6 : 0.15);
    }
    for (const st of Object.values(s.stores)) {
      const b = s.buildings.find((x) => x.id === st.id)!;
      this.audio.setLoop(`shop:${st.id}`, 'loop_shop_chatter', new THREE.Vector3(b.x, 1.5, b.z), Math.min(1, st.queue.length / 3 + st.lastMinute.sold / 10));
    }
    const night = this.view.night;
    this.audio.setLoop('amb:day', 'loop_amb_city_day', new THREE.Vector3(c.x, 2, c.z), 1 - night);
    this.audio.setLoop('amb:night', 'loop_amb_city_night', new THREE.Vector3(c.x, 2, c.z), night);
    const ctx: ListenerContext = { x: c.x, y: 0, z: c.z, zoom01, night, district: fid ? 'workshop' : 'city', activity, interior: !!fid, yaw: c.yaw };
    if (night > 0.6) ctx.district = 'city';
    this.audio.update(dt, ctx);
  }

  // ======================================================================== input
  private bindInput() {
    this.input = new InputController(this.view.renderer.domElement, this.view.rig, {
      onTap: (x, y, e) => this.onTap(x, y, e.pointerType),
      onHover: (x, y) => this.onHover(x, y),
      wantsDraw: () => !!this.tool && this.db.machines.get(this.tool.def)?.role === 'belt',
      onDrawStart: (x, y) => this.drawStart(x, y),
      onDrawMove: (x, y) => this.drawMove(x, y),
      onDrawEnd: () => this.drawEnd(),
    });
    window.addEventListener('keydown', (e) => {
      if (this.mode !== 'playing' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'escape') this.back();
      else if (k === 'r' && this.tool) this.rotateTool();
      else if (k === ' ') {
        e.preventDefault();
        this.setSpeed(this.speed ? 0 : this.lastSpeed || 1);
      } else if (k === '1' || k === '2' || k === '3') this.setSpeed(Number(k));
      else if (k === 'b') this.toggleSheet('build');
      else if ((k === 'delete' || k === 'backspace') && this.selection?.type === 'entity') {
        const sel = this.selection;
        if (this.run({ t: 'remove', f: sel.f, e: sel.id }, 'build_remove')) this.select(null);
      }
    });
  }

  private onTap(x: number, y: number, pointerType: string) {
    if (this.mode === 'photo') return;
    if (this.mode !== 'playing') return;
    if (this.tool && this.interior) {
      const tile = this.view.tileUnder(x, y, this.interior);
      if (!tile) return;
      if (pointerType !== 'mouse' && (!this.tool.hasPos || this.tool.x !== tile[0] || this.tool.y !== tile[1])) {
        this.moveTool(tile[0], tile[1]);
        return;
      }
      this.moveTool(tile[0], tile[1]);
      this.placeTool();
      return;
    }
    const p = this.view.pick(x, y, this.interior);
    this.handlePick(p);
  }

  private handlePick(p: Pick | null) {
    if (!p) return this.select(null);
    if (p.type === 'tile') {
      const f = this.sim.s.factories[p.f];
      const e = entityAt(f, this.db, p.x, p.y);
      if (e) return this.select({ type: 'entity', f: p.f, id: e.id });
      if (p.x < 0 || p.y < 0 || p.x >= f.w || p.y >= f.h) {
        // Tapped outside the hall: treat as a city pick.
        return this.select(null);
      }
      return this.select(null);
    }
    if (p.type === 'building') {
      if (this.selection?.type === 'building' && this.selection.id === p.id && this.sim.s.factories[p.id]) return this.enterInterior(p.id);
      return this.select({ type: 'building', id: p.id });
    }
    if (p.type === 'entity') return this.select({ type: 'entity', f: p.f, id: p.id });
    if (p.type === 'vehicle') return this.select({ type: 'vehicle', id: p.id });
    this.select(null);
  }

  private onHover(x: number, y: number) {
    if (!this.tool || !this.interior || x < 0) return;
    const tile = this.view.tileUnder(x, y, this.interior);
    if (tile) this.moveTool(tile[0], tile[1]);
  }

  // ======================================================================== build tool
  startBuild(def: string) {
    const ws = this.interior ?? Object.keys(this.sim.s.factories)[0];
    if (!this.interior) this.enterInterior(ws);
    this.sheet = null;
    this.selection = null;
    this.tool = { def, rot: 0, x: 0, y: 0, hasPos: false, valid: false, reason: '' };
    this.view.factories.get(ws)!.setGridVisible(true);
    this.audio.play('ui_open');
    this.renderBuildbar();
    this.renderPanel(true);
  }

  /** Pick up an existing machine and place it elsewhere (free, keeps its contents and settings). */
  startMove(fid: string, id: number) {
    const e = this.sim.s.factories[fid]?.entities.find((x) => x.id === id);
    if (!e) return;
    this.startBuild(e.def);
    this.tool!.moveId = id;
    this.tool!.rot = e.rot;
    this.moveTool(e.x, e.y);
  }

  cancelTool() {
    this.tool = null;
    this.drawing = null;
    this.view?.setGhost(null);
    this.view?.setBeltPreview(null, [], true);
    for (const fv of this.view?.factories.values() ?? []) fv.setGridVisible(false);
    this.buildbar.classList.add('hidden');
  }

  rotateTool() {
    if (!this.tool) return;
    this.tool.rot = ((this.tool.rot + 1) % 4) as Dir;
    this.audio.play('build_rotate');
    if (this.tool.hasPos) this.moveTool(this.tool.x, this.tool.y);
  }

  private moveTool(x: number, y: number) {
    const tool = this.tool!;
    const fid = this.interior!;
    const f = this.sim.s.factories[fid];
    const m = this.db.machines.get(tool.def)!;
    const [fw, fh] = footprintOf(m, tool.rot);
    // Centre multi-tile machines on the pointer.
    const px = Math.max(0, Math.min(f.w - fw, x - Math.floor((fw - 1) / 2)));
    const py = Math.max(0, Math.min(f.h - fh, y - Math.floor((fh - 1) / 2)));
    tool.x = px;
    tool.y = py;
    tool.hasPos = true;
    const chk = checkPlacement(this.db, f, tool.def, px, py, tool.rot, tool.moveId ?? 0);
    const cost = tool.moveId ? 0 : m.cost;
    tool.valid = chk.ok && this.sim.s.cash >= cost;
    tool.reason = chk.ok ? (this.sim.s.cash >= cost ? '' : t('err.no_cash', { cost: money(cost) })) : t(chk.reason, chk.params);
    if (m.role === 'belt') {
      const existing = entityAt(f, this.db, px, py);
      if (existing?.kind === 'belt') {
        tool.valid = true;
        tool.reason = '';
      }
      this.view.setGhost(null);
      this.view.setBeltPreview(fid, [{ x: px, y: py, rot: tool.rot }], tool.valid);
    } else this.view.setGhost(tool.def, fid, px, py, tool.rot, tool.valid);
    this.renderBuildbar();
  }

  private placeTool() {
    const tool = this.tool!;
    const fid = this.interior!;
    const m = this.db.machines.get(tool.def)!;
    if (!tool.valid) {
      this.audio.play('build_invalid');
      this.toast(tool.reason || t('err.out_of_bounds'), 'warn');
      return;
    }
    if (m.role === 'belt') {
      this.run({ t: 'placeBelts', f: fid, tiles: [{ x: tool.x, y: tool.y, rot: tool.rot }] }, 'build_belt');
      this.moveTool(tool.x, tool.y);
      return;
    }
    const r = tool.moveId
      ? this.sim.exec({ t: 'move', f: fid, e: tool.moveId, x: tool.x, y: tool.y, rot: tool.rot })
      : this.sim.exec({ t: 'place', f: fid, def: tool.def, x: tool.x, y: tool.y, rot: tool.rot });
    if (!r.ok) {
      this.audio.play('build_invalid');
      this.toast(t(r.reason, r.params), 'warn');
      return;
    }
    this.audio.play('build_place', { pos: new THREE.Vector3(this.sim.s.buildings[0].x + tool.x + 1, 0.5, this.sim.s.buildings[0].z + tool.y + 1) });
    const fv = this.view.factories.get(fid)!;
    this.view.puff(new THREE.Vector3(fv.b.x + tool.x + 1, 0.2, fv.b.z + tool.y + 0.5), 8);
    const id = tool.moveId ?? (r.ok ? r.id : undefined);
    this.cancelTool();
    if (id) this.select({ type: 'entity', f: fid, id });
  }

  private drawStart(x: number, y: number) {
    const tile = this.view.tileUnder(x, y, this.interior!);
    if (!tile) return;
    this.drawing = { sx: tile[0], sy: tile[1], tiles: [], valid: true };
    this.drawMove(x, y);
  }

  private drawMove(x: number, y: number) {
    if (!this.drawing || !this.interior) return;
    const tile = this.view.tileUnder(x, y, this.interior);
    if (!tile) return;
    const f = this.sim.s.factories[this.interior];
    const [cx, cy] = [Math.max(0, Math.min(f.w - 1, tile[0])), Math.max(0, Math.min(f.h - 1, tile[1]))];
    const { sx, sy } = this.drawing;
    const pts: [number, number][] = [];
    const horizFirst = Math.abs(cx - sx) >= Math.abs(cy - sy);
    let x0 = sx;
    let y0 = sy;
    pts.push([x0, y0]);
    const stepTo = (tx: number, ty: number) => {
      while (x0 !== tx || y0 !== ty) {
        if (x0 !== tx) x0 += Math.sign(tx - x0);
        else y0 += Math.sign(ty - y0);
        pts.push([x0, y0]);
      }
    };
    if (horizFirst) {
      stepTo(cx, sy);
      stepTo(cx, cy);
    } else {
      stepTo(sx, cy);
      stepTo(cx, cy);
    }
    const tiles: { x: number; y: number; rot: Dir }[] = [];
    let valid = true;
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i];
      let rot: Dir = this.tool!.rot;
      const n = pts[i + 1] ?? null;
      const p = pts[i - 1] ?? null;
      const d = n ? [n[0] - px, n[1] - py] : p ? [px - p[0], py - p[1]] : null;
      if (d) rot = (d[0] === 1 ? 0 : d[1] === 1 ? 1 : d[0] === -1 ? 2 : 3) as Dir;
      const ex = entityAt(f, this.db, px, py);
      if (ex && ex.kind !== 'belt') valid = false;
      tiles.push({ x: px, y: py, rot });
    }
    const newCount = tiles.filter((tt) => !(entityAt(f, this.db, tt.x, tt.y)?.kind === 'belt')).length;
    if (this.sim.s.cash < newCount * this.db.machines.get('belt')!.cost) valid = false;
    this.drawing.tiles = tiles;
    this.drawing.valid = valid;
    this.view.setBeltPreview(this.interior, tiles, valid);
    if (tiles.length) this.tool!.rot = tiles[tiles.length - 1].rot;
    this.renderBuildbar();
  }

  private drawEnd() {
    const d = this.drawing;
    this.drawing = null;
    if (!d || !this.interior || !d.tiles.length) return;
    if (!d.valid) {
      this.audio.play('build_invalid');
      this.toast(t('err.tile_occupied', { what: '' }), 'warn');
      this.view.setBeltPreview(null, [], true);
      return;
    }
    this.run({ t: 'placeBelts', f: this.interior, tiles: d.tiles }, 'build_belt');
    this.view.setBeltPreview(null, [], true);
  }

  // ======================================================================== navigation
  enterInterior(fid: string) {
    this.interior = fid;
    const f = this.sim.s.factories[fid];
    const b = this.sim.s.buildings.find((x) => x.id === fid)!;
    this.view.rig.yawRange = [0.2, 1.37];
    this.view.rig.minDist = 6;
    this.view.rig.setGoal({ x: b.x + f.w / 2, z: b.z + f.h / 2 + 0.5, dist: Math.max(f.w, f.h) * 1.35 + 4, yaw: 0.72, pitch: 1.0 });
    if (!this.sim.s.tutorial.flags.viewed_interior) this.sim.exec({ t: 'tutorialFlag', flag: 'viewed_interior' });
    this.audio.play('ui_open');
    // Don't auto-open the building panel: on phones it would cover the hall. The toolbar has the actions.
    this.selection = null;
    this.renderToolbar();
    this.renderPanel(true);
  }

  exitInterior() {
    this.cancelTool();
    this.interior = null;
    this.view.rig.yawRange = null;
    this.view.rig.minDist = 7;
    this.view.rig.setGoal({ dist: 70, pitch: 0.9 });
    this.audio.play('ui_close');
    this.select(null);
    this.renderToolbar();
  }

  interiorOf() {
    return this.interior;
  }

  back() {
    if (this.modalHost.classList.contains('hidden') === false && this.mode === 'playing') return this.closeModal();
    if (this.tool) return this.cancelTool();
    if (this.sheet) return this.openSheet(null);
    if (this.selection) return this.select(null);
    if (this.interior) return this.exitInterior();
  }

  select(sel: Selection | null) {
    this.selection = sel;
    if (sel) this.sheet = null;
    this.showSupplyRoutes(sel);
    this.view.openBuilding = sel?.type === 'building' && this.sim.s.stores[sel.id] ? sel.id : null;
    for (const fv of this.view.factories.values()) fv.highlight.clear();
    if (sel?.type === 'entity') this.view.factories.get(sel.f)?.highlight.add(sel.id);
    if (sel) this.audio.play('ui_tap');
    this.renderPanel(true);
  }

  /** Selecting a business highlights who supplies it and where its goods go (real van routes). */
  private showSupplyRoutes(sel: Selection | null) {
    const s = this.sim.s;
    const flows: { from: number; to: number; color: number }[] = [];
    if (sel?.type === 'building') {
      const b = s.buildings.find((x) => x.id === sel.id);
      const depot = s.buildings.find((x) => x.role === 'depot');
      const factories = s.buildings.filter((x) => x.role === 'factory');
      if (b?.role === 'store') for (const f of factories) flows.push({ from: f.access, to: b.access, color: 0x3fb871 });
      if (b?.role === 'factory') {
        if (depot) flows.push({ from: depot.access, to: b.access2 ?? b.access, color: 0x3b82c4 });
        for (const st of s.buildings.filter((x) => x.role === 'store')) flows.push({ from: b.access, to: st.access, color: 0x3fb871 });
      }
      if (b?.role === 'depot') for (const f of factories) flows.push({ from: b.access, to: f.access2 ?? f.access, color: 0x3b82c4 });
    }
    this.view.setRoutes(s, flows);
  }

  openSheet(name: SheetName | null) {
    this.sheet = name;
    if (name) this.selection = null;
    for (const fv of this.view.factories.values()) fv.highlight.clear();
    this.audio.play(name ? 'ui_open' : 'ui_close');
    this.renderToolbar();
    this.renderPanel(true);
  }

  private toggleSheet(name: SheetName) {
    this.openSheet(this.sheet === name ? null : name);
  }

  setSpeed(n: number) {
    if (n > 0) this.lastSpeed = n;
    this.speed = n;
    this.audio.play('ui_toggle');
    this.renderHud();
  }

  // ======================================================================== UiCtx
  run(cmd: Command, okSound = 'ui_confirm'): boolean {
    const r = this.sim.exec(cmd);
    if (r.ok) {
      if (okSound) this.audio.play(okSound);
    } else {
      this.audio.play('ui_error');
      this.toast(t(r.reason, r.params), 'warn');
    }
    this.renderPanel(true);
    this.renderHud();
    return r.ok;
  }

  icon(item: string): HTMLElement {
    const url = this.icons.get(item);
    return url ? h('img', { class: 'itemicon', src: url, alt: '' }) : h('span', { class: 'itemicon' });
  }

  toast(text: string, sev: 'good' | 'warn' | 'info' = 'info') {
    const el = h('div', { class: `toast ${sev}` }, h('span', { 'aria-hidden': 'true' }, sev === 'good' ? '✓' : sev === 'warn' ? '!' : 'i'), text);
    this.toasts.prepend(el);
    while (this.toasts.children.length > 4) this.toasts.lastChild!.remove();
    setTimeout(() => el.remove(), sev === 'warn' ? 5200 : 3800);
  }

  sound(id: string) {
    this.audio.play(id);
  }

  rerender() {
    this.renderPanel(true);
  }

  // ======================================================================== rendering: HUD / toolbar / panel
  /** HUD elements are created once and updated in place: rebuilding them would drop presses mid-tap. */
  private hudEls: { cash: HTMLElement; rate: HTMLElement; clock: HTMLElement; speed: HTMLButtonElement[]; overdraft: HTMLElement; save: HTMLElement; lang: string } | null = null;

  renderHud() {
    if (this.mode === 'title') return;
    const s = this.sim.s;
    if (!this.hudEls || this.hudEls.lang !== getLang()) {
      clear(this.hud);
      const cash = h('div', { class: 'cash' });
      const rate = h('div', { class: 'rate' });
      const clock = h('div', { class: 'clock' });
      const speed = [0, 1, 2, 3].map((n) => h('button', { class: 'btn small', 'aria-label': n ? t('hud.speed', { n }) : t('hud.pause'), onclick: () => this.setSpeed(n) }, n === 0 ? '❚❚' : n === 1 ? '▶' : n === 2 ? '▶▶' : '▶▶▶'));
      const overdraft = h('div', { class: 'chip small bad hidden' }, t('hud.overdraft'));
      const save = h('span', { class: 'savestate' });
      this.hud.append(
        h('div', { class: 'chip' }, h('div', null, cash, rate)),
        h('div', { class: 'chip' }, clock, h('div', { class: 'speed', role: 'group' }, ...speed)),
        h('div', { class: 'spacer' }),
        overdraft,
        h('div', { class: 'chip' }, save, h('button', { class: 'btn small', onclick: () => this.menuModal(), 'aria-label': t('tb.menu') }, '☰')),
      );
      this.hudEls = { cash, rate, clock, speed, overdraft, save, lang: getLang() };
    }
    const el = this.hudEls;
    const mins = s.ledger.minutes.slice(-6, -1);
    let rate = 0;
    for (const m of mins) for (const k of ['sales', 'contracts', 'imports', 'wages', 'energy', 'maintenance', 'freight'] as const) rate += m.a[k] ?? 0;
    rate = mins.length ? rate / mins.length : 0;
    const clk = clockOf(s.tick);
    const hh = Math.floor(clk.hour);
    const mm = Math.floor((clk.hour - hh) * 60);
    const setText = (e: HTMLElement, v: string) => {
      if (e.textContent !== v) {
        clear(e);
        e.append(bdi(v));
      }
    };
    setText(el.cash, money(s.cash));
    setText(el.rate, t('hud.per_min', { v: (rate >= 0 ? '+' : '') + money(Math.round(rate)) }));
    el.rate.className = `rate ${rate > 0 ? 'pos' : rate < 0 ? 'neg' : ''}`;
    setText(el.clock, t('hud.day', { d: clk.day, time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` }));
    el.speed.forEach((b, n) => {
      b.classList.toggle('on', this.speed === n);
      b.setAttribute('aria-pressed', String(this.speed === n));
    });
    el.overdraft.classList.toggle('hidden', s.cash >= 0);
    el.save.textContent = this.saves.lastError ? t('hud.save_failed') : t('hud.saved');
  }

  renderToolbar() {
    clear(this.toolbar);
    const items: [SheetName | 'enter' | 'exit', string, string][] = [];
    if (this.interior) items.push(['exit', '🏙️', t('tb.exit')]);
    else items.push(['enter', '🏭', t('tb.enter')]);
    items.push(['build', '🛠️', t('tb.build')], ['imports', '📦', t('tb.imports')], ['orders', '📋', t('tb.orders')], ['research', '💡', t('tb.research')], ['logistics', '🚐', t('tb.logistics')], ['stats', '📈', t('tb.stats')]);
    for (const [id, icon, label] of items) {
      this.toolbar.append(
        h('button', {
          class: `btn ${this.sheet === id ? 'on' : ''}`,
          'data-tut': `ui:${id}`,
          'data-sheet': id,
          onclick: () => (id === 'enter' ? this.enterInterior(Object.keys(this.sim.s.factories)[0]) : id === 'exit' ? this.exitInterior() : this.toggleSheet(id as SheetName)),
        }, h('span', { class: 'icon', 'aria-hidden': 'true' }, icon), label),
      );
    }
    this.renderToolbarBadges();
  }

  private renderToolbarBadges() {
    const s = this.sim.s;
    const offered = s.orders.filter((o) => o.status === 'offered').length;
    const available = [...this.db.unlocks.keys()].filter((id) => !s.unlocked.includes(id)).filter((id) => {
      const u = this.db.unlocks.get(id)!;
      return u.chapter === 1 && u.requires.every((r) => s.unlocked.includes(r)) && (u.conditions ?? []).every((c) => {
        if (c.t === 'sold') return (s.stats.sold[c.item] ?? 0) >= c.qty;
        if (c.t === 'produced') return (s.stats.produced[c.item] ?? 0) >= c.qty;
        if (c.t === 'revenue') return (s.ledger.total.sales ?? 0) + (s.ledger.total.contracts ?? 0) >= c.cents;
        if (c.t === 'orders') return s.stats.ordersCompleted >= c.count;
        return true;
      });
    }).length;
    for (const el of Array.from(this.toolbar.children) as HTMLElement[]) {
      const id = el.dataset.sheet;
      el.querySelector('.badge')?.remove();
      const n = id === 'orders' ? offered : id === 'research' ? available : 0;
      if (n) el.append(h('span', { class: 'badge' }, String(n)));
    }
    this.highlightTutorial();
  }

  private panelKey = '';
  private panelPointer = false;
  renderPanel(force = false) {
    if (this.mode !== 'playing') return;
    if (!force && this.panelPointer) return;
    let out: PanelOut | null = null;
    if (this.sheet) {
      out = this.sheet === 'build' ? buildSheet(this) : this.sheet === 'imports' ? importsSheet(this) : this.sheet === 'orders' ? ordersSheet(this) : this.sheet === 'research' ? researchSheet(this) : this.sheet === 'stats' ? statsSheet(this) : logisticsSheet(this);
    } else if (this.selection && !this.tool) out = selectionPanel(this, this.selection);
    if (!out) {
      this.panel.classList.add('hidden');
      this.panelKey = '';
      if (this.selection && !this.tool) this.selection = null;
      return;
    }
    const key = (this.sheet ?? '') + JSON.stringify(this.selection) + out.body.innerHTML;
    if (!force && key === this.panelKey) return;
    this.panelKey = key;
    const oldBody = this.panel.querySelector('.body') as HTMLElement | null;
    const scroll = oldBody?.scrollTop ?? 0;
    clear(this.panel);
    this.panel.className = `panel ${out.wide ? 'wide' : ''}`;
    const body = h('div', { class: 'body' }, out.body);
    this.panel.append(h('header', null, h('h2', null, out.title), h('button', { class: 'btn small ghost', 'aria-label': t('tb.close'), onclick: () => (this.sheet ? this.openSheet(null) : this.select(null)) }, '✕')), body);
    body.scrollTop = scroll;
    this.highlightTutorial();
  }

  private renderBuildbar() {
    const tool = this.tool;
    if (!tool) return this.buildbar.classList.add('hidden');
    const m = this.db.machines.get(tool.def)!;
    clear(this.buildbar);
    this.buildbar.classList.remove('hidden');
    const isBelt = m.role === 'belt';
    const msg = tool.hasPos && !tool.valid && tool.reason ? h('div', { class: 'msg bad' }, tool.reason) : h('div', { class: 'msg' }, isBelt ? t('build.belt_desc') : t('build.tip_place'));
    this.buildbar.append(
      h('b', null, isBelt ? t('build.belt') : machineName(tool.def), ' · ', tool.moveId ? t('build.move') : money(m.cost)),
      msg,
      h('button', { class: 'btn small', onclick: () => this.rotateTool(), 'aria-label': t('build.rotate') }, `⟳ ${t('build.rotate')}`),
      !isBelt && tool.hasPos ? h('button', { class: 'btn small primary', onclick: () => this.placeTool() }, '✓') : '',
      h('button', { class: 'btn small', onclick: () => this.cancelTool() }, isBelt ? t('build.done') : t('build.cancel')),
    );
  }

  // ======================================================================== tutorial
  private renderTutorial() {
    const s = this.sim.s;
    const tu = s.tutorial;
    if (tu.skipped || this.mode !== 'playing' || (tu.done && this.tutDoneShown)) {
      this.tutorial.classList.add('hidden');
      return;
    }
    const step = tu.done ? null : TUTORIAL[tu.step];
    const id = step ? step.id : 'done';
    const key = `${id}:${getLang()}`;
    if (this.tutorial.dataset.key === key && !this.tutorial.classList.contains('hidden')) return;
    this.tutorial.dataset.key = key;
    clear(this.tutorial);
    this.tutorial.classList.remove('hidden');
    this.tutorial.append(h('h4', null, t(`tut.${id}.title`)), h('p', null, t(`tut.${id}.body`)));
    if (step) this.tutorial.append(h('div', { class: 'row' }, h('span', { class: 'steps grow' }, `${tu.step + 1} / ${TUTORIAL.length}`), h('button', { class: 'btn small', onclick: () => this.run({ t: 'skipTutorial' }, 'ui_close') }, t('tut.skip'))));
    else
      this.tutorial.append(h('button', { class: 'btn small', onclick: () => { this.tutDoneShown = true; this.tutorial.classList.add('hidden'); } }, t('common.ok')));
    this.highlightTutorial();
  }

  private highlightTutorial() {
    for (const el of Array.from(document.querySelectorAll('.tut-target'))) el.classList.remove('tut-target');
    const s = this.sim?.s;
    if (!s || s.tutorial.done || s.tutorial.skipped || this.mode !== 'playing') return;
    const step = TUTORIAL[s.tutorial.step];
    if (!step?.target) return;
    let sel = '';
    switch (step.id) {
      case 'welcome':
        sel = this.interior ? '' : this.selection?.type === 'building' ? '[data-tut="enter"]' : '[data-tut="ui:enter"]';
        break;
      case 'import_wood':
        sel = this.sheet === 'imports' ? '[data-tut="import:wood_pieces"]' : '[data-tut="ui:imports"]';
        break;
      case 'place_bench':
        sel = this.sheet === 'build' ? '[data-tut="build:assembly_bench"]' : '[data-tut="ui:build"]';
        break;
      case 'bench_recipe':
        sel = '[data-tut="recipe"]';
        break;
      case 'belt_in':
      case 'ship':
        sel = this.sheet === 'build' ? '[data-tut="build:belt"]' : '[data-tut="ui:build"]';
        break;
      case 'place_packer':
        sel = this.sheet === 'build' ? '[data-tut="build:packing_station"]' : '[data-tut="ui:build"]';
        break;
      case 'cartons':
        sel = this.sheet === 'imports' ? '[data-tut="import:carton_flat"]' : '[data-tut="ui:imports"]';
        break;
      case 'accept_order':
        sel = this.sheet === 'orders' ? '[data-tut="order"]' : '[data-tut="ui:orders"]';
        break;
      case 'research_car':
        sel = this.sheet === 'research' ? '[data-tut="research:ch1_toy_car"]' : '[data-tut="ui:research"]';
        break;
    }
    if (sel) document.querySelector(sel)?.classList.add('tut-target');
  }

  // ======================================================================== world markers
  private updateMarkers() {
    const s = this.sim.s;
    let used = 0;
    const use = (cls: string, text: string, world: THREE.Vector3) => {
      const p = this.view.project(world);
      if (!p.visible) return;
      let el = this.markerPool[used];
      if (!el) {
        el = h('div', { class: 'marker' });
        this.markerPool.push(el);
        this.markers.append(el);
      }
      used++;
      el.className = cls;
      if (el.textContent !== text) el.textContent = text;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.display = '';
    };
    const tmp = new THREE.Vector3();
    if (this.interior) {
      const f = s.factories[this.interior];
      const fv = this.view.factories.get(this.interior)!;
      for (const e of f.entities) {
        if (e.kind !== 'machine') continue;
        const st = e.status;
        if (st === 'working' || st === 'idle') continue;
        const m = this.db.machines.get(e.def)!;
        if (m.role === 'shipping' && st !== 'blocked') continue;
        // An unassigned bay only matters once there is something in receiving storage to unload.
        if (m.role === 'receiving' && st === 'no_recipe' && !Object.keys(f.inbound).length) continue;
        const label =
          m.role === 'receiving' && st === 'no_recipe'
            ? t('panel.choose_item')
            : st === 'starved' && e.statusItem
              ? itemName(e.statusItem)
              : st === 'blocked' && m.role !== 'receiving' && e.statusItem
                ? itemName(e.statusItem)
                : t(`status.${st}`);
        use(`marker ${st}`, `${statusSym(st)} ${label}`, fv.entityWorld(e, tmp).setY(1.9));
      }
    } else if (this.view.rig.cur.dist < 140) {
      for (const [id, f] of Object.entries(s.factories)) {
        const stalled = f.entities.filter((e) => e.kind === 'machine' && (e.status === 'starved' || e.status === 'blocked' || e.status === 'no_power' || e.status === 'no_worker' || e.status === 'no_recipe') && !this.db.machines.get(e.def)!.role).length;
        const b = s.buildings.find((x) => x.id === id)!;
        use('label3d', `${t('sel.workshop')}${stalled ? ` · ⚠ ${stalled}` : ''}${f.upgradeTicks ? ` · 🏗 ${Math.ceil(f.upgradeTicks / TPS)}s` : ''}`, tmp.set(b.x + f.w / 2, 7.5, b.z + f.h / 2));
      }
      for (const st of Object.values(s.stores)) {
        const b = s.buildings.find((x) => x.id === st.id)!;
        const lost = st.lastMinute.lost + st.lastMinute.lostQueue;
        use('label3d', `${t('sel.store')}${lost ? ` · ⚠ ${lost}` : ''}`, tmp.set(b.x, 7.5, b.z));
      }
      const depot = s.buildings.find((x) => x.role === 'depot')!;
      use('label3d', t('sel.depot'), tmp.set(depot.x, 9, depot.z));
    }
    if (grantAvailable(s) && !this.panel.querySelector('.status.starved')) {
      // Offer the safety net proactively but quietly.
      if (s.tick - this.grantNote > 5 * 60 * TPS) {
        this.grantNote = s.tick;
        this.toast(t('note.grant'), 'warn');
      }
    }
    for (let i = used; i < this.markerPool.length; i++) this.markerPool[i].style.display = 'none';
  }

  private popup(world: THREE.Vector3, text: string) {
    const p = this.view.project(world);
    if (!p.visible) return;
    const el = h('div', { class: 'popup' }, text);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    this.markers.append(el);
    setTimeout(() => el.remove(), 1700);
  }

  // ======================================================================== modals
  showModal(el: HTMLElement, closable = true) {
    clear(this.modalHost);
    this.modalHost.className = '';
    this.modalHost.style.cssText = 'position:absolute;inset:0;';
    this.modalHost.append(el);
    if (closable) el.addEventListener('pointerdown', (e) => e.target === el && this.closeModal());
  }

  closeModal() {
    clear(this.modalHost);
    this.modalHost.className = 'hidden';
    if (this.mode === 'title') this.showTitle();
  }

  private menuModal() {
    const body = h('div', { class: 'body', style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    const b = (label: string, fn: () => void, cls = '') => body.append(h('button', { class: `btn ${cls}`, onclick: fn }, label));
    b(t('menu.resume'), () => this.closeModal(), 'primary');
    b(t('menu.save'), async () => { await this.saveNow(); this.toast(t('hud.saved'), 'good'); });
    b(t('menu.export'), () => this.exportFile());
    b(t('menu.import'), () => this.pickerInput.click());
    b(t('menu.settings'), () => this.settingsModal());
    b(t('menu.help'), () => this.helpModal());
    b(t('menu.photo'), () => this.photoMode());
    if (grantAvailable(this.sim.s)) body.append(grantBox(this));
    b(t('menu.title_screen'), async () => { await this.saveNow(); this.closeModal(); this.showTitle(); });
    this.showModal(h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('header', null, h('h2', null, t('tb.menu')), h('button', { class: 'btn small ghost', onclick: () => this.closeModal() }, '✕')), body)));
  }

  settingsModal() {
    const S = this.settings;
    const save = () => {
      saveSettings(S);
      this.audio.applySettings(S.audio);
      this.applyUiSettings();
      this.view.rig.reducedMotion = S.reducedMotion;
      this.view.rig.shakeEnabled = S.cameraShake;
      this.view.reducedEffects = S.reducedEffects;
      this.fps.classList.toggle('hidden', !S.showFps);
    };
    const slider = (label: string, get: () => number, set: (v: number) => void, min = 0, max = 1, step = 0.05) =>
      h('div', { class: 'row' }, h('label', { class: 'grow' }, label), h('input', { type: 'range', min, max, step, value: get(), style: { maxWidth: '55%' }, oninput: (e: Event) => { set(Number((e.target as HTMLInputElement).value)); save(); } }));
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => { set((e.target as HTMLInputElement).checked); save(); } }), label);
    const body = h('div', { class: 'body' });
    body.append(
      h('div', { class: 'section' }, h('h3', null, t('set.language')), h('select', { class: 'sel', onchange: (e: Event) => { S.lang = (e.target as HTMLSelectElement).value as Lang; setLang(S.lang); save(); this.settingsModal(); this.renderToolbar(); this.renderHud(); } }, ...LANGS.map((l) => h('option', { value: l.id, selected: l.id === S.lang }, l.name)))),
      h('div', { class: 'section' }, h('h3', null, t('set.audio')), slider(t('set.master'), () => S.audio.master, (v) => (S.audio.master = v)), slider(t('set.music'), () => S.audio.music, (v) => (S.audio.music = v)), slider(t('set.sfx'), () => S.audio.sfx, (v) => (S.audio.sfx = v)), slider(t('set.ambience'), () => S.audio.ambience, (v) => (S.audio.ambience = v)), slider(t('set.ui'), () => S.audio.ui, (v) => (S.audio.ui = v)), toggle(t('set.mute'), () => S.audio.muted, (v) => (S.audio.muted = v))),
      h('div', { class: 'section' }, h('h3', null, t('set.graphics')), h('div', { class: 'row' }, h('label', { class: 'grow' }, t('set.quality')), h('select', { class: 'sel', onchange: (e: Event) => { S.quality = (e.target as HTMLSelectElement).value as Settings['quality']; this.view.applyQuality(S.quality); save(); } }, ...(['low', 'medium', 'high'] as const).map((q) => h('option', { value: q, selected: S.quality === q }, t(`set.q.${q}`))))), toggle(t('set.reduced_motion'), () => S.reducedMotion, (v) => (S.reducedMotion = v)), toggle(t('set.reduced_effects'), () => S.reducedEffects, (v) => (S.reducedEffects = v)), toggle(t('set.camera_shake'), () => S.cameraShake, (v) => (S.cameraShake = v)), toggle(t('set.high_contrast'), () => S.highContrast, (v) => (S.highContrast = v)), slider(t('set.text_size'), () => S.textScale, (v) => (S.textScale = v), 0.85, 1.4, 0.05), toggle(t('set.fps'), () => S.showFps, (v) => (S.showFps = v))),
      h('div', { class: 'section' }, h('h3', null, t('set.offline')), h('p', { class: 'small muted' }, t('set.offline_desc', { hours: OFFLINE_HORIZON_SEC / 3600 })), h('p', { class: 'small muted' }, t('set.storage', { backend: this.saves.backend.name }))),
    );
    if (this.mode === 'playing') body.append(h('button', { class: 'btn small', onclick: () => { this.sim.s.tutorial.skipped = false; this.sim.s.tutorial.done = false; this.sim.s.tutorial.step = 0; this.tutDoneShown = false; this.closeModal(); } }, t('set.tutorial')));
    this.showModal(h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('header', null, h('h2', null, t('set.title')), h('button', { class: 'btn small ghost', onclick: () => this.closeModal() }, '✕')), body)));
  }

  helpModal() {
    const body = h('div', { class: 'body' }, ...['help.loop', 'help.belts', 'help.status', 'help.demand', 'help.controls_touch', 'help.controls_mouse', 'help.recovery'].map((k) => h('p', null, t(k))));
    this.showModal(h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('header', null, h('h2', null, t('help.title')), h('button', { class: 'btn small ghost', onclick: () => this.closeModal() }, '✕')), body)));
  }

  private photoMode() {
    this.closeModal();
    this.mode = 'photo';
    for (const el of [this.hud, this.toolbar, this.panel, this.tutorial, this.toasts, this.markers, this.buildbar]) el.classList.add('hidden');
    const bar = h('div', { class: 'photo-bar' },
      h('span', null, t('photo.time')),
      h('input', { type: 'range', min: 0, max: 24, step: 0.25, value: this.view.hour, oninput: (e: Event) => (this.view.hourOverride = Number((e.target as HTMLInputElement).value)) }),
      h('button', { class: 'btn small primary', onclick: () => { const url = this.view.capture(); const a = document.createElement('a'); a.href = url; a.download = `tiny-factory-${Date.now()}.png`; a.click(); this.audio.play('ui_confirm'); } }, `📷 ${t('photo.capture')}`),
      h('button', { class: 'btn small', onclick: () => { bar.remove(); this.view.hourOverride = null; this.mode = 'playing'; for (const el of [this.hud, this.toolbar, this.toasts, this.markers]) el.classList.remove('hidden'); this.renderPanel(true); } }, t('photo.exit')),
    );
    this.ui.append(bar);
  }
}
