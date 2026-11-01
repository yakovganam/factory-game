/**
 * Offline rendering helpers shared by the runtime SFX bank, the music renderer and the QA tools:
 * context creation (with webkit prefix), level analysis, normalization, seamless loop wrapping
 * and WAV encoding.
 */
import { dbToGain, gainToDb } from './kit';

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export function offlineCtor(): OfflineCtor | null {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

export function createOffline(channels: number, length: number, sampleRate: number): OfflineAudioContext | null {
  const C = offlineCtor();
  if (!C) return null;
  try {
    return new C(channels, Math.max(1, Math.floor(length)), sampleRate);
  } catch {
    return null;
  }
}

/** startRendering() with the legacy (callback-based) webkit fallback. */
export function startRendering(ctx: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let done = false;
    const legacy = ctx as OfflineAudioContext & { oncomplete: ((e: OfflineAudioCompletionEvent) => void) | null };
    legacy.oncomplete = (e: OfflineAudioCompletionEvent) => {
      if (!done) {
        done = true;
        resolve(e.renderedBuffer);
      }
    };
    try {
      const p = ctx.startRendering() as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') {
        p.then(
          (b) => {
            if (!done) {
              done = true;
              resolve(b);
            }
          },
          (e) => {
            if (!done) {
              done = true;
              reject(e);
            }
          },
        );
      }
    } catch (e) {
      reject(e);
    }
  });
}

export function channelsOf(buf: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) out.push(buf.getChannelData(c));
  return out;
}

export interface BufferStats {
  durationSec: number;
  channels: number;
  peak: number;
  peakDb: number;
  rmsDb: number;
  /** loudest 50 ms window RMS (dBFS) — our "short-term" level used for SFX normalization */
  shortRmsDb: number;
  dc: number;
  /** fraction of 10 ms windows below -60 dBFS */
  silentFraction: number;
}

