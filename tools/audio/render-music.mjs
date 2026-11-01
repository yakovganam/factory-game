#!/usr/bin/env node
// Renders every theme stem (tools/audio/music/*.ts) in headless Chromium via OfflineAudioContext,
// loudness-normalizes each theme so its FULL MIX sits at TARGET_LUFS (ffmpeg ebur128), encodes
// public/audio/music/<theme>_<stem>.ogg (Vorbis) + .m4a (AAC, for Safari) and regenerates
// src/audio/music-manifest.ts.
//   node tools/audio/render-music.mjs [--theme workshop] [--keep-wav]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openPage, fetchBlob, ROOT } from './lib/harness.mjs';

const SR = 32000;
const TARGET_LUFS = -17;
const MAX_TRUE_PEAK = -1.0;
const ENC = {
  ogg: { stereo: ['-c:a', 'libvorbis', '-q:a', '3'], mono: ['-c:a', 'libvorbis', '-q:a', '3'] },
  m4a: { stereo: ['-c:a', 'aac', '-b:a', '80k'], mono: ['-c:a', 'aac', '-b:a', '56k'] },
};
const args = process.argv.slice(2);
const only = args.includes('--theme') ? args[args.indexOf('--theme') + 1] : null;
const keepWav = args.includes('--keep-wav');
const OUT_WAV = path.join(ROOT, 'tools/audio/out/music');
const OUT_PUB = path.join(ROOT, 'public/audio/music');
fs.mkdirSync(OUT_WAV, { recursive: true });
fs.mkdirSync(OUT_PUB, { recursive: true });

function readF32Wav(file) {
  const b = fs.readFileSync(file);
  const nc = b.readUInt16LE(22);
  const sr = b.readUInt32LE(24);
  const data = new Float32Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
  const n = data.length / nc;
  const chs = Array.from({ length: nc }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) chs[c][i] = data[i * nc + c];
  return { chs, sr };
}
function writeF32Wav(file, chs, sr) {
  const n = chs[0].length;
  const nc = chs.length;
  const buf = Buffer.alloc(44 + n * nc * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * nc * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20);
  buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * nc * 4, 28);
  buf.writeUInt16LE(nc * 4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * nc * 4, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) buf.writeFloatLE(chs[c][i], 44 + (i * nc + c) * 4);
  fs.writeFileSync(file, buf);
}
/** ffmpeg ebur128 summary: integrated loudness, LRA, true peak. */
export function ebur128(file, extraFilter = '') {
  const res = execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `${extraFilter}ebur128=peak=true`, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return res;
}
function parseEbu(stderr) {
  const sum = stderr.slice(stderr.lastIndexOf('Summary:'));
  const num = (re) => {
    const m = re.exec(sum);
    return m ? Number(m[1]) : NaN;
  };
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}
function ebu(file) {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    throw new Error(`ffmpeg failed on ${file}: ${e.stderr}`);
  }
  const r = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${file}" -af ebur128=peak=true -f null - 2>&1`], { encoding: 'utf8' });
  return parseEbu(r);
}

