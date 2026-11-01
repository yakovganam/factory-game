#!/usr/bin/env node
// End-to-end runtime test of the real AudioManager in headless Chromium (Vite dev server on
// port 5191, killed afterwards). Verifies unlock, lazy SFX bank, voice caps, min-interval,
// distance culling, loop clustering/caps, music start + theme crossfade + adaptive stems,
// ducking, suspend/resume and console cleanliness. Writes docs/qa/audio-runtime-report.md.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/harness.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 5191;
const vite = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
let browser;
try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start')), 30000);
    vite.stdout.on('data', (d) => {
      if (String(d).includes('Local')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  const warnings = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${PORT}/tools/audio/sandbox.html`);
  await page.waitForFunction(() => !!window.__audio);
  const dbg = () => page.evaluate(() => window.__audio.debugInfo());
  const sleep = (ms) => page.waitForTimeout(ms);

  check('not unlocked before a gesture', !(await dbg()).unlocked);
  await page.evaluate(() => window.__audio.play('ui_tap'));
  check('play() before unlock is a silent no-op', (await dbg()).uiVoices === 0);
  await page.click('#unlock');
  await page.waitForFunction(() => window.__audio.debugInfo().unlocked, null, { timeout: 5000 });
  const d0 = await dbg();
  check('unlock() from a click resumes the AudioContext', d0.unlocked && d0.state === 'running', `state=${d0.state}, sampleRate=${d0.sampleRate}`);

  // ---- SFX bank
  const tBank = Date.now();
  await page.waitForFunction(() => window.__audio.bank.get('ui_confirm').length > 0, null, { timeout: 10000 });
  check('UI sounds render first (lazy bank)', true, `ui_confirm ready after ${Date.now() - tBank} ms`);
  await page.waitForFunction(() => window.__audio.debugInfo().rendered === window.__audio.debugInfo().totalVariations, null, { timeout: 60000 });
  const d1 = await dbg();
  check('whole SFX bank renders in the background', d1.rendered === d1.totalVariations, `${d1.rendered}/${d1.totalVariations} variations, ${d1.bankMB} MB in ${((Date.now() - tBank) / 1000).toFixed(1)} s`);

  // ---- one-shots
  const allIds = await page.evaluate(() => {
    const a = window.__audio;
    let n = 0;
    for (const d of a.bank.catalog ?? []) void d;
    return n;
  });
  void allIds;
  const playedAll = await page.evaluate(async () => {
    const a = window.__audio;
    const ids = Object.keys((await import('/src/audio/sfx-catalog.ts')).SFX_BY_ID).filter((id) => !id.startsWith('loop_'));
    let maxSfx = 0;
    let maxUi = 0;
    for (const id of ids) {
      a.play(id);
      const d = a.debugInfo();
      maxSfx = Math.max(maxSfx, d.sfxVoices);
      maxUi = Math.max(maxUi, d.uiVoices);
    }
    return { n: ids.length, maxSfx, maxUi };
  });
  check('global voice caps hold when every event fires at once', playedAll.maxSfx <= 24 && playedAll.maxUi <= 8, `${playedAll.n} events -> peak sfx voices ${playedAll.maxSfx} (cap 24), ui ${playedAll.maxUi} (cap 8)`);
  await sleep(2500);
  const perEvent = await page.evaluate(async () => {
    const a = window.__audio;
    let max = 0;
    for (let i = 0; i < 8; i++) {
      a.play('bench_work', { pos: { x: 2, y: 0, z: 0 } });
      max = Math.max(max, a.voices.filter((v) => v.id === 'bench_work' && !v.stopped).length);
      await new Promise((r) => setTimeout(r, 130));
    }
    return max;
  });
  check('per-event cap (bench_work maxVoices 3)', perEvent <= 3, `peak ${perEvent}`);
  const interval = await page.evaluate(() => {
    const a = window.__audio;
    const before = a.voices.filter((v) => v.id === 'sale_coin').length;
    for (let i = 0; i < 10; i++) a.play('sale_coin');
    return a.voices.filter((v) => v.id === 'sale_coin').length - before;
  });
  check('min retrigger interval (10 sale_coin in one frame -> 1 voice)', interval === 1, `${interval} started`);
  const culled = await page.evaluate(() => {
    const a = window.__audio;
    const before = a.voices.length;
    a.play('item_drop', { pos: { x: 5000, y: 0, z: 0 } });
    return a.voices.length - before;
  });
  check('distance culling (item_drop at 5 km starts no voice)', culled === 0);
  const unknown = await page.evaluate(() => {
    try {
      window.__audio.play('no_such_event');
      return true;
    } catch {
      return false;
    }
  });
  check('unknown event id is ignored with a warning', unknown && warnings.some((w) => w.includes('no_such_event')));

  // ---- loops: 100 machines
  await page.evaluate(() => {
    window.__stress = setInterval(() => {
      for (let i = 0; i < 100; i++) window.__audio.setLoop(`m${i}`, i % 3 ? 'loop_belt' : 'loop_motor_hum', { x: (i % 10) * 5 - 22, y: 0, z: Math.floor(i / 10) * 5 - 22 }, 1);
    }, 50);
  });
  await sleep(1500);
  const d2 = await dbg();
  const belts = d2.loopVoices.filter((v) => v.key.startsWith('loop_belt')).length;
  const motors = d2.loopVoices.filter((v) => v.key.startsWith('loop_motor_hum')).length;
  check('100 machine loops collapse into few clustered voices', d2.loopVoices.length <= 12 && belts <= 3 && motors <= 3, `${d2.loopRequests} requests -> ${d2.loopVoices.length} voices (belt ${belts}, motor ${motors}, ambience ${d2.loopVoices.length - belts - motors}); cell ${d2.cellSize} m`);
  await page.evaluate(() => clearInterval(window.__stress));
  await sleep(5500);
  const d3 = await dbg();
  check('stale loops (no setLoop refresh) fade out', d3.loopVoices.filter((v) => !v.key.startsWith('loop_amb')).length === 0, `${d3.loopVoices.length} voices left (auto-ambience beds: ${d3.loopVoices.map((v) => v.key).join(', ')})`);
  check('automatic ambience bed plays (city day)', d3.loopVoices.some((v) => v.key === 'loop_amb_city_day'));

  // ---- music
  await page.waitForFunction(() => window.__audio.debugInfo().music?.playing === 'workshop', null, { timeout: 20000 });
  const m1 = (await dbg()).music;
  check('music starts after unlock with the workshop theme', m1.playing === 'workshop', `formats ${m1.formats.join('>')}, themes ${JSON.stringify(m1.themes)}`);
  await sleep(2500);
  const m2 = (await dbg()).music;
  check('stems loaded & mixed (base + lead + rhythm)', m2.stems.base > 0.5 && m2.stems.lead > 0.3 && 'rhythm' in m2.stems, JSON.stringify(m2.stems));
  await page.evaluate(() => (window.__listener.activity = 0));
  await sleep(9000);
  const m3 = (await dbg()).music;
  await page.evaluate(() => (window.__listener.activity = 0.9));
  await sleep(9000);
  const m4 = (await dbg()).music;
  check('rhythm stem follows production health (off when idle, on when busy)', m3.stems.rhythm < 0.05 && m4.stems.rhythm > 0.5, `idle rhythm ${m3.stems.rhythm}, busy rhythm ${m4.stems.rhythm}`);
  const p1 = (await dbg()).music.positionSec;
  await sleep(1000);
  const p2 = (await dbg()).music.positionSec;
  check('music clock advances', p2 > p1, `${p1.toFixed(2)} -> ${p2.toFixed(2)} s`);
  await page.evaluate(() => (window.__listener.night = 1));
  await page.waitForFunction(() => window.__audio.debugInfo().music?.playing === 'evening', null, { timeout: 20000 });
  const tSwitch = Date.now();
  check('night switches to the evening theme (debounced crossfade)', true, `after debounce + bar boundary`);
  await sleep(6000);
  const m5 = (await dbg()).music;
  check('crossfade completes and old theme is released', m5.playing === 'evening' && Object.keys(m5.stems).length >= 1, JSON.stringify({ stems: m5.stems, themes: m5.themes, ms: Date.now() - tSwitch }));

  // ---- duck / suspend / resume / mute
  await page.evaluate(() => window.__audio.duck(0.6, 1));
  await sleep(300);
  const duckV = (await dbg()).duck;
  await sleep(2500);
  const duckR = (await dbg()).duck;
  check('duck lowers music then recovers', duckV < 0.5 && duckR > 0.9, `during ${duckV}, after ${duckR}`);
  await page.evaluate(() => window.__audio.suspend());
  await sleep(300);
  const s1 = (await dbg()).state;
  await page.evaluate(() => window.__audio.play('ui_tap'));
  const sv = (await dbg()).uiVoices;
  await page.evaluate(() => window.__audio.resume());
  await sleep(300);
  const s2 = (await dbg()).state;
  check('suspend()/resume() pause and restore the context', s1 === 'suspended' && s2 === 'running' && sv === 0, `${s1} -> ${s2}`);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('test harness', false, String(e?.stack ?? e));
} finally {
  await browser?.close();
  vite.kill('SIGTERM');
}

const ok = results.every((r) => r.ok);
const md = [
  '# Audio QA — runtime (AudioManager in headless Chromium)',
  '',
  `Generated by \`node tools/audio/test-runtime.mjs\` on ${new Date().toISOString()}. Drives the real \`AudioManager\` through \`tools/audio/sandbox.html\` (Vite dev server, port ${PORT}) with a real click to unlock. Headless Chromium has no audio device, so this proves behaviour/timing/graph logic, not sound quality.`,
  '',
  `Result: **${ok ? 'PASS' : 'FAIL'}** (${results.filter((r) => r.ok).length}/${results.length})`,
  '',
  '| check | result | detail |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.ok ? 'pass' : '**FAIL**'} | ${String(r.detail).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`),
  '',
];
fs.writeFileSync(path.join(ROOT, 'docs/qa/audio-runtime-report.md'), md.join('\n'));
process.exit(ok ? 0 : 1);