export function analyze(chs: Float32Array[], sr: number): BufferStats {
  const n = chs[0]?.length ?? 0;
  let peak = 0;
  let sumSq = 0;
  let dc = 0;
  for (const d of chs) {
    for (let i = 0; i < n; i++) {
      const v = d[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sumSq += v * v;
      dc += v;
    }
  }
  const total = Math.max(1, n * chs.length);
  const win = Math.max(1, Math.floor(sr * 0.05));
  let maxWin = 0;
  for (let s = 0; s < n; s += Math.floor(win / 2)) {
    let acc = 0;
    const e = Math.min(n, s + win);
    for (const d of chs) for (let i = s; i < e; i++) acc += d[i] * d[i];
    const r = acc / Math.max(1, (e - s) * chs.length);
    if (r > maxWin) maxWin = r;
  }
  const w10 = Math.max(1, Math.floor(sr * 0.01));
  let silent = 0;
  let wins = 0;
  for (let s = 0; s + w10 <= n; s += w10) {
    let acc = 0;
    for (const d of chs) for (let i = s; i < s + w10; i++) acc += d[i] * d[i];
    if (acc / (w10 * chs.length) < 1e-6) silent++;
    wins++;
  }
  return {
    durationSec: n / sr,
    channels: chs.length,
    peak,
    peakDb: gainToDb(peak),
    rmsDb: gainToDb(Math.sqrt(sumSq / total)),
    shortRmsDb: gainToDb(Math.sqrt(maxWin)),
    dc: dc / total,
    silentFraction: wins ? silent / wins : 1,
  };
}

/**
 * Loudness weighting used for SFX normalization: ITU-R BS.1770 K-weighting (high shelf +4 dB
 * above ~1.7 kHz, 38 Hz high-pass) plus an extra 2nd-order 100 Hz high-pass that models small
 * phone speakers, so bass-only sounds are not judged "loud" when they would be inaudible there.
 */
export function weighted(chs: Float32Array[], sr: number, smallSpeaker = true): Float32Array[] {
  const biquad = (x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array => {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    return y;
  };
  return chs.map((d) => {
    // stage 1: high shelf
    let K = Math.tan((Math.PI * 1681.974450955533) / sr);
    const Vh = Math.pow(10, 3.999843853973347 / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    let Q = 0.7071752369554196;
    let a0 = 1 + K / Q + K * K;
    let y = biquad(d, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
    // stage 2: RLB high-pass (38 Hz)
    K = Math.tan((Math.PI * 38.13547087602444) / sr);
    Q = 0.5003270373238773;
    a0 = 1 + K / Q + K * K;
    y = biquad(y, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
    if (smallSpeaker) {
      // RBJ 2nd-order high-pass at 100 Hz, Q 0.707
      const w = (2 * Math.PI * 100) / sr;
      const al = Math.sin(w) / (2 * 0.707);
      const c = Math.cos(w);
      const n0 = 1 + al;
      y = biquad(y, (1 + c) / 2 / n0, -(1 + c) / n0, (1 + c) / 2 / n0, (-2 * c) / n0, (1 - al) / n0);
    }
    return y;
  });
}

/** Max loudness over sliding windows of `win` seconds on weighted signal, LUFS-like (-0.691 + 10log10 ms). */
export function maxWindowLoudness(chs: Float32Array[], sr: number, win = 0.1): number {
  const w = weighted(chs, sr);
  const n = w[0].length;
  const L = Math.max(1, Math.min(n, Math.floor(sr * win)));
  const hop = Math.max(1, Math.floor(L / 4));
  let best = 0;
  for (let s = 0; s === 0 || s + L <= n; s += hop) {
    let acc = 0;
    const e = Math.min(n, s + L);
    for (const d of w) for (let i = s; i < e; i++) acc += d[i] * d[i];
    best = Math.max(best, acc / L);
    if (e >= n) break;
  }
  return -0.691 + 10 * Math.log10(Math.max(1e-12, best));
}

export function scale(chs: Float32Array[], g: number): void {
  for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= g;
}

/**
 * Normalize so the loudest 50 ms window sits at `targetShortDb`, but never let the peak exceed
 * `maxPeakDb`. Returns the applied gain.
 */
export function normalize(chs: Float32Array[], sr: number, targetShortDb: number, maxPeakDb = -1, mode: 'rms' | 'loudness' = 'rms'): number {
  const st = analyze(chs, sr);
  if (st.peak <= 1e-7) return 1;
  const level = mode === 'loudness' ? maxWindowLoudness(chs, sr) : st.shortRmsDb;
  const g = Math.min(dbToGain(targetShortDb - level), dbToGain(maxPeakDb - st.peakDb));
  scale(chs, g);
  return g;
}

/**
 * Seamless loop wrap. Input length must be >= loopLen + xfade samples. The material past the
 * loop end (which continues the signal naturally) is crossfaded into the loop start, so
 * sample[loopLen-1] -> sample[0] is continuous. Uses a fade law halfway between equal-gain and
 * equal-power (+-1.5 dB worst case for correlated/uncorrelated content).
 */
export function wrapLoop(chs: Float32Array[], loopLen: number, xfade: number): Float32Array[] {
  return chs.map((d) => {
    const out = new Float32Array(loopLen);
    out.set(d.subarray(0, loopLen));
    const x = Math.min(xfade, d.length - loopLen);
    for (let i = 0; i < x; i++) {
      const p = i / x;
      const gin = 0.5 * (p + Math.sin((p * Math.PI) / 2));
      const gout = 0.5 * (1 - p + Math.cos((p * Math.PI) / 2));
      out[i] = d[i] * gin + d[loopLen + i] * gout;
    }
    return out;
  });
}

/** Music-style loop: add everything rendered past loopLen (reverb/release tail) onto the start. */
export function foldTail(chs: Float32Array[], loopLen: number): Float32Array[] {
  return chs.map((d) => {
    const out = new Float32Array(loopLen);
    out.set(d.subarray(0, loopLen));
    for (let i = loopLen; i < d.length; i++) out[(i - loopLen) % loopLen] += d[i];
    return out;
  });
}

/** Trim trailing near-silence (keeps memory low) and apply a short fade-out. */
export function trimTail(chs: Float32Array[], sr: number, floorDb = -70, fadeMs = 6): Float32Array[] {
  const floor = dbToGain(floorDb);
  const n = chs[0].length;
  let last = 0;
  for (const d of chs) {
    for (let i = n - 1; i > last; i--) {
      if (Math.abs(d[i]) > floor) {
        last = i;
        break;
      }
    }
  }
  const len = Math.min(n, last + Math.floor(sr * 0.01) + 1);
  const fade = Math.min(len, Math.floor((sr * fadeMs) / 1000));
  return chs.map((d) => {
    const out = d.slice(0, len);
    for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
    return out;
  });
}

/** Tiny fade-in so one-shots never start with a DC step. */
export function fadeIn(chs: Float32Array[], sr: number, ms = 1): void {
  const n = Math.max(1, Math.floor((sr * ms) / 1000));
  for (const d of chs) for (let i = 0; i < n && i < d.length; i++) d[i] *= i / n;
}

export function toAudioBuffer(ctx: BaseAudioContext, chs: Float32Array[], sr: number): AudioBuffer {
  const b = ctx.createBuffer(chs.length, chs[0].length, sr);
  chs.forEach((d, c) => {
    if (typeof b.copyToChannel === 'function') b.copyToChannel(d as Float32Array<ArrayBuffer>, c);
    else b.getChannelData(c).set(d);
  });
  return b;
}

/** 16-bit PCM WAV with TPDF dither. */
export function encodeWav16(chs: Float32Array[], sr: number, seed = 1): ArrayBuffer {
  const n = chs[0].length;
  const nc = chs.length;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * nc * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * nc * 2, true);
  let s = seed >>> 0 || 1;
  const rnd = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const x = chs[c][i] * 32767 + (rnd() - rnd());
      const q = Math.max(-32768, Math.min(32767, Math.round(x)));
      v.setInt16(o, q, true);
      o += 2;
    }
  }
  return buf;
}
