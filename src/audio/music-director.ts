/**
 * MusicDirector: adaptive, stem-based music.
 *
 * - Themes and stems come from music-manifest.ts (pre-rendered, seamless loops).
 * - Theme choice from ListenerContext: night (with hysteresis) -> 'evening'; city district or a
 *   wide city view -> 'city' (when available); everything else -> 'workshop'. A new choice must
 *   be stable for 2.5 s, then the themes crossfade (~4 s) starting on the next bar line of the
 *   current theme; the new theme enters at a section start.
 * - Stem mix: base always; lead slightly softer in close/interior views (more intimate), full in
 *   wide views; rhythm joins (bar-aligned) only when production is healthy (smoothed activity
 *   with hysteresis). Levels are bounded — the arrangement never keeps escalating.
 * - Loading is lazy and in the background after unlock: base stem first, then lead, rhythm.
 *   Ogg Vorbis is preferred; AAC (.m4a) is used where Vorbis can't be played/decoded (Safari).
 *   Any failure leaves music silent; the game is unaffected.
 * - Memory: decoded PCM is the big cost (~64-80 MB per 3-stem theme at 32 kHz), so only the
 *   playing theme (and one fading out) stay decoded; others keep just their compressed bytes.
 */
import type { ListenerContext } from './types';
import { MUSIC_THEMES, MusicTheme, MusicStemInfo } from './music-manifest';
import { createOffline } from './synth/render';
import { clamp01, smoothstep, lerp } from './spatial';

type Fmt = 'ogg' | 'm4a';

interface StemState {
  info: MusicStemInfo;
  bytes?: ArrayBuffer;
  bytesFmt?: Fmt;
  buffer?: AudioBuffer;
  loopStart: number;
  loopEnd: number;
  failed?: boolean;
}

interface ThemeState {
  def: MusicTheme;
  stems: StemState[];
  status: 'idle' | 'loading' | 'ready' | 'failed';
  loading?: Promise<void>;
  lastUsed: number;
  /** loop position (s) where it was left, to resume at the next section */
  lastPos: number;
}

interface PlayingStem {
  id: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
  target: number;
}

interface Playing {
  theme: ThemeState;
  out: GainNode;
  stems: Map<string, PlayingStem>;
  /** context time at which loop position 0 is (virtually) aligned */
  t0: number;
  loopDur: number;
  barDur: number;
  fadingOut: boolean;
}

export interface MusicDebug {
  state: string;
  playing: string | null;
  target: string | null;
  candidate: string | null;
  positionSec: number;
  stems: Record<string, number>;
  themes: Record<string, string>;
  formats: Fmt[];
  activity: number;
  rhythmOn: boolean;
}

const CROSSFADE_IN_TAU = 0.9;
const CROSSFADE_OUT_TAU = 1.1;
const FIRST_FADE_TAU = 0.8;
const SWITCH_DEBOUNCE = 2.5;
const EVICT_AFTER = 25;

const DISTRICT_THEME: Record<ListenerContext['district'], string> = {
  workshop: 'workshop',
  industrial: 'workshop',
  food: 'workshop',
  retail: 'workshop',
  logistics: 'workshop',
  hightech: 'workshop',
  city: 'city',
};

function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

