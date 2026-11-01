/**
 * AudioManager — the game's single audio entry point (implements the AudioManagerApi contract).
 *
 * Graph:  voices -> bus(ui|sfx|ambience) ----------------------------\
 *         outdoor voices while inside -> lowpass "muffled" -> bus ---+-> master -> HP 40 Hz
 *         music director -> duck -> bus(music) ----------------------/   -> compressor -> limiter -> out
 *
 * Usage (see docs/audio-guide.md):
 *   import { audio } from './audio/AudioManager';
 *   window.addEventListener('pointerdown', () => void audio.unlock(), { capture: true });
 *   // each frame:
 *   audio.update(dt, { x, y, z, zoom01, night, district, activity, interior, yaw });
 *   audio.play('build_place', { pos });
 *   audio.setLoop(`belt:${id}`, 'loop_belt', pos, running ? 1 : 0);
 *
 * Everything degrades to silent no-ops when WebAudio is missing or blocked.
 */
import type { AudioManagerApi, AudioSettings, ListenerContext, MixerBus, PlayOptions } from './types';
import { SFX_CATALOG, SFX_BY_ID, SfxDef } from './sfx-catalog';
import { SfxBank, isDev } from './sfx-bank';
import { spatialize, clamp01, smoothstep, lerp } from './spatial';
import { computeLoopTargets, clusterCell, LoopRequest } from './loop-mixer';
import { MusicDirector, MusicDebug } from './music-director';
import { hashString } from './synth/rng';

export const DEFAULT_SETTINGS: AudioSettings = { master: 0.9, music: 0.7, sfx: 0.9, ambience: 0.8, ui: 0.8, muted: false };

/** Internal mix trims per bus (the "mix design"), multiplied with the user's settings. */
export const BUS_TRIM: Record<MixerBus, number> = { music: 0.5, sfx: 0.85, ambience: 0.6, ui: 0.7 };

export const LIMITS = {
  /** concurrent one-shot voices on sfx+ambience buses */
  sfxVoices: 24,
  /** concurrent UI voices */
  uiVoices: 8,
  /** concurrent (clustered) loop voices */
  loopVoices: 12,
  /** a non-ambience loop that is not refreshed by setLoop for this long fades out */
  staleLoopSec: 4,
  /** how long a play() waits for its buffer to finish rendering before it is dropped */
  pendingSec: 0.25,
};

const AUTO_AMB = { day: 'loop_amb_city_day', night: 'loop_amb_city_night', interior: 'loop_amb_interior' } as const;
const AUTO_AMB_IDS = new Set<string>(Object.values(AUTO_AMB));

interface Voice {
  id: string;
  def: SfxDef;
  src: AudioBufferSourceNode;
  gain: GainNode;
  tail: AudioNode;
  started: number;
  ends: number;
  level: number;
  ui: boolean;
  stopped: boolean;
}

interface LoopVoice {
  key: string;
  def: SfxDef;
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  out: AudioNode;
  muffled: boolean;
  level: number;
  panValue: number;
  dying: boolean;
  dieAt: number;
}

interface Graph {
  master: GainNode;
  bus: Record<MixerBus, GainNode>;
  muffled: Record<MixerBus, BiquadFilterNode>;
  duck: GainNode;
  comp: DynamicsCompressorNode;
  limiter: DynamicsCompressorNode;
}

export interface AudioDebugInfo {
  available: boolean;
  unlocked: boolean;
  state: string;
  sampleRate: number;
  sfxVoices: number;
  uiVoices: number;
  loopVoices: Array<{ key: string; gain: number; pan: number }>;
  loopRequests: number;
  rendered: number;
  totalVariations: number;
  bankMB: number;
  music: MusicDebug | null;
  duck: number;
  autoAmbience: boolean;
  cellSize: number;
}

export interface AudioManagerOptions {
  /** Base URL that public/ files are served from (default: Vite BASE_URL or './'). */
  baseUrl?: string;
}

const DEFAULT_LISTENER: ListenerContext = { x: 0, y: 0, z: 0, zoom01: 0.5, night: 0, district: 'workshop', activity: 0, interior: false, yaw: 0 };

