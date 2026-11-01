// In-page analysis helpers for the audio QA tools ("listen by proxy"): spectrum bands, centroid,
// loop seam continuity, and base64 transfer of binary data back to Node.

export interface Spectral {
  centroidHz: number;
  /** share of energy in bands (sums to ~1) */
  bands: { sub: number; low: number; mid: number; high: number; air: number };
  /** 85% roll-off frequency */
  rolloffHz: number;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export function spectral(chs: Float32Array[], sr: number, maxFrames = 400): Spectral {
  const N = 2048;
  const n = chs[0].length;
  const power = new Float64Array(N / 2);
  const hop = Math.max(N / 2, Math.floor((n - N) / maxFrames));
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let s = 0; s + N <= Math.max(n, N); s += hop) {
    for (let i = 0; i < N; i++) {
      let v = 0;
      for (const d of chs) v += d[s + i] ?? 0;
      re[i] = (v / chs.length) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    if (n < N) break;
  }
  let tot = 0;
  let cen = 0;
  const b = { sub: 0, low: 0, mid: 0, high: 0, air: 0 };
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    const p = power[k];
    tot += p;
    cen += p * f;
    if (f < 80) b.sub += p;
    else if (f < 300) b.low += p;
    else if (f < 3000) b.mid += p;
    else if (f < 8000) b.high += p;
    else b.air += p;
  }
  let acc = 0;
  let roll = 0;
  for (let k = 1; k < N / 2; k++) {
    acc += power[k];
    if (acc >= tot * 0.85) {
      roll = (k * sr) / N;
      break;
    }
  }
  const norm = (x: number): number => (tot > 0 ? x / tot : 0);
  return {
    centroidHz: tot > 0 ? cen / tot : 0,
    bands: { sub: norm(b.sub), low: norm(b.low), mid: norm(b.mid), high: norm(b.high), air: norm(b.air) },
    rolloffHz: roll,
  };
}

export interface SeamStats {
  /** |x[0]-x[N-1]| (max over channels) */
  wrapJump: number;
  /** 99.9th percentile of |x[i]-x[i-1]| inside the loop */
  typicalStep: number;
  ratio: number;
  /** RMS difference between the last and first 50 ms (dB) */
  edgeDb: number;
  /** max/min of 100 ms window RMS across the loop (dB) — detects crossfade bumps or gaps */
  flatnessDb: number;
}

export function seam(chs: Float32Array[], sr: number): SeamStats {
  let wrap = 0;
  const steps: number[] = [];
  for (const d of chs) {
    const n = d.length;
    wrap = Math.max(wrap, Math.abs(d[0] - d[n - 1]));
    const stride = Math.max(1, Math.floor(n / 200000));
    for (let i = 1; i < n; i += stride) steps.push(Math.abs(d[i] - d[i - 1]));
  }
  steps.sort((a, b) => a - b);
  const typical = steps[Math.floor(steps.length * 0.999)] || 1e-9;
  const rms = (a: number, b: number): number => {
    let s = 0;
    let c = 0;
    for (const d of chs)
      for (let i = a; i < b; i++) {
        s += d[i] * d[i];
        c++;
      }
    return Math.sqrt(s / Math.max(1, c));
  };
  const n = chs[0].length;
  const w = Math.floor(sr * 0.05);
  const db = (x: number): number => 20 * Math.log10(Math.max(1e-9, x));
  const edgeDb = Math.abs(db(rms(n - w, n)) - db(rms(0, w)));
  const w100 = Math.floor(sr * 0.1);
  let mx = 0;
  let mn = Infinity;
  for (let s = 0; s + w100 <= n; s += w100) {
    const r = rms(s, s + w100);
    mx = Math.max(mx, r);
    mn = Math.min(mn, r);
  }
  return { wrapJump: wrap, typicalStep: typical, ratio: wrap / typical, edgeDb, flatnessDb: db(mx) - db(mn) };
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  return btoa(s);
}

export function storeBlob(key: string, buf: ArrayBuffer): void {
  const w = window as unknown as { __blobs?: Record<string, string> };
  w.__blobs = w.__blobs ?? {};
  w.__blobs[key] = toBase64(buf);
}

/** 32-bit float WAV (lossless transfer of rendered stems to Node/ffmpeg). */
export function encodeWavF32(chs: Float32Array[], sr: number): ArrayBuffer {
  const n = chs[0].length;
  const nc = chs.length;
  const bytes = n * nc * 4;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const w = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * nc * 4, true);
  v.setUint16(32, nc * 4, true);
  v.setUint16(34, 32, true);
  w(36, 'data');
  v.setUint32(40, bytes, true);
  const f = new Float32Array(buf, 44, n * nc);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) f[i * nc + c] = chs[c][i];
  return buf;
}
