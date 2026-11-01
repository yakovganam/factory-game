#!/usr/bin/env node
/**
 * Captures model-gallery PNGs into captures/models/ with headless Chromium (SwiftShader WebGL2).
 *
 *   node tools/model-gallery/capture.mjs            # full set
 *   node tools/model-gallery/capture.mjs hero       # only shots whose name contains "hero"
 *
 * Starts `npx vite --port 5181` from the repo root if nothing is listening there, and kills it
 * when done. Also writes captures/models/stats.json (triangles / draw calls / materials per model).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'captures/models');
const PORT = 5181;
const BASE = `http://127.0.0.1:${PORT}/tools/model-gallery/index.html`;
const filter = process.argv[2] ?? '';

mkdirSync(OUT, { recursive: true });

async function up() {
  try {
    const r = await fetch(BASE);
    return r.ok;
  } catch {
    return false;
  }
}

let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 120 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
}

const shots = [];
const S = (name, params, w = 1100, h = 760, dpr = 1) => shots.push({ name, params, w, h, dpr });

// --- hero workshop: L1/L2/L3 × closed/cutaway × day/night
for (const L of [1, 2, 3]) {
  S(`hero_workshop_L${L}_closed_day`, `scene=workshop&level=${L}&t=12&ui=0`, 1400, 900);
  S(`hero_workshop_L${L}_cutaway_day`, `scene=workshop&level=${L}&cutaway=1&t=12&ui=0`, 1400, 900);
  S(`hero_workshop_L${L}_closed_night`, `scene=workshop&level=${L}&night=1&t=12&ui=0`, 1400, 900);
  S(`hero_workshop_L${L}_cutaway_night`, `scene=workshop&level=${L}&cutaway=1&night=1&t=12&ui=0`, 1400, 900);
}
S('hero_workshop_L2_cutaway_half', 'scene=workshop&level=2&cutaway=0.45&t=12&ui=0', 1400, 900);
// phone framing (844×390 CSS px at DPR 2)
S('phone_machine_group_day', 'scene=machines&level=2&cutaway=1&t=12&ui=0', 844, 390, 2);
S('phone_machine_group_night', 'scene=machines&level=2&cutaway=1&night=1&t=12&ui=0', 844, 390, 2);
// overview sheets
S('overview_grid', 'scene=grid&t=3', 1800, 1200);
S('overview_items', 'scene=items&t=1', 1400, 760);
S('overview_street_day', 'scene=street&t=5&ui=0', 1600, 800);
S('overview_street_night', 'scene=street&t=5&night=1&ui=0', 1600, 800);

// per-model 3/4 views
const per = [
  ['bld_toy_store', [1, 2, 3].map((l) => `level=${l}`)],
  ['bld_toy_store', ['level=2&cutaway=1']],
  ['bld_import_depot', ['']],
  ['bld_house', [0, 1, 2, 3, 4, 5].map((v) => `variant=${v}`)],
  ['bld_substation', ['']],
  ['mach_belt', ['']],
  ['mach_belt_mk2', ['']],
  ['mach_belt_turn_r', ['']],
  ['mach_belt_turn_l', ['']],
  ['mach_belt_mk2_turn_r', ['']],
  ['mach_belt_mk2_turn_l', ['']],
  ['mach_splitter', ['']],
  ['mach_receiving_dock', ['status=unloading', 'status=idle']],
  ['mach_shipping_dock', ['status=loading']],
  ['mach_assembly_bench', ['progress=0.3']],
  ['mach_packing_station', ['progress=0.55', 'progress=0.85']],
  ['mach_paint_booth', ['progress=0.4', 'status=no_power']],
  ['mach_robot_assembler', ['progress=0.15', 'progress=0.42', 'progress=0.65', 'status=no_worker']],
  ['mach_storage_crate', ['progress=0.7&status=idle']],
  ['veh_van', [0, 1, 2, 3].map((v) => `variant=${v}`).concat(['variant=0&status=loading', 'variant=0&night=1&status=idle'])],
  ['veh_truck', [0, 1, 2, 3].map((v) => `variant=${v}`).concat(['variant=1&status=unloading'])],
  ['chr_worker', [0, 1, 2, 3, 4, 5].map((v) => `variant=${v}&pose=idle`).concat(['variant=0&pose=walk', 'variant=1&pose=carry', 'variant=2&pose=work'])],
  ['chr_pedestrian', [0, 1, 2, 3, 4, 5].map((v) => `variant=${v}&pose=walk`)],
  ['prop_tree', [0, 1, 2].map((v) => `variant=${v}`)],
  ['prop_streetlamp', ['', 'night=1']],
  ['prop_bench', ['']],
  ['prop_hydrant', ['']],
  ['prop_fence', ['variant=0', 'variant=1']],
  ['prop_bin', ['']],
  ['prop_planter', ['']],
  ['prop_sign_for_sale', ['']],
  ['prop_bollard', ['']],
  ['prop_bus_stop', ['']],
];
for (const [id, list] of per)
  for (const p of list) {
    const tag = p.replace(/[=&]/g, '').replace(/status/g, '').replace(/variant/g, 'v').replace(/level/g, 'L').replace(/progress0\./g, 'p').replace(/pose/g, '').replace(/cutaway1/g, '_cut').replace(/night1/g, '_night');
    S(`model_${id}${tag ? '_' + tag : ''}`, `model=${id}&${p}&t=2&ui=0&spin=0`, 900, 640);
  }
// close-ups of the hero machine and robot cell
S('closeup_robot_assembler', 'model=mach_robot_assembler&progress=0.6&t=2&ui=0&cam=close', 1200, 900);
S('closeup_workshop_L1_facade', 'model=bld_toy_workshop&level=1&t=2&ui=0&cam=close&yaw=30&pitch=16', 1400, 900);
S('closeup_workshop_L3_mascot', 'model=bld_toy_workshop&level=3&t=2&ui=0&cam=close&yaw=20&pitch=18', 1400, 900);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const failures = [];
try {
  // stats
  if (!filter || 'stats'.includes(filter)) {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 300 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}?scene=items&stats=1&ui=0`);
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 120000 });
    const stats = await page.evaluate(() => window.__stats);
    writeFileSync(resolve(OUT, 'stats.json'), JSON.stringify(stats, null, 2));
    console.log('stats.json written');
    await ctx.close();
  }
  // shader / console check: every model + variant in one scene, day and night, closed and cut away
  if (!filter || 'shadercheck'.includes(filter)) {
    for (const params of ['scene=grid&t=2&ui=0', 'scene=grid&t=2&ui=0&night=1&cutaway=1&status=no_power']) {
      const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e)));
      page.on('console', (m) => {
        if (m.type() === 'error' || /shader|WebGLProgram/i.test(m.text())) errs.push(m.text().slice(0, 300));
      });
      await page.goto(`${BASE}?${params}`);
      await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
      console.log(`shader check [${params}]: ${errs.length ? 'ERRORS\n  ' + errs.join('\n  ') : 'no console errors'}`);
      if (errs.length) failures.push('shadercheck');
      await ctx.close();
    }
  }
  for (const s of shots) {
    if (filter && !s.name.includes(filter)) continue;
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dpr });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errs.push(m.text());
    });
    const t0 = Date.now();
    try {
      await page.goto(`${BASE}?${s.params}`);
      await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 180000 });
      const err = await page.evaluate(() => window.__error);
      if (err) errs.push(err);
      await page.screenshot({ path: resolve(OUT, `${s.name}.png`), timeout: 180000 });
      console.log(`${s.name}.png  ${Date.now() - t0}ms${errs.length ? '  ERR: ' + errs.join(' | ').slice(0, 300) : ''}`);
      if (errs.length) failures.push(s.name);
    } catch (e) {
      console.log(`${s.name} FAILED: ${e}`);
      failures.push(s.name);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  if (vite) {
    try {
      process.kill(-vite.pid, 'SIGTERM');
    } catch {
      vite.kill('SIGTERM');
    }
  }
}
if (failures.length) console.log('failures:', failures.join(', '));