function defaultBaseUrl(): string {
  try {
    const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
    return env?.BASE_URL ?? './';
  } catch {
    return './';
  }
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class AudioManager implements AudioManagerApi {
  private ctx: AudioContext | null = null;
  private g: Graph | null = null;
  private _unlocked = false;
  private broken = false;
  private suspendedByApp = false;
  private settings: AudioSettings = { ...DEFAULT_SETTINGS };
  readonly bank = new SfxBank(SFX_CATALOG);
  private music: MusicDirector | null = null;
  private voices: Voice[] = [];
  private lastPlay = new Map<string, number>();
  private lastVariation = new Map<string, number>();
  private loopReqs = new Map<string, LoopRequest>();
  private loopVoices = new Map<string, LoopVoice>();
  private requested = new Set<string>();
  private listener: ListenerContext = { ...DEFAULT_LISTENER };
  private cellSize = 16;
  private loopTimer = 0;
  private autoAmbience = true;
  private amb = { day: 0, night: 0, interior: 0 };
  private pending: Array<{ id: string; opts?: PlayOptions; at: number }> = [];
  private duckAmount = 0;
  private duckUntil = 0;
  private warned = new Set<string>();
  private baseUrl: string;
  private clock = 0;
  private firstUpdate = -1;
  private forcedTheme: string | null = null;

  constructor(opts: AudioManagerOptions = {}) {
    this.baseUrl = opts.baseUrl ?? defaultBaseUrl();
    this.bank.onReady((id) => this.flushPending(id));
  }

  get unlocked(): boolean {
    return this._unlocked;
  }

  configure(opts: AudioManagerOptions): void {
    if (opts.baseUrl !== undefined) this.baseUrl = opts.baseUrl;
  }

  /** Start rendering the SFX bank in the background (no gesture needed). update() calls this ~1 s after the first frame. */
  prewarm(): void {
    this.bank.start();
  }

  // ------------------------------------------------------------------ lifecycle
  async unlock(): Promise<void> {
    if (this.broken) return;
    try {
      if (!this.ctx) this.createContext();
      const c = this.ctx;
      if (!c) return;
      if (this._unlocked && c.state === 'running') return;
      // iOS: playing a (silent) buffer inside the gesture is what actually unlocks output
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
      if (c.state !== 'running' && !this.suspendedByApp) {
        const p = c.resume();
        await Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]);
      }
      if ((c.state as string) === 'running' && !this._unlocked) {
        this._unlocked = true;
        this.onUnlocked();
      }
    } catch (e) {
      this.warnOnce(`unlock failed: ${String(e)}`);
    }
  }

  suspend(): void {
    this.suspendedByApp = true;
    try {
      void this.ctx?.suspend().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  resume(): void {
    this.suspendedByApp = false;
    if (!this.ctx || !this._unlocked) return;
    try {
      void this.ctx.resume().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  applySettings(s: AudioSettings): void {
    this.settings = {
      master: clamp01(num(s.master, 1)),
      music: clamp01(num(s.music, 1)),
      sfx: clamp01(num(s.sfx, 1)),
      ambience: clamp01(num(s.ambience, 1)),
      ui: clamp01(num(s.ui, 1)),
      muted: !!s.muted,
    };
    this.applyGains();
  }

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  /** Enable/disable automatic ambience beds (city day/night, factory interior) driven by update(). */
  setAutoAmbience(on: boolean): void {
    this.autoAmbience = on;
    if (!on) for (const k of Object.keys(AUTO_AMB)) this.loopReqs.delete(`__auto_${k}`);
  }

  /** Force a music theme (cutscene, sandbox); null = automatic. */
  forceTheme(id: string | null): void {
    this.forcedTheme = id;
    this.music?.force(id);
  }

  stopAllLoops(): void {
    for (const k of [...this.loopReqs.keys()]) if (!k.startsWith('__auto_')) this.loopReqs.delete(k);
  }

  // ------------------------------------------------------------------ one-shots
  play(eventId: string, opts: PlayOptions = {}): void {
    const def = SFX_BY_ID[eventId];
    if (!def) {
      this.warnOnce(`unknown sound event "${eventId}" (ignored)`);
      return;
    }
    if (def.loop) {
      this.warnOnce(`"${eventId}" is a loop — use setLoop()`);
      return;
    }
    const c = this.ctx;
    if (!c || !this.g || !this._unlocked || this.suspendedByApp || this.settings.muted || c.state !== 'running') return;
    const now = c.currentTime;
    if (now - (this.lastPlay.get(eventId) ?? -1e9) < def.minInterval) return;

    let level = def.gain * num(opts.gain, 1);
    let pan = 0;
    let muffled = false;
    if (opts.pos && def.spatial !== false) {
      const s = spatialize(this.listener, opts.pos, def);
      if (!s.audible) return; // distance culling: never start inaudible voices
      level *= s.gain;
      pan = s.pan;
      muffled = s.muffled;
    } else if (def.outdoor && this.listener.interior) {
      level *= 0.4;
      muffled = true;
    }
    if (level < 0.002) return;

    const bufs = this.bank.get(eventId);
    if (!bufs.length) {
      this.bank.request(eventId);
      if (def.priority <= 2 && this.pending.length < 16) this.pending.push({ id: eventId, opts, at: this.clock });
      return;
    }
    const buf = this.pickVariation(def, bufs, opts.variation);
    if (!buf) return;

    // ---- voice management
    const ui = def.bus === 'ui';
    const same = this.voices.filter((v) => v.id === eventId && !v.stopped);
    if (same.length >= def.maxVoices) this.stopVoice(same.reduce((a, b) => (a.started < b.started ? a : b)), 0.03);
    const pool = this.voices.filter((v) => v.ui === ui && !v.stopped);
    if (pool.length >= (ui ? LIMITS.uiVoices : LIMITS.sfxVoices)) {
      let victim: Voice | null = null;
      let worst = Infinity;
      for (const v of pool) {
        const remain = Math.max(0, (v.ends - now) / Math.max(0.01, v.ends - v.started));
        const score = v.level * (0.25 + 0.75 * remain);
        if (score < worst) {
          worst = score;
          victim = v;
        }
      }
      if (!victim || worst >= level) return;
      this.stopVoice(victim, 0.03);
    }
    this.lastPlay.set(eventId, now);

    const src = c.createBufferSource();
    src.buffer = buf;
    const rate = 1 + (Math.random() * 2 - 1) * def.pitchJitter;
    src.playbackRate.value = rate;
    const gain = c.createGain();
    gain.gain.value = level;
    src.connect(gain);
    let tail: AudioNode = gain;
    if (pan && typeof c.createStereoPanner === 'function') {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      tail = p;
    }
    tail.connect(this.busInput(def.bus, muffled));
    const v: Voice = { id: eventId, def, src, gain, tail, started: now, ends: now + buf.duration / rate, level, ui, stopped: false };
    src.onended = () => this.releaseVoice(v);
    src.start(now);
    this.voices.push(v);
    if (def.duck) this.duck(def.duck.amount, def.duck.seconds);
  }

  private pickVariation(def: SfxDef, bufs: AudioBuffer[], requested?: number): AudioBuffer | null {
    if (requested !== undefined && Number.isFinite(requested)) {
      const v = ((Math.floor(requested) % def.variations) + def.variations) % def.variations;
      return this.bank.variation(def.id, v) ?? bufs[0] ?? null;
    }
    if (bufs.length === 1) return bufs[0];
    const last = this.lastVariation.get(def.id) ?? -1;
    let i = Math.floor(Math.random() * bufs.length);
    if (i === last) i = (i + 1 + Math.floor(Math.random() * (bufs.length - 1))) % bufs.length;
    this.lastVariation.set(def.id, i);
    return bufs[i];
  }

  private stopVoice(v: Voice, fade: number): void {
    if (v.stopped || !this.ctx) return;
    v.stopped = true;
    const now = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, fade / 3);
    try {
      v.src.stop(now + fade);
    } catch {
      /* ignore */
    }
  }

  private releaseVoice(v: Voice): void {
    v.stopped = true;
    try {
      v.src.disconnect();
      v.gain.disconnect();
      if (v.tail !== v.gain) v.tail.disconnect();
    } catch {
      /* ignore */
    }
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  private flushPending(id: string): void {
    if (!this.pending.length) return;
    const keep: typeof this.pending = [];
    const fire: typeof this.pending = [];
    for (const p of this.pending) (p.id === id ? fire : keep).push(p);
    this.pending = keep;
    for (const p of fire) if (this.clock - p.at <= LIMITS.pendingSec) this.play(p.id, p.opts);
  }

  // ------------------------------------------------------------------ loops
  setLoop(key: string, eventId: string, pos: { x: number; y: number; z: number }, gain: number): void {
    this.setLoopInternal(key, eventId, pos, gain);
    if (this.autoAmbience && AUTO_AMB_IDS.has(eventId)) {
      // the game drives ambience itself: turn the automatic beds off so they don't double up
      this.setAutoAmbience(false);
      if (isDev()) console.info('[audio] setLoop() used for an ambience bed: automatic ambience disabled');
    }
  }

  stopLoop(key: string): void {
    this.loopReqs.delete(key);
  }

  private setLoopInternal(key: string, eventId: string, pos: { x: number; y: number; z: number }, gain: number): void {
    const def = SFX_BY_ID[eventId];
    if (!def) {
      this.warnOnce(`unknown loop event "${eventId}" (ignored)`);
      return;
    }
    if (!def.loop) {
      this.warnOnce(`"${eventId}" is not a loop — use play()`);
      return;
    }
    if (!(gain > 0) || !pos) {
      this.loopReqs.delete(key);
      return;
    }
    let r = this.loopReqs.get(key);
    if (!r) {
      r = { key, eventId, pos: { x: 0, y: 0, z: 0 }, gain: 0, updated: 0 };
      this.loopReqs.set(key, r);
    }
    r.eventId = eventId;
    r.pos.x = num(pos.x, 0);
    r.pos.y = num(pos.y, 0);
    r.pos.z = num(pos.z, 0);
    r.gain = Math.min(4, gain);
    r.updated = this.clock;
    if (!this.requested.has(eventId)) {
      this.requested.add(eventId);
      this.bank.request(eventId);
    }
  }

  private updateLoops(): void {
    const c = this.ctx;
    if (!c || !this.g) return;
    const now = c.currentTime;
    for (const [k, r] of this.loopReqs) {
      const def = SFX_BY_ID[r.eventId];
      if (def.bus !== 'ambience' && !k.startsWith('__auto_') && this.clock - r.updated > LIMITS.staleLoopSec) this.loopReqs.delete(k);
    }
    this.cellSize = clusterCell(this.listener.zoom01, this.listener.interior, this.cellSize);
    const existing = new Set<string>();
    for (const [k, v] of this.loopVoices) if (!v.dying) existing.add(k);
    const muted = this.settings.muted || this.suspendedByApp;
    const targets = muted ? [] : computeLoopTargets(this.loopReqs.values(), this.listener, SFX_BY_ID, { maxLoopVoices: LIMITS.loopVoices, existing, cellSize: this.cellSize });
    const keep = new Set<string>();
    for (const t of targets) {
      const def = SFX_BY_ID[t.eventId];
      let v = this.loopVoices.get(t.voiceKey);
      if (!v) {
        v = this.startLoopVoice(t.voiceKey, def, t.muffled) ?? undefined;
        if (!v) continue;
      }
      keep.add(t.voiceKey);
      const level = t.gain * def.gain;
      if (v.dying) {
        v.dying = false;
        v.level = -1;
      }
      if (v.muffled !== t.muffled) {
        v.out.disconnect();
        v.out.connect(this.busInput(def.bus, t.muffled));
        v.muffled = t.muffled;
      }
      if (Math.abs(level - v.level) > 0.004) {
        v.gain.gain.setTargetAtTime(level, now, def.bus === 'ambience' ? 0.5 : 0.12);
        v.level = level;
      }
      if (v.pan && Math.abs(t.pan - v.panValue) > 0.01) {
        v.pan.pan.setTargetAtTime(t.pan, now, 0.1);
        v.panValue = t.pan;
      }
    }
    for (const [k, v] of this.loopVoices) {
      if (!keep.has(k) && !v.dying) {
        v.dying = true;
        v.dieAt = now + 1.2;
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, v.def.bus === 'ambience' ? 0.4 : 0.15);
      } else if (v.dying && now > v.dieAt) {
        try {
          v.src.stop();
          v.src.disconnect();
          v.gain.disconnect();
          v.out.disconnect();
        } catch {
          /* ignore */
        }
        this.loopVoices.delete(k);
      }
    }
  }

  private startLoopVoice(key: string, def: SfxDef, muffled: boolean): LoopVoice | null {
    const c = this.ctx;
    if (!c) return null;
    const bufs = this.bank.get(def.id);
    if (!bufs.length) {
      this.bank.request(def.id);
      return null;
    }
    const h = hashString(key);
    const buf = bufs[h % bufs.length];
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 1 + (((h >>> 8) & 255) / 255 - 0.5) * 2 * def.pitchJitter;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    let out: AudioNode = gain;
    let pan: StereoPannerNode | null = null;
    if (def.spatial !== false && typeof c.createStereoPanner === 'function') {
      pan = c.createStereoPanner();
      gain.connect(pan);
      out = pan;
    }
    out.connect(this.busInput(def.bus, muffled));
    // random start offset so identical loops never phase-lock
    src.start(c.currentTime, (((h >>> 16) & 1023) / 1024) * buf.duration);
    const v: LoopVoice = { key, def, src, gain, pan, out, muffled, level: -1, panValue: 0, dying: false, dieAt: 0 };
    this.loopVoices.set(key, v);
    return v;
  }

  private updateAutoAmbience(dt: number): void {
    if (!this.autoAmbience) return;
    const l = this.listener;
    const k = 1 - Math.exp(-dt / 1.5);
    const interior = l.interior ? 1 : 0;
    const night = smoothstep(0.3, 0.75, l.night);
    const outside = (1 - interior) * lerp(0.75, 1, clamp01(l.zoom01));
    const t = { day: outside * (1 - night), night: outside * night, interior: interior * 0.9 };
    for (const name of ['day', 'night', 'interior'] as const) {
      this.amb[name] += (t[name] - this.amb[name]) * k;
      const v = this.amb[name] < 0.01 ? 0 : this.amb[name];
      this.setLoopInternal(`__auto_${name}`, AUTO_AMB[name], l, v);
    }
  }

  // ------------------------------------------------------------------ frame update
  update(dt: number, l: ListenerContext): void {
    const step = num(dt, 0);
    const d = step < 0 ? 0 : step > 0.5 ? 0.5 : step;
    this.clock += d;
    const L = this.listener;
    if (l) {
      L.x = num(l.x, L.x);
      L.y = num(l.y, L.y);
      L.z = num(l.z, L.z);
      L.zoom01 = clamp01(num(l.zoom01, L.zoom01));
      L.night = clamp01(num(l.night, L.night));
      L.activity = clamp01(num(l.activity, L.activity));
      L.interior = !!l.interior;
      L.district = l.district ?? L.district;
      L.yaw = num(l.yaw, 0);
    }
    if (this.firstUpdate < 0) this.firstUpdate = this.clock;
    if (this.clock - this.firstUpdate > 1) this.bank.start();
    if (!this.ctx || !this._unlocked) return;
    this.music?.update(d, L);
    this.updateAutoAmbience(d);
    this.loopTimer += d;
    if (this.loopTimer >= 0.1) {
      this.loopTimer = 0;
      this.updateLoops();
    }
    if (this.pending.length) this.pending = this.pending.filter((p) => this.clock - p.at <= LIMITS.pendingSec);
    if (this.duckAmount > 0 && this.ctx.currentTime > this.duckUntil) this.duckAmount = 0;
  }

  // ------------------------------------------------------------------ mix
  duck(amount: number, seconds: number): void {
    const c = this.ctx;
    if (!c || !this.g) return;
    const a = clamp01(num(amount, 0));
    const s = Math.max(0.05, num(seconds, 1));
    const now = c.currentTime;
    this.duckAmount = Math.max(a, now < this.duckUntil ? this.duckAmount : 0);
    this.duckUntil = Math.max(this.duckUntil, now + s);
    const p = this.g.duck.gain;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(1 - this.duckAmount, now, 0.06);
    p.setTargetAtTime(1, this.duckUntil, 0.35);
  }

  private busInput(bus: MixerBus, muffled: boolean): AudioNode {
    const g = this.g!;
    return muffled ? g.muffled[bus] : g.bus[bus];
  }

  private applyGains(): void {
    const c = this.ctx;
    const g = this.g;
    const s = this.settings;
    this.music?.setWanted(!s.muted && s.music > 0.001 && s.master > 0.001);
    if (!c || !g) return;
    const now = c.currentTime;
    const curve = (v: number): number => v * v; // perceptual slider curve
    g.master.gain.setTargetAtTime(s.muted ? 0 : curve(s.master), now, 0.03);
    for (const b of ['music', 'sfx', 'ambience', 'ui'] as MixerBus[]) g.bus[b].gain.setTargetAtTime(curve(s[b]) * BUS_TRIM[b], now, 0.03);
  }

  private createContext(): void {
    const W = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const C = W.AudioContext ?? W.webkitAudioContext;
    if (!C) {
      this.broken = true;
      return;
    }
    try {
      this.ctx = new C({ latencyHint: 'interactive' });
    } catch {
      try {
        this.ctx = new C();
      } catch {
        this.broken = true;
        return;
      }
    }
    try {
      // iOS 16.4+: respect the ring/silent switch and mix with the user's own audio
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'ambient';
    } catch {
      /* ignore */
    }
    this.buildGraph(this.ctx);
  }

  private buildGraph(c: AudioContext): void {
    const master = c.createGain();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 40;
    hp.Q.value = 0.6;
    // gentle glue compressor, then a brick-wall-ish limiter to protect small speakers
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -2.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    master.connect(hp).connect(comp).connect(limiter).connect(c.destination);
    const bus = {} as Record<MixerBus, GainNode>;
    const muffled = {} as Record<MixerBus, BiquadFilterNode>;
    for (const b of ['music', 'sfx', 'ambience', 'ui'] as MixerBus[]) {
      bus[b] = c.createGain();
      bus[b].connect(master);
      muffled[b] = c.createBiquadFilter();
      muffled[b].type = 'lowpass';
      muffled[b].frequency.value = 950;
      muffled[b].Q.value = 0.5;
      muffled[b].connect(bus[b]);
    }
    const duck = c.createGain();
    duck.connect(bus.music);
    this.g = { master, bus, muffled, duck, comp, limiter };
    this.applyGains();
  }

  private onUnlocked(): void {
    const c = this.ctx;
    if (!c || !this.g) return;
    this.bank.start();
    try {
      this.music = new MusicDirector(c, this.g.duck, this.baseUrl);
      if (this.forcedTheme) this.music.force(this.forcedTheme);
      this.music.start();
    } catch (e) {
      this.warnOnce(`music disabled: ${String(e)}`);
      this.music = null;
    }
    this.applyGains();
  }

  private warnOnce(msg: string): void {
    if (this.warned.has(msg)) return;
    this.warned.add(msg);
    console.warn(`[audio] ${msg}`);
  }

  debugInfo(): AudioDebugInfo {
    return {
      available: !this.broken,
      unlocked: this._unlocked,
      state: this.ctx?.state ?? 'none',
      sampleRate: this.ctx?.sampleRate ?? 0,
      sfxVoices: this.voices.filter((v) => !v.ui && !v.stopped).length,
      uiVoices: this.voices.filter((v) => v.ui && !v.stopped).length,
      loopVoices: [...this.loopVoices.values()].filter((v) => !v.dying).map((v) => ({ key: v.key, gain: Number(v.level.toFixed(3)), pan: Number(v.panValue.toFixed(2)) })),
      loopRequests: this.loopReqs.size,
      rendered: this.bank.renderedJobs,
      totalVariations: this.bank.totalJobs,
      bankMB: Number((this.bank.bytes / 1048576).toFixed(1)),
      music: this.music?.debug() ?? null,
      duck: this.g ? Number(this.g.duck.gain.value.toFixed(3)) : 1,
      autoAmbience: this.autoAmbience,
      cellSize: this.cellSize,
    };
  }
}

/** The game's audio singleton. */
export const audio = new AudioManager();