export class MusicDirector {
  private themes = new Map<string, ThemeState>();
  private playing: Playing | null = null;
  private outgoing: Playing[] = [];
  private started = false;
  private wanted = true;
  private formats: Fmt[] = ['ogg', 'm4a'];
  private candidate: string | null = null;
  private candidateSince = 0;
  private target: string | null = null;
  private forced: string | null = null;
  private isNight = false;
  private act = 0;
  private zoom = 0.5;
  private interiorAmt = 0;
  private rhythmOn = false;
  private lastStemUpdate = 0;
  private decodeRate: number;
  private prefetching = false;
  private warned = new Set<string>();
  private clock = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly baseUrl: string,
    manifest: MusicTheme[] = MUSIC_THEMES,
  ) {
    for (const def of manifest) {
      this.themes.set(def.id, { def, stems: def.stems.map((info) => ({ info, loopStart: 0, loopEnd: 0 })), status: 'idle', lastUsed: 0, lastPos: 0 });
    }
    this.formats = MusicDirector.pickFormats();
    const mem = (globalThis.navigator as Navigator & { deviceMemory?: number } | undefined)?.deviceMemory;
    this.decodeRate = mem !== undefined && mem <= 2 ? 22050 : (manifest[0]?.sampleRate ?? 32000);
  }

  static pickFormats(): Fmt[] {
    try {
      const a = typeof document !== 'undefined' ? document.createElement('audio') : null;
      const ogg = a?.canPlayType('audio/ogg; codecs="vorbis"') ?? '';
      return ogg === 'probably' || ogg === 'maybe' ? ['ogg', 'm4a'] : ['m4a', 'ogg'];
    } catch {
      return ['m4a', 'ogg'];
    }
  }

  has(id: string): boolean {
    const t = this.themes.get(id);
    return !!t && t.status !== 'failed';
  }

  /** Begin (after unlock). Music never blocks: everything happens in the background. */
  start(): void {
    this.started = true;
  }

  /** false while music volume is 0/muted: nothing new is fetched or decoded. */
  setWanted(on: boolean): void {
    this.wanted = on;
  }

  /** Force a theme (sandbox, cutscenes); null returns to context-driven selection. */
  force(id: string | null): void {
    this.forced = id && this.themes.has(id) ? id : null;
    this.candidateSince = -1e9;
  }

  update(dt: number, l: ListenerContext): void {
    this.clock += dt;
    const k = (tau: number): number => 1 - Math.exp(-Math.max(0, dt) / tau);
    this.act += (clamp01(l.activity) - this.act) * k(6);
    this.zoom += (clamp01(l.zoom01) - this.zoom) * k(2);
    this.interiorAmt += ((l.interior ? 1 : 0) - this.interiorAmt) * k(1.5);
    if (!this.started || !this.wanted) return;

    // ---- theme selection with debounce
    const want = this.desired(l);
    if (want !== this.candidate) {
      this.candidate = want;
      this.candidateSince = this.clock;
    }
    if (!this.target || (want !== this.target && this.clock - this.candidateSince >= SWITCH_DEBOUNCE) || this.forced === want) this.target = want;

    const target = this.themes.get(this.target ?? '');
    const now = this.ctx.currentTime;
    if (target) {
      const ready = target.stems.find((s) => s.info.id === 'base')?.buffer;
      const incomplete = target.stems.some((s) => !s.buffer && !s.failed);
      if (incomplete && !target.loading && target.status !== 'failed') void this.load(target);
      if (ready && this.playing?.theme !== target) this.switchTo(target, now);
    }
    // a failed target falls back to any playable theme (or silence)
    if (target?.status === 'failed' && !this.playing) {
      const alt = [...this.themes.values()].find((t) => t.status === 'ready');
      if (alt) this.switchTo(alt, now);
    }

    if (this.playing) {
      this.playing.theme.lastUsed = this.clock;
      this.joinLateStems(this.playing, now);
      if (this.clock - this.lastStemUpdate > 0.25) {
        this.lastStemUpdate = this.clock;
        this.updateStemMix(this.playing, now);
      }
    }
    this.cleanupOutgoing(now);
    this.evict();
    if (target?.status === 'ready' && !this.prefetching) void this.prefetchOthers();
  }

  // ------------------------------------------------------------------ selection
  private desired(l: ListenerContext): string {
    if (this.forced) return this.forced;
    if (this.isNight) {
      if (l.night < 0.4) this.isNight = false;
    } else if (l.night > 0.62) this.isNight = true;
    if (this.isNight && this.has('evening')) return 'evening';
    const wantsCity = l.district === 'city' || (!l.interior && l.zoom01 > 0.82);
    if (wantsCity && this.has('city')) return 'city';
    const d = DISTRICT_THEME[l.district] ?? 'workshop';
    return this.has(d) ? d : 'workshop';
  }

  // ------------------------------------------------------------------ playback
  private loopDur(t: ThemeState): number {
    return t.def.loopSamples / t.def.sampleRate;
  }

  private barDur(t: ThemeState): number {
    return (60 / t.def.bpm) * t.def.beatsPerBar;
  }

  private posAt(p: Playing, time: number): number {
    const x = (time - p.t0) % p.loopDur;
    return x < 0 ? x + p.loopDur : x;
  }

  private nextBarTime(p: Playing, after: number): number {
    const pos = this.posAt(p, after);
    const next = Math.ceil(pos / p.barDur - 1e-6) * p.barDur;
    return after + (next - pos);
  }

  /** Section start at/after the position where this theme was left (or the top). */
  private entryOffset(t: ThemeState): number {
    const bd = this.barDur(t);
    const lastBar = t.lastPos / bd;
    const starts = t.def.sections.map((s) => s.bar).sort((a, b) => a - b);
    const next = starts.find((b) => b >= lastBar - 0.01);
    const bar = t.lastPos > 0 ? (next ?? starts[0] ?? 0) : 0;
    return (bar * bd) % this.loopDur(t);
  }

  private switchTo(next: ThemeState, now: number): void {
    const cur = this.playing;
    let when = now + 0.08;
    if (cur && !cur.fadingOut) {
      when = this.nextBarTime(cur, now + 0.12);
      cur.theme.lastPos = this.posAt(cur, when);
      this.fadeOut(cur, when);
    }
    const offset = this.entryOffset(next);
    this.playing = this.startTheme(next, when, offset, cur ? CROSSFADE_IN_TAU : FIRST_FADE_TAU);
  }

  private startTheme(t: ThemeState, when: number, offset: number, tau: number): Playing {
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0, when);
    out.gain.setTargetAtTime(1, when, tau);
    out.connect(this.out);
    const p: Playing = { theme: t, out, stems: new Map(), t0: when - offset, loopDur: this.loopDur(t), barDur: this.barDur(t), fadingOut: false };
    for (const st of t.stems) if (st.buffer) this.startStem(p, st, when);
    this.updateStemMix(p, when, true);
    return p;
  }

  private startStem(p: Playing, st: StemState, when: number): void {
    if (!st.buffer || p.stems.has(st.info.id)) return;
    const src = this.ctx.createBufferSource();
    src.buffer = st.buffer;
    src.loop = true;
    src.loopStart = st.loopStart;
    src.loopEnd = st.loopEnd;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(p.out);
    const pos = this.posAt(p, when);
    try {
      src.start(when, st.loopStart + Math.min(pos, st.loopEnd - st.loopStart - 0.001));
    } catch {
      return;
    }
    p.stems.set(st.info.id, { id: st.info.id, src, gain, target: -1 });
  }

  private joinLateStems(p: Playing, now: number): void {
    for (const st of p.theme.stems) if (st.buffer && !p.stems.has(st.info.id)) this.startStem(p, st, now + 0.06);
  }

  private stemTargets(): Record<string, number> {
    const z = smoothstep(0.1, 0.65, this.zoom);
    const intimacy = this.interiorAmt;
    // rhythm joins with healthy production (hysteresis), never more than "full"
    if (this.rhythmOn) {
      if (this.act < 0.22) this.rhythmOn = false;
    } else if (this.act > 0.38) this.rhythmOn = true;
    return {
      base: 1,
      lead: lerp(0.72, 1, z) * (1 - 0.15 * intimacy),
      rhythm: this.rhythmOn ? lerp(0.65, 1, smoothstep(0.38, 0.8, this.act)) * lerp(0.8, 1, z) * (1 - 0.25 * intimacy) : 0,
    };
  }

  private updateStemMix(p: Playing, now: number, immediate = false): void {
    const targets = this.stemTargets();
    for (const s of p.stems.values()) {
      const target = targets[s.id] ?? 1;
      if (Math.abs(target - s.target) < 0.02) continue;
      const wasOff = s.target <= 0.001;
      s.target = target;
      if (immediate) {
        s.gain.gain.setValueAtTime(target, now);
      } else if (s.id === 'rhythm' && (wasOff || target === 0)) {
        // layer entrances/exits land on the bar line and take one bar
        const t = this.nextBarTime(p, now + 0.05);
        s.gain.gain.cancelScheduledValues(t);
        s.gain.gain.setTargetAtTime(target, t, p.barDur / 3);
      } else {
        s.gain.gain.cancelScheduledValues(now);
        s.gain.gain.setTargetAtTime(target, now, 1.2);
      }
    }
  }

  private fadeOut(p: Playing, when: number): void {
    p.fadingOut = true;
    p.out.gain.cancelScheduledValues(when);
    p.out.gain.setTargetAtTime(0, when, CROSSFADE_OUT_TAU);
    const stopAt = when + CROSSFADE_OUT_TAU * 6;
    for (const s of p.stems.values()) {
      try {
        s.src.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
    (p as Playing & { stopAt?: number }).stopAt = stopAt;
    this.outgoing.push(p);
  }

  private cleanupOutgoing(now: number): void {
    this.outgoing = this.outgoing.filter((p) => {
      const stopAt = (p as Playing & { stopAt?: number }).stopAt ?? 0;
      if (now < stopAt + 0.2) return true;
      try {
        p.out.disconnect();
      } catch {
        /* ignore */
      }
      return false;
    });
  }

  /** Drop decoded PCM of themes that are neither playing, fading nor targeted (keeps bytes). */
  private evict(): void {
    for (const t of this.themes.values()) {
      if (t === this.playing?.theme || t.def.id === this.target || this.outgoing.some((p) => p.theme === t)) continue;
      if (this.clock - t.lastUsed < EVICT_AFTER) continue;
      if (t.stems.some((s) => s.buffer)) {
        for (const s of t.stems) s.buffer = undefined;
        if (t.status === 'ready') t.status = 'idle';
      }
    }
  }

  // ------------------------------------------------------------------ loading
  private url(st: StemState, fmt: Fmt): string {
    return this.baseUrl + st.info.files[fmt];
  }

  private async fetchBytes(url: string): Promise<ArrayBuffer> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.arrayBuffer();
  }

  private decodeCtx(): BaseAudioContext {
    return createOffline(2, 1, this.decodeRate) ?? this.ctx;
  }

  private load(t: ThemeState): Promise<void> {
    if (t.loading) return t.loading;
    t.status = 'loading';
    t.lastUsed = this.clock;
    const order = ['base', 'lead', 'rhythm'];
    const stems = [...t.stems].sort((a, b) => (order.indexOf(a.info.id) + 99) % 99 - (order.indexOf(b.info.id) + 99) % 99);
    t.loading = (async () => {
      for (const st of stems) {
        await this.loadStem(t, st);
        if (st.info.id === 'base' && !st.buffer) {
          t.status = 'failed';
          this.warnOnce(`music theme ${t.def.id} unavailable (base stem failed to load/decode); continuing without it`);
          return;
        }
      }
      t.status = 'ready';
    })()
      .catch(() => {
        t.status = 'failed';
      })
      .finally(() => {
        t.loading = undefined;
      });
    return t.loading;
  }

  private async loadStem(t: ThemeState, st: StemState): Promise<void> {
    if (st.buffer || st.failed) return;
    const fmts = st.bytesFmt ? [st.bytesFmt, ...this.formats.filter((f) => f !== st.bytesFmt)] : this.formats;
    for (const fmt of fmts) {
      try {
        const bytes = st.bytesFmt === fmt && st.bytes ? st.bytes : await this.fetchBytes(this.url(st, fmt));
        const buf = await decode(this.decodeCtx(), bytes.slice(0));
        st.bytes = bytes;
        st.bytesFmt = fmt;
        this.setLoopPoints(t, st, buf, fmt);
        st.buffer = buf;
        // remember a working format first for the remaining stems
        if (this.formats[0] !== fmt) this.formats = [fmt, ...this.formats.filter((f) => f !== fmt)];
        return;
      } catch (e) {
        this.warnOnce(`music ${t.def.id}/${st.info.id} (${fmt}) failed: ${String(e)}`);
      }
    }
    st.failed = true;
  }

  /**
   * Loop points in the decoded buffer. Decoders that ignore AAC priming (1024 samples for
   * ffmpeg's encoder) yield a longer buffer with leading padding; we skip it so every stem of a
   * theme loops on the exact same musical length.
   */
  private setLoopPoints(t: ThemeState, st: StemState, buf: AudioBuffer, fmt: Fmt): void {
    const ratio = buf.sampleRate / t.def.sampleRate;
    const expected = t.def.loopSamples * ratio;
    const extra = buf.length - expected;
    let lead = 0;
    if (fmt === 'm4a' && extra > 512 * ratio) lead = Math.min(extra, 1024 * ratio);
    st.loopStart = lead / buf.sampleRate;
    st.loopEnd = Math.min(buf.duration, (lead + expected) / buf.sampleRate);
  }

  private async prefetchOthers(): Promise<void> {
    this.prefetching = true;
    for (const t of this.themes.values()) {
      if (t.status === 'failed') continue;
      for (const st of t.stems) {
        if (st.bytes || st.buffer) continue;
        try {
          st.bytes = await this.fetchBytes(this.url(st, this.formats[0]));
          st.bytesFmt = this.formats[0];
        } catch {
          /* decode-time load will retry/fallback */
        }
      }
    }
  }

  private warnOnce(msg: string): void {
    if (this.warned.has(msg)) return;
    this.warned.add(msg);
    console.warn(`[audio] ${msg}`);
  }

  debug(): MusicDebug {
    const p = this.playing;
    const stems: Record<string, number> = {};
    if (p) for (const s of p.stems.values()) stems[s.id] = Number(s.gain.gain.value.toFixed(3));
    const themes: Record<string, string> = {};
    for (const [id, t] of this.themes) themes[id] = `${t.status}${t.stems.some((s) => s.buffer) ? '+pcm' : ''}`;
    return {
      state: !this.started ? 'not-started' : !this.wanted ? 'disabled' : p ? 'playing' : 'loading',
      playing: p?.theme.def.id ?? null,
      target: this.target,
      candidate: this.candidate,
      positionSec: p ? this.posAt(p, this.ctx.currentTime) : 0,
      stems,
      themes,
      formats: this.formats,
      activity: this.act,
      rhythmOn: this.rhythmOn,
    };
  }
}
