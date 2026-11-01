// In-engine screenshot capture (real WebGL2 render in headless Chromium/SwiftShader).
// Usage: node tools/capture.mjs [outDir] [--scenes a,b,c]
// Starts the Vite dev server on port 5199, drives App.debugScene(), and writes PNGs + a JSON
// report with renderer stats and console errors. SwiftShader is a CPU renderer: frame times
// recorded here are NOT GPU performance evidence.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const outDir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'captures/gameplay';
const sceneArg = process.argv.find((a) => a.startsWith('--scenes='));
mkdirSync(outDir, { recursive: true });
const PORT = 5199;

const ALL = [
  { name: 'title_desktop', w: 1600, h: 900, title: true },
  { name: 'title_phone', w: 844, h: 390, title: true },
  { name: 'interior_desktop', w: 1600, h: 900, scene: 'interior', seconds: 150 },
  { name: 'interior_phone', w: 844, h: 390, scene: 'interior', seconds: 150 },
  { name: 'machine_panel_desktop', w: 1600, h: 900, scene: 'machine', seconds: 150 },
  { name: 'build_ghost_phone', w: 844, h: 390, scene: 'build', seconds: 60 },
  { name: 'street_desktop', w: 1600, h: 900, scene: 'street', seconds: 150 },
  { name: 'store_panel_phone', w: 844, h: 390, scene: 'store', seconds: 200 },
  { name: 'city_desktop', w: 1600, h: 900, scene: 'city', seconds: 150 },
  { name: 'night_interior_desktop', w: 1600, h: 900, scene: 'interior', seconds: 150, hour: 21.5 },
  { name: 'research_he_phone', w: 844, h: 390, scene: 'research', seconds: 200, lang: 'he' },
  { name: 'interior_he_desktop', w: 1600, h: 900, scene: 'machine', seconds: 150, lang: 'he' },
  { name: 'stats_desktop', w: 1600, h: 900, scene: 'stats', seconds: 400 },
  { name: 'tutorial_fresh_phone', w: 844, h: 390, scene: 'fresh', tutorial: true },
  { name: 'tablet_interior', w: 1180, h: 820, scene: 'interior', seconds: 150 },
];
const only = sceneArg ? sceneArg.split('=')[1].split(',') : null;
const scenes = only ? ALL.filter((s) => only.includes(s.name)) : ALL;

// Capture from a production build (immune to source edits/HMR, closer to what ships).
import { execSync } from 'node:child_process';
execSync('npx vite build --outDir .capture-dist --emptyOutDir --logLevel error', { stdio: 'inherit' });
const server = spawn('node_modules/.bin/vite', ['preview', '--outDir', '.capture-dist', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('vite start timeout')), 60000);
  server.stdout.on('data', (d) => { if (String(d).includes('Local')) { clearTimeout(to); res(); } });
  server.stderr.on('data', (d) => process.stderr.write(d));
});

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const report = [];
try {
  for (const sc of scenes) {
   try {
    const ctx = await browser.newContext({ viewport: { width: sc.w, height: sc.h }, deviceScaleFactor: 1, hasTouch: sc.w < 1000, isMobile: false });
    const page = await ctx.newPage();
    page.setDefaultTimeout(240000);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(`http://127.0.0.1:${PORT}/?capture=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__app && document.getElementById('title'), null, { timeout: 120000 });
    if (!sc.title) {
      await page.evaluate((o) => window.__app.debugScene(o), { scene: sc.scene, lang: sc.lang, seconds: sc.seconds, hour: sc.hour, tutorial: sc.tutorial });
    }
    await page.waitForTimeout(sc.title ? 2500 : 3500); // camera easing + several frames
    const t0 = Date.now();
    const frames = await page.evaluate(() => new Promise((res) => { const ts = []; let last = performance.now(); let n = 0; const f = (t) => { ts.push(t - last); last = t; if (++n < 12) requestAnimationFrame(f); else res(ts); }; requestAnimationFrame(f); }));
    const stats = await page.evaluate(() => window.__app.view.stats());
    const file = `${outDir}/${sc.name}.png`;
    await page.screenshot({ path: file, timeout: 240000 });
    const sorted = [...frames].sort((a, b) => a - b);
    report.push({ ...sc, file, stats, swiftshaderFrameMsMedian: sorted[Math.floor(sorted.length / 2)], errors, ms: Date.now() - t0 });
    console.log(`captured ${file} calls=${stats.calls} tris=${stats.tris} errors=${errors.length}`);
    await ctx.close();
   } catch (e) {
    console.log(`FAILED ${sc.name}: ${String(e).split('\n')[0]}`);
    report.push({ ...sc, failed: String(e).split('\n')[0] });
   }
   writeFileSync(`${outDir}/report.json`, JSON.stringify({ when: new Date().toISOString(), renderer: 'Chromium headless + SwiftShader (CPU) — not GPU evidence', scenes: report }, null, 2));
  }
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
writeFileSync(`${outDir}/report.json`, JSON.stringify({ when: new Date().toISOString(), renderer: 'Chromium headless + SwiftShader (CPU) — not GPU evidence', scenes: report }, null, 2));
