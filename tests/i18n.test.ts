import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en/ui.json';
import he from '../src/i18n/he/ui.json';
import enContent from '../src/i18n/en/content.json';

const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('UI localization (en + he)', () => {
  it('has identical key sets in English and Hebrew', () => {
    const a = Object.keys(en).sort();
    const b = Object.keys(he).sort();
    expect(a.filter((k) => !b.includes(k))).toEqual([]);
    expect(b.filter((k) => !a.includes(k))).toEqual([]);
  });

  it('keeps the same {placeholders} in every translation', () => {
    const bad: string[] = [];
    for (const k of Object.keys(en)) if (JSON.stringify(params((en as any)[k])) !== JSON.stringify(params((he as any)[k] ?? ''))) bad.push(k);
    expect(bad).toEqual([]);
  });

  it('Hebrew strings are actually Hebrew (not untranslated English)', () => {
    const latinOnly = Object.entries(he).filter(([k, v]) => !/[֐-׿]/.test(v) && /[a-z]{3,}/i.test(v.replace(/\{\w+\}/g, '')) && !['menu.slot_summary', 'panel.tier', 'panel.upgrade'].includes(k));
    expect(latinOnly.map(([k]) => k)).toEqual([]);
  });

  // Content keys (item./machine./recipe./building./unlock.) are checked by the content validator.
  it('every literal UI t("...") key used in the UI/render code exists', () => {
    const files = [...walk('src/ui'), ...walk('src/render').filter((f) => !f.includes('/models/'))];
    const missing = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\('([a-z_]+\.[a-z0-9_.]+)'/g)) if (!/^(item|machine|recipe|building|unlock)\./.test(m[1]) && !(m[1] in en) && !(m[1] in enContent)) missing.add(`${m[1]} (${f})`);
    }
    expect([...missing]).toEqual([]);
  });
});
