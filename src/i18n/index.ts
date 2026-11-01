/**
 * Localization runtime. English and Hebrew are release languages; Hebrew uses true RTL layout
 * (dir="rtl" + CSS logical properties), never reversed strings. Numbers and money are formatted
 * with Intl for the active locale; mixed Hebrew/English/number runs are isolated with <bdi> by
 * the UI where needed.
 */
import enUi from './en/ui.json';
import heUi from './he/ui.json';
import enContent from './en/content.json';
import heContent from './he/content.json';

export type Lang = 'en' | 'he';
export const LANGS: { id: Lang; name: string; dir: 'ltr' | 'rtl'; locale: string }[] = [
  { id: 'en', name: 'English', dir: 'ltr', locale: 'en-US' },
  { id: 'he', name: 'עברית', dir: 'rtl', locale: 'he-IL' },
];

const tables: Record<Lang, Record<string, string>> = {
  en: { ...(enContent as Record<string, string>), ...(enUi as Record<string, string>) },
  he: { ...(heContent as Record<string, string>), ...(heUi as Record<string, string>) },
};

let lang: Lang = 'en';
let numFmt = new Intl.NumberFormat('en-US');
let moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
let moneyFmt2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const listeners: (() => void)[] = [];
const missing = new Set<string>();

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang) {
  lang = l;
  const meta = LANGS.find((x) => x.id === l)!;
  numFmt = new Intl.NumberFormat(meta.locale);
  moneyFmt = new Intl.NumberFormat(meta.locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  moneyFmt2 = new Intl.NumberFormat(meta.locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l;
    document.documentElement.dir = meta.dir;
  }
  for (const f of listeners) f();
}

export function onLangChange(f: () => void) {
  listeners.push(f);
}

export function isRtl() {
  return lang === 'he';
}

/** Detect a sensible default from the browser. */
export function detectLang(): Lang {
  const n = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return n.toLowerCase().startsWith('he') || n.toLowerCase().startsWith('iw') ? 'he' : 'en';
}

const KEY_PREFIXES = ['item.', 'machine.', 'recipe.', 'unlock.', 'building.', 'status.', 'err.', 'cust.', 'block.', 'log.', 'res.', 'sel.'];

/** Translate `key`, substituting {params}. Param values that are i18n keys are translated too. */
export function t(key: string, params?: Record<string, string | number | undefined>): string {
  let s = tables[lang][key] ?? tables.en[key];
  if (s === undefined) {
    if (!missing.has(key)) {
      missing.add(key);
      if (import.meta.env?.DEV) console.warn('[i18n] missing', key);
    }
    s = humanize(key);
  }
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (_, p) => {
      const v = params[p];
      if (v === undefined) return '';
      if (typeof v === 'number') return numFmt.format(v);
      if (KEY_PREFIXES.some((k) => v.startsWith(k)) && (tables[lang][v] || tables.en[v])) return t(v);
      return v;
    });
  }
  return s;
}

export function has(key: string) {
  return key in tables[lang] || key in tables.en;
}

function humanize(key: string) {
  const last = key.split('.').pop() ?? key;
  return last.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Money in cents → localized currency string. Shows cents only for small amounts. */
export function money(cents: number, forceCents = false): string {
  const v = cents / 100;
  return forceCents || (Math.abs(cents) < 10000 && cents % 100 !== 0) ? moneyFmt2.format(v) : moneyFmt.format(Math.round(v));
}

export function num(n: number, digits = 0): string {
  return digits ? new Intl.NumberFormat(LANGS.find((x) => x.id === lang)!.locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n) : numFmt.format(n);
}

export function duration(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return t('time.sec', { n: sec });
  const m = Math.floor(sec / 60);
  if (m < 60) return t('time.min', { n: m });
  return t('time.h', { n: Math.floor(m / 60), m: m % 60 });
}

export function itemName(id: string) {
  return t(`item.${id}`);
}
export function machineName(id: string) {
  return t(`machine.${id}`);
}

export function missingKeys(): string[] {
  return [...missing];
}

export function allKeys(l: Lang): string[] {
  return Object.keys(tables[l]);
}