const t0 = Date.now();
const { browser, page, errors } = await openPage('tools/audio/music-entry.ts');
const scores = (await page.evaluate(() => window.__music.scores())).filter((s) => !only || s.id === only);
const info = {};
for (const s of scores) {
  console.log(`theme ${s.id}: ${s.bars} bars @ ${s.bpm} BPM = ${s.loopSeconds.toFixed(2)} s`);
  const stems = [];
  for (const st of s.stems) {
    const r = await page.evaluate(([id, stem, sr]) => window.__music.renderStem(id, stem, sr), [s.id, st.id, SR]);
    const wav = await fetchBlob(page, `${s.id}_${st.id}`);
    const file = path.join(OUT_WAV, `${s.id}_${st.id}.wav`);
    fs.writeFileSync(file, wav);
    console.log(`  stem ${st.id}: ${r.events} notes, rendered in ${(r.renderMs / 1000).toFixed(1)} s, peak ${r.stats.peakDb.toFixed(1)} dBFS, rms ${r.stats.rmsDb.toFixed(1)} dBFS`);
    stems.push({ ...st, file, loopSamples: r.loopSamples, raw: r });
  }
  // per-stem balance: trim each stem to its target loudness
  for (const st of stems) {
    const m = ebu(st.file);
    st.measuredLufs = m.I;
    st.trimDb = st.lufs - m.I;
    console.log(`  stem ${st.id}: ${m.I.toFixed(1)} LUFS -> target ${st.lufs} (trim ${st.trimDb.toFixed(1)} dB)`);
  }
  // full mix = sum of trimmed stems (mono stems are upmixed to both channels, as WebAudio does)
  const loaded = stems.map((st) => readF32Wav(st.file).chs);
  const n = loaded[0][0].length;
  const mix = [new Float32Array(n), new Float32Array(n)];
  loaded.forEach((chs, k) => {
    const g = Math.pow(10, stems[k].trimDb / 20);
    for (let c = 0; c < 2; c++) {
      const src = chs[Math.min(c, chs.length - 1)];
      for (let i = 0; i < n; i++) mix[c][i] += src[i] * g;
    }
  });
  const mixFile = path.join(OUT_WAV, `${s.id}__mix.wav`);
  writeF32Wav(mixFile, mix, SR);
  const pre = ebu(mixFile);
  let gainDb = TARGET_LUFS - pre.I;
  if (pre.TP + gainDb > MAX_TRUE_PEAK) gainDb = MAX_TRUE_PEAK - pre.TP;
  for (const st of stems) {
    const stEbu = ebu(st.file);
    if (stEbu.TP + gainDb + st.trimDb > MAX_TRUE_PEAK) {
      console.warn(`  ! ${st.id} true peak would be ${(stEbu.TP + gainDb + st.trimDb).toFixed(1)} dBTP — limiting this stem's trim`);
      st.trimDb = MAX_TRUE_PEAK - stEbu.TP - gainDb;
    }
  }
  console.log(`  mix: ${pre.I.toFixed(1)} LUFS, TP ${pre.TP.toFixed(1)} -> applying ${gainDb.toFixed(2)} dB`);
  const outStems = [];
  for (const st of stems) {
    const layout = st.channels === 2 ? 'stereo' : 'mono';
    const files = {};
    const bytes = {};
    for (const fmt of ['ogg', 'm4a']) {
      const out = path.join(OUT_PUB, `${s.id}_${st.id}.${fmt}`);
      const extra = fmt === 'm4a' ? ['-movflags', '+faststart'] : [];
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', st.file, '-af', `volume=${(gainDb + st.trimDb).toFixed(3)}dB`, '-ar', String(SR), ...ENC[fmt][layout], ...extra, out]);
      files[fmt] = `audio/music/${s.id}_${st.id}.${fmt}`;
      bytes[fmt] = fs.statSync(out).size;
    }
    outStems.push({ id: st.id, channels: st.channels, description: st.description, files, bytes, gainDb: Number((gainDb + st.trimDb).toFixed(2)) });
    if (!keepWav) fs.rmSync(st.file);
  }
  info[s.id] = { preLufs: pre.I, preTP: pre.TP, gainDb, mixLufs: pre.I + gainDb, mixTP: pre.TP + gainDb, LRA: pre.LRA };
  if (!keepWav) fs.rmSync(mixFile);
  s.outStems = outStems;
  s.loopSamples = stems[0].loopSamples;
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

// ------------------------------------------------------------------ manifest
const manPath = path.join(ROOT, 'src/audio/music-manifest.ts');
let existing = [];
if (only && fs.existsSync(manPath)) {
  const m = /export const MUSIC_THEMES: MusicTheme\[\] = (\[[\s\S]*?\]);\n/.exec(fs.readFileSync(manPath, 'utf8'));
  if (m) existing = JSON.parse(m[1]).filter((t) => t.id !== only);
}
const themes = [
  ...existing,
  ...scores.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    bpm: s.bpm,
    beatsPerBar: s.beatsPerBar,
    bars: s.bars,
    key: s.key,
    sampleRate: SR,
    loopSamples: s.loopSamples,
    sections: s.sections,
    loudness: { mixLufs: Number(info[s.id].mixLufs.toFixed(1)), gainDb: Number(info[s.id].gainDb.toFixed(2)) },
    stems: s.outStems,
  })),
];
const order = ['workshop', 'evening', 'city'];
themes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
const ts = `// GENERATED by tools/audio/render-music.mjs — do not edit by hand. Re-render to update.
// Original music, synthesized from the scores in tools/audio/music/*.ts.

export interface MusicStemInfo {
  id: string;
  channels: 1 | 2;
  description: string;
  /** URLs relative to the app base (public/). */
  files: { ogg: string; m4a: string };
  bytes: { ogg: number; m4a: number };
  /** total gain applied when encoding (stem balance trim + mix normalization), dB */
  gainDb: number;
}

export interface MusicTheme {
  id: string;
  title: string;
  description: string;
  bpm: number;
  beatsPerBar: number;
  bars: number;
  key: string;
  sampleRate: number;
  /** exact loop length in samples at sampleRate */
  loopSamples: number;
  sections: Array<{ name: string; bar: number }>;
  loudness: { mixLufs: number; gainDb: number };
  stems: MusicStemInfo[];
}

export const MUSIC_THEMES: MusicTheme[] = ${JSON.stringify(themes, null, 2)};
`;
fs.writeFileSync(manPath, ts);
const totals = { ogg: 0, m4a: 0 };
for (const t of themes) for (const st of t.stems) for (const f of ['ogg', 'm4a']) totals[f] += st.bytes[f];
console.log(`manifest -> ${path.relative(ROOT, manPath)}; totals: ogg ${(totals.ogg / 1048576).toFixed(2)} MB, m4a ${(totals.m4a / 1048576).toFixed(2)} MB; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
