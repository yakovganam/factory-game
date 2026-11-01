/**
 * Save system.
 *  - Versioned envelope with checksum; migrations upgrade older envelopes step by step.
 *  - Primary backend IndexedDB: each write is ONE readwrite transaction that moves the previous
 *    save to `<slot>.bak` and writes the new one (atomic: both or neither).
 *  - Fallback backend localStorage (same rotation, best effort), then in-memory with a warning.
 *  - Corrupt/unparseable primary → automatic recovery from the backup, reported to the player.
 *  - Export/import as a JSON file so players can keep their own backups (browser storage can be evicted).
 */
import { hashState, stableStringify } from '../sim/core';
import type { GameState } from '../sim/types';
import { SAVE_VERSION } from '../sim/types';

export const SAVE_FORMAT = 'tftc-save';
export const SLOT_COUNT = 3;

export interface SaveSummary {
  cash: number;
  tick: number;
  revenue: number;
  level: number;
}

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  version: number;
  slot: number;
  savedAt: number;
  summary: SaveSummary;
  checksum: string;
  state: GameState;
}

export type LoadResult =
  | { ok: true; env: SaveEnvelope; recovered: boolean; migratedFrom?: number }
  | { ok: false; reason: 'empty' | 'corrupt' | 'unsupported' | 'storage'; detail?: string };

// ---------------------------------------------------------------------------- envelope
export function summarize(s: GameState): SaveSummary {
  const ws = Object.values(s.factories)[0];
  return { cash: s.cash, tick: s.tick, revenue: (s.ledger.total.sales ?? 0) + (s.ledger.total.contracts ?? 0), level: ws?.level ?? 1 };
}

export function makeEnvelope(s: GameState, slot: number, now: number): SaveEnvelope {
  return { format: SAVE_FORMAT, version: SAVE_VERSION, slot, savedAt: now, summary: summarize(s), checksum: hashState(s), state: s };
}

export function serialize(env: SaveEnvelope): string {
  return stableStringify(env);
}

/** Migrations: index i upgrades version i -> i+1. */
const MIGRATIONS: ((st: any) => void)[] = [
  // v0 -> v1: flow counters introduced for conservation auditing.
  (st) => {
    st.stats.consumed ??= {};
    st.stats.imported ??= {};
    st.stats.soldBack ??= {};
  },
];

export function parseEnvelope(text: string): LoadResult {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: 'corrupt', detail: 'json' };
  }
  if (!raw || raw.format !== SAVE_FORMAT || typeof raw.version !== 'number' || !raw.state) return { ok: false, reason: 'corrupt', detail: 'shape' };
  if (raw.version > SAVE_VERSION) return { ok: false, reason: 'unsupported', detail: `v${raw.version}` };
  // Checksum is computed over the state as saved (before migration).
  if (hashState(raw.state) !== raw.checksum) return { ok: false, reason: 'corrupt', detail: 'checksum' };
  const from = raw.version;
  for (let v = from; v < SAVE_VERSION; v++) MIGRATIONS[v](raw.state);
  raw.state.version = SAVE_VERSION;
  raw.version = SAVE_VERSION;
  return { ok: true, env: raw as SaveEnvelope, recovered: false, migratedFrom: from < SAVE_VERSION ? from : undefined };
}

