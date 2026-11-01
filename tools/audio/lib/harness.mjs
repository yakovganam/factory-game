// Shared headless-Chromium harness for the audio tools: bundles a TS entry with esbuild, loads it
// into a blank page and offers helpers to pull large binary results back to Node in chunks.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export async function bundle(entry) {
  const esbuild = require('esbuild');
  const res = await esbuild.build({
    entryPoints: [path.resolve(ROOT, entry)],
    bundle: true,
    format: 'iife',
    write: false,
    target: 'es2022',
    platform: 'browser',
    logLevel: 'warning',
    define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false' },
  });
  return res.outputFiles[0].text;
}

export async function openPage(entry) {
  const { chromium } = require('playwright');
  const code = await bundle(entry);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({ content: code });
  return { browser, page, errors };
}

/** Pull a base64 payload stored in window.__blobs[key] in ~8 MB slices. */
export async function fetchBlob(page, key) {
  const len = await page.evaluate((k) => window.__blobs[k].length, key);
  const parts = [];
  const step = 8 * 1024 * 1024;
  for (let s = 0; s < len; s += step) {
    parts.push(await page.evaluate(([k, a, b]) => window.__blobs[k].slice(a, b), [key, s, s + step]));
  }
  await page.evaluate((k) => delete window.__blobs[k], key);
  return Buffer.from(parts.join(''), 'base64');
}
