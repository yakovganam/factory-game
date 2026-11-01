// End-to-end journey through the REAL UI and canvas input (no sim shortcuts):
// title → new city → workshop → imports → bench (+recipe) → drawn belts → packer → shipping → first sale.
// Usage: node tools/e2e-opening.mjs [--phone]  (writes captures/e2e/*.png and captures/e2e/report.json)
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const phone = process.argv.includes('--phone');
const out = `captures/e2e${phone ? '-phone' : ''}`;
mkdirSync(out, { recursive: true });
const PORT = 5198;
execSync('npx vite build --outDir .e2e-dist --emptyOutDir --logLevel error', { stdio: 'inherit' });
const server = spawn('node_modules/.bin/vite', ['preview', '--outDir', '.e2e-dist', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const vp = phone ? { width: 844, height: 390 } : { width: 1366, height: 768 };
const ctx = await browser.newContext({ viewport: vp, hasTouch: phone });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const steps = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  await fn();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${String(steps.length).padStart(2, '0')}_${name}.png` });
  steps.push({ name, ms: Date.now() - t0 });
  console.log('step', name);
};
const tap = async (sel) => {
  const el = page.locator(sel).first();
  await el.waitFor({ state: 'visible', timeout: 30000 });
  if (phone) await el.tap(); else await el.click();
};
const tile = (x, y) => page.evaluate(([x, y]) => window.__app.tileScreen('ws1', x, y), [x, y]);
const tapTile = async (x, y) => {
  const p = await tile(x, y);
  if (phone) { await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(150); await page.touchscreen.tap(p.x, p.y); }
  else await page.mouse.click(p.x, p.y);
};
const dragTiles = async (pts) => {
  // Belt drawing with real pointer drag (mouse; touch drag uses the same pointer-event path).
  const ps = [];
  for (const [x, y] of pts) ps.push(await tile(x, y));
  await page.mouse.move(ps[0].x, ps[0].y);
  await page.mouse.down();
  for (const p of ps.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
};
const state = () => page.evaluate(() => { const s = window.__app.sim.s; return { tick: s.tick, cash: s.cash, sold: s.stats.sold, produced: s.stats.produced, tut: s.tutorial.step, ents: s.factories.ws1.entities.map((e) => e.def) }; });
try {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#title', { timeout: 120000 });
  await step('title', async () => {});
  await step('new_city', async () => { await tap('text=New city'); await tap('.slot .btn.primary'); await page.waitForTimeout(1500); });
  await step('enter_workshop', async () => { await tap('[data-tut="ui:enter"]'); await page.waitForTimeout(2500); });
  await step('import_wood', async () => { await tap('[data-tut="ui:imports"]'); await tap('[data-tut="import:wood_pieces"] .btn >> nth=1'); await tap('[data-tut="import:carton_flat"] .btn >> nth=0'); });
  await step('build_bench', async () => { await tap('[data-tut="ui:build"]'); await tap('[data-tut="build:assembly_bench"]'); await page.waitForTimeout(300); await tapTile(3, 1); });
  await step('bench_recipe', async () => { await tap('[data-tut="recipe"] .choice >> nth=0'); });
  await step('belts_in', async () => { await tap('[data-tut="ui:build"]'); await tap('[data-tut="build:belt"]'); await dragTiles([[1, 1], [2, 1]]); });
  await step('belts_out', async () => { await dragTiles([[5, 1], [6, 1], [6, 2], [7, 2]]); await page.keyboard.press('Escape'); });
  await step('build_packer', async () => { await tap('[data-tut="ui:build"]'); await tap('[data-tut="build:packing_station"]'); await page.keyboard.press('r'); await tapTile(8, 2); await tapTile(8, 3); });
  await step('packer_recipe', async () => { const st = await state(); if (!st.ents.includes('packing_station')) throw new Error('packer not placed: ' + JSON.stringify(st.ents)); await tap('[data-tut="recipe"] .choice >> nth=0'); });
  await step('belt_ship', async () => { await tap('[data-tut="ui:build"]'); await tap('[data-tut="build:belt"]'); await dragTiles([[8, 1], [8, 0]]); await page.keyboard.press('Escape'); });
  // Run at 3x until the first sale (real-time loop; SwiftShader is slow, so allow a long wait).
  await step('speed3', async () => { await tap('.speed .btn >> nth=3'); });
  const t0 = Date.now();
  let st = await state();
  while (!Object.values(st.sold).some((n) => n > 0) && Date.now() - t0 < 600000) { await page.waitForTimeout(5000); st = await state(); }
  await step('first_sale', async () => { await tap('[data-tut="ui:enter"], [data-tut="ui:exit"]'); await page.waitForTimeout(1500); });
  const final = await state();
  const ok = Object.values(final.sold).some((n) => n > 0);
  writeFileSync(`${out}/report.json`, JSON.stringify({ ok, viewport: vp, phone, steps, final, errors, realSecondsToFirstSale: Math.round((Date.now() - t0) / 1000) }, null, 2));
  console.log(ok ? 'E2E PASS' : 'E2E FAIL', JSON.stringify(final.sold), 'errors', errors.length);
} catch (e) {
  await page.screenshot({ path: `${out}/zz_failure.png` });
  writeFileSync(`${out}/report.json`, JSON.stringify({ ok: false, error: String(e), steps, errors, state: await state().catch(() => null) }, null, 2));
  console.log('E2E ERROR', e.message);
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