// ---------------------------------------------------------------------------- backends
export interface SaveBackend {
  readonly name: string;
  /** Atomically rotate `key` -> `key.bak` and write `text` to `key`. */
  write(key: string, text: string): Promise<void>;
  read(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

const DB_NAME = 'tftc';
const STORE = 'saves';

export class IdbBackend implements SaveBackend {
  readonly name = 'indexeddb';
  private dbp: Promise<IDBDatabase>;
  constructor() {
    this.dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  }
  async write(key: string, text: string) {
    const db = await this.dbp;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      const cur = os.get(key);
      cur.onsuccess = () => {
        if (typeof cur.result === 'string') os.put(cur.result, key + '.bak');
        os.put(text, key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    });
  }
  async read(key: string) {
    const db = await this.dbp;
    return new Promise<string | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  }
  async remove(key: string) {
    const db = await this.dbp;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.objectStore(STORE).delete(key + '.bak');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export class LocalStorageBackend implements SaveBackend {
  readonly name = 'localstorage';
  async write(key: string, text: string) {
    const cur = localStorage.getItem('tftc:' + key);
    if (cur !== null) localStorage.setItem('tftc:' + key + '.bak', cur);
    localStorage.setItem('tftc:' + key, text); // throws QuotaExceededError -> reported to caller
  }
  async read(key: string) {
    return localStorage.getItem('tftc:' + key);
  }
  async remove(key: string) {
    localStorage.removeItem('tftc:' + key);
    localStorage.removeItem('tftc:' + key + '.bak');
  }
}

export class MemoryBackend implements SaveBackend {
  readonly name = 'memory';
  private m = new Map<string, string>();
  async write(key: string, text: string) {
    const cur = this.m.get(key);
    if (cur !== undefined) this.m.set(key + '.bak', cur);
    this.m.set(key, text);
  }
  async read(key: string) {
    return this.m.get(key) ?? null;
  }
  async remove(key: string) {
    this.m.delete(key);
    this.m.delete(key + '.bak');
  }
  /** Test hook: corrupt a stored value. */
  poke(key: string, text: string) {
    this.m.set(key, text);
  }
}

// ---------------------------------------------------------------------------- manager
export class SaveManager {
  lastError: string | null = null;
  lastSavedAt = 0;
  private writing: Promise<void> | null = null;
  private pending: { slot: number; text: string } | null = null;

  constructor(public backend: SaveBackend) {}

  static async detect(): Promise<SaveManager> {
    try {
      if (typeof indexedDB !== 'undefined') {
        const b = new IdbBackend();
        await b.read('probe');
        return new SaveManager(b);
      }
    } catch {
      /* fall through */
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('tftc:probe', '1');
        localStorage.removeItem('tftc:probe');
        return new SaveManager(new LocalStorageBackend());
      }
    } catch {
      /* fall through */
    }
    return new SaveManager(new MemoryBackend());
  }

  key(slot: number) {
    return `slot${slot}`;
  }

  /** Serialises immediately (snapshot), writes asynchronously; overlapping saves coalesce. */
  save(s: GameState, slot: number, now = Date.now()): Promise<void> {
    const text = serialize(makeEnvelope(s, slot, now));
    this.pending = { slot, text };
    if (!this.writing) this.writing = this.flush();
    return this.writing;
  }

  private async flush() {
    try {
      while (this.pending) {
        const p = this.pending;
        this.pending = null;
        try {
          await this.backend.write(this.key(p.slot), p.text);
          this.lastSavedAt = Date.now();
          this.lastError = null;
        } catch (e: any) {
          this.lastError = e?.name === 'QuotaExceededError' ? 'err.save_quota' : 'err.save_failed';
        }
      }
    } finally {
      this.writing = null;
    }
  }

  async load(slot: number): Promise<LoadResult> {
    let primary: string | null;
    let backup: string | null;
    try {
      primary = await this.backend.read(this.key(slot));
      backup = await this.backend.read(this.key(slot) + '.bak');
    } catch (e: any) {
      return { ok: false, reason: 'storage', detail: String(e?.message ?? e) };
    }
    if (primary === null && backup === null) return { ok: false, reason: 'empty' };
    if (primary !== null) {
      const r = parseEnvelope(primary);
      if (r.ok) return r;
      if (r.reason === 'unsupported') return r;
    }
    if (backup !== null) {
      const r = parseEnvelope(backup);
      if (r.ok) return { ...r, recovered: true };
    }
    return { ok: false, reason: 'corrupt' };
  }

  async summaries(): Promise<(SaveEnvelope['summary'] & { savedAt: number; slot: number } | null)[]> {
    const out: (SaveEnvelope['summary'] & { savedAt: number; slot: number } | null)[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const r = await this.load(i);
      out.push(r.ok ? { ...r.env.summary, savedAt: r.env.savedAt, slot: i } : null);
    }
    return out;
  }

  async remove(slot: number) {
    await this.backend.remove(this.key(slot));
  }
}
