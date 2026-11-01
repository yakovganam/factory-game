#!/usr/bin/env node
// Checks the encoded music in public/audio/music against src/audio/music-manifest.ts and writes
// docs/qa/audio-music-report.md: durations, sizes/bitrates, integrated loudness (ffmpeg ebur128)
// per stem and for the full mix, true peak, band energy (listen-by-proxy), loop-seam continuity
// on decoded audio, and how Chromium's decodeAudioData handles each format (AAC priming).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openPage, ROOT } from './lib/harness.mjs';

const manSrc = fs.readFileSync(path.join(ROOT, 'src/audio/music-manifest.ts'), 'utf8');
const themes = JSON.parse(/export const MUSIC_THEMES: MusicTheme\[\] = (\[[\s\S]*?\]);\n/.exec(manSrc)[1]);
const PUB = path.join(ROOT, 'public');
const failures = [];
const BUDGET_MB = 6;

const sh = (args) => execFileSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30 });
const shErr = (args) => {
  try {
    return execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats ${args} 2>&1`], { encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (e) {
    return String(e.stdout ?? '') + String(e.stderr ?? '');
  }
};
const q = (f) => `"${f}"`;
function ebu(input, pre = '') {
  const out = shErr(`${input} -filter_complex "${pre}ebur128=peak=true" -f null -`);
  const sum = out.slice(out.lastIndexOf('Summary:'));
  const n = (re) => Number((re.exec(sum) ?? [])[1]);
  return { I: n(/I:\s+(-?[\d.]+) LUFS/), LRA: n(/LRA:\s+(-?[\d.]+) LU/), TP: n(/Peak:\s+(-?[\d.]+) dBFS/) };
}
function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
  const s = j.streams[0];
  return { codec: s.codec_name, sr: Number(s.sample_rate), ch: s.channels, dur: Number(j.format.duration), kbps: Math.round(Number(j.format.bit_rate) / 1000) };
}
function decodeF32(file, ch) {
  const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', String(ch), '-'], { maxBuffer: 1 << 30 });
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const n = f.length / ch;
  return Array.from({ length: ch }, (_, c) => {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = f[i * ch + c];
    return d;
  });
}
function seam(chs, sr) {
  let wrap = 0;
  const steps = [];
  for (const d of chs) {
    wrap = Math.max(wrap, Math.abs(d[0] - d[d.length - 1]));
    for (let i = 1; i < d.length; i += 7) steps.push(Math.abs(d[i] - d[i - 1]));
  }
  steps.sort((a, b) => a - b);
  const typical = steps[Math.floor(steps.length * 0.999)] || 1e-9;
  const rms = (a, b) => {
    let s = 0;
    let c = 0;
    for (const d of chs) for (let i = a; i < b; i++) (s += d[i] * d[i]), c++;
    return Math.sqrt(s / c);
  };
  const n = chs[0].length;
  const w = Math.floor(sr * 0.1);
  const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
  return { ratio: wrap / typical, edgeDb: Math.abs(db(rms(n - w, n)) - db(rms(0, w))) };
}
function bands(file) {
  const r = (flt) => {
    const out = shErr(`-i ${q(file)} -af "${flt},astats=metadata=0:reset=0" -f null -`);
    const m = /Overall[\s\S]*?RMS level dB:\s*(-?[\d.]+|-inf)/.exec(out);
    return m ? Number(m[1]) : NaN;
  };
  return { low: r('lowpass=f=250:p=2,lowpass=f=250:p=2'), mid: r('highpass=f=250:p=2,lowpass=f=4000:p=2'), high: r('highpass=f=4000:p=2,highpass=f=4000:p=2') };
}
function astats(input, pre = '') {
  const out = shErr(`${input} -filter_complex "${pre}astats=metadata=0:reset=0" -f null -`);
  const o = out.slice(out.lastIndexOf('Overall'));
  const n = (re) => Number((re.exec(o) ?? [])[1]);
  const peak = n(/Peak level dB:\s*(-?[\d.]+)/);
  const rms = n(/RMS level dB:\s*(-?[\d.]+)/);
  return { peak: Number(peak.toFixed(1)), rms: Number(rms.toFixed(1)), crest: peak - rms, dc: n(/DC offset:\s*(-?[\d.e-]+)/) };
}

// ---- Chromium decode behaviour per format
const { browser, page } = await openPage('tools/audio/lib/decode-entry.ts');
const rows = [];
const totals = { ogg: 0, m4a: 0 };
for (const t of themes) {
  const loopSec = t.loopSamples / t.sampleRate;
  const stemRows = [];
  for (const st of t.stems) {
    const r = { id: st.id, ch: st.channels, fmts: {} };
    for (const fmt of ['ogg', 'm4a']) {
      const file = path.join(PUB, st.files[fmt]);
      if (!fs.existsSync(file)) {
        failures.push(`${t.id}/${st.id}: missing ${st.files[fmt]}`);
        continue;
      }
      const size = fs.statSync(file).size;
      totals[fmt] += size;
      const p = probe(file);
      const b64 = fs.readFileSync(file).toString('base64');
      const dec = await page.evaluate(([b, sr]) => window.__decode(b, sr), [b64, t.sampleRate]);
      r.fmts[fmt] = { size, ...p, chromeFrames: dec.ok ? dec.length : null, chromeErr: dec.ok ? null : dec.error, leadSilence: dec.ok ? dec.leadingZeros : null };
      if (Math.abs(p.dur - loopSec) > 0.1) failures.push(`${t.id}/${st.id}.${fmt}: duration ${p.dur.toFixed(2)} s vs loop ${loopSec.toFixed(2)} s`);
    }
    const oggFile = path.join(PUB, st.files.ogg);
    r.ebu = ebu(`-i ${q(oggFile)}`);
    r.bands = bands(oggFile);
    r.astats = astats(`-i ${q(oggFile)}`);
    const pcm = decodeF32(oggFile, st.channels);
    r.decodedFrames = pcm[0].length;
    r.seam = seam(pcm, t.sampleRate);
    if (r.seam.ratio > 1.5) failures.push(`${t.id}/${st.id}: loop seam jump x${r.seam.ratio.toFixed(2)}`);
    if (r.ebu.TP > -0.5) failures.push(`${t.id}/${st.id}: true peak ${r.ebu.TP} dBTP`);
    stemRows.push(r);
  }
  // full mix from the decoded ogg stems (mono stems upmixed to both channels, as WebAudio does)
  const inputs = t.stems.map((st) => `-i ${q(path.join(PUB, st.files.ogg))}`).join(' ');
  const pre = t.stems.map((st, i) => `[${i}:a]${st.channels === 1 ? 'pan=stereo|c0=c0|c1=c0,' : ''}aformat=channel_layouts=stereo[s${i}];`).join('') + t.stems.map((_, i) => `[s${i}]`).join('') + `amix=inputs=${t.stems.length}:normalize=0,`;
  const mix = ebu(inputs, pre);
  const mixStats = astats(inputs, pre);
  if (!(mix.I >= -19 && mix.I <= -15)) failures.push(`${t.id}: full mix ${mix.I} LUFS outside -19..-15`);
  if (mix.TP > -0.5) failures.push(`${t.id}: full-mix true peak ${mix.TP} dBTP`);
  rows.push({ t, loopSec, stemRows, mix, mixStats });
}
await browser.close();
for (const f of ['ogg', 'm4a']) if (totals[f] / 1048576 > BUDGET_MB * 1.05) failures.push(`total ${f} ${(totals[f] / 1048576).toFixed(2)} MB exceeds ~${BUDGET_MB} MB budget`);

// ------------------------------------------------------------------ report
const mb = (b) => (b / 1048576).toFixed(2);
const L = [];
L.push('# Audio QA — music report');
L.push('');
L.push(`Generated by \`node tools/audio/check-music.mjs\` on ${new Date().toISOString()} from \`public/audio/music\` + \`src/audio/music-manifest.ts\`.`);
L.push('');
L.push(`- Themes: ${themes.map((t) => `**${t.id}**`).join(', ')}; total size: Ogg Vorbis **${mb(totals.ogg)} MB**, AAC/m4a **${mb(totals.m4a)} MB** (budget ~${BUDGET_MB} MB per format)`);
L.push(`- Result: **${failures.length ? `FAIL (${failures.length})` : 'PASS'}**`);
L.push('- Loudness target: full mix -18…-16 LUFS integrated (renderer aims at -17 and caps true peak at -1 dBTP; check tolerance -19…-15).');
L.push('- Seam check: decoded Ogg, wrap jump |x[0]-x[N-1]| vs 99.9th-percentile sample step (must be ≤1.5). The last/first 100 ms RMS difference is informational only — bar 0 starts on a downbeat while the end is a quieter pickup, so a level step there is musical, not a click. Continuity is guaranteed by construction: each stem is rendered with a 4 s tail that is folded back onto bar 0.');
L.push('- Bands: RMS of the stem through 2nd-order filters: low <250 Hz, mid 250 Hz–4 kHz, high >4 kHz (listen-by-proxy: is anything missing or dominating?).');
L.push('');
if (failures.length) {
  L.push('## Failures');
  for (const f of failures) L.push(`- ${f}`);
  L.push('');
}
for (const { t, loopSec, stemRows, mix, mixStats } of rows) {
  L.push(`## ${t.id} — ${t.title}`);
  L.push('');
  L.push(`${t.key}, ${t.bpm} BPM, ${t.beatsPerBar}/4, ${t.bars} bars = **${loopSec.toFixed(2)} s** seamless loop @ ${t.sampleRate} Hz. Sections: ${t.sections.map((s) => `${s.name}@${s.bar}`).join(', ')}.`);
  L.push('');
  L.push(`**Full mix** (all stems at unity, decoded Ogg): integrated **${mix.I} LUFS**, LRA ${mix.LRA} LU, true peak ${mix.TP} dBTP, sample peak ${mixStats.peak} dBFS, RMS ${mixStats.rms} dBFS, crest (peak−RMS) ${mixStats.crest.toFixed(1)} dB.`);
  L.push('');
  L.push('| stem | ch | ogg size / kbps | m4a size / kbps | dur s | LUFS | LRA | TP dBTP | low / mid / high dB | seam | Chromium decode (frames @32k; expected ' + t.loopSamples + ') |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of stemRows) {
    const o = r.fmts.ogg ?? {};
    const m = r.fmts.m4a ?? {};
    const dec = ['ogg', 'm4a'].map((f) => `${f}: ${r.fmts[f]?.chromeFrames ?? `ERR ${r.fmts[f]?.chromeErr}`}${r.fmts[f]?.chromeFrames ? ` (${r.fmts[f].chromeFrames - t.loopSamples >= 0 ? '+' : ''}${r.fmts[f].chromeFrames - t.loopSamples}, lead 0s ${r.fmts[f].leadSilence})` : ''}`).join('; ');
    L.push(`| ${r.id} | ${r.ch} | ${mb(o.size)} MB / ${o.kbps} | ${mb(m.size)} MB / ${m.kbps} | ${o.dur?.toFixed(2)} | ${r.ebu.I} | ${r.ebu.LRA} | ${r.ebu.TP} | ${r.bands.low.toFixed(1)} / ${r.bands.mid.toFixed(1)} / ${r.bands.high.toFixed(1)} | x${r.seam.ratio.toFixed(2)} / ${r.seam.edgeDb.toFixed(1)} dB | ${dec} |`);
  }
  L.push('');
}
L.push('## Notes');
L.push('');
L.push('- `Chromium decode` shows how many frames `decodeAudioData` returns (OfflineAudioContext at the file rate). A positive offset on m4a means the decoder kept AAC priming/padding; `MusicDirector.setLoopPoints()` then skips 1024 leading frames so every stem keeps the exact loop length. Safari/iOS behaviour must be verified on a device.');
L.push('- Loudness is measured on the stems at unity. In game the director lowers lead (close views) and removes rhythm (idle production), so the in-game music bus usually sits 0–3 dB below these numbers, then the music bus trim/settings apply.');
L.push('');
fs.writeFileSync(path.join(ROOT, 'docs/qa/audio-music-report.md'), L.join('\n'));
console.log(`music: ${themes.length} themes; ogg ${mb(totals.ogg)} MB, m4a ${mb(totals.m4a)} MB; ${failures.length} failures`);
for (const f of failures) console.log('  FAIL', f);
process.exit(failures.length ? 1 : 0);
