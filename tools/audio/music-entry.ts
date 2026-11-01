// Browser entry for tools/audio/render-music.mjs: renders theme stems offline in Chromium.
import { SCORES } from './music/index';
import { renderStem, loopSamples, loopSeconds } from './music/perform';
import { encodeWavF32, spectral, storeBlob } from './lib/analysis';
import { analyze } from '../../src/audio/synth/render';

const api = {
  scores() {
    return SCORES.map((s) => ({
      id: s.id, title: s.title, description: s.description, bpm: s.bpm, beatsPerBar: s.beatsPerBar, bars: s.bars, key: s.key,
      sections: s.sections, stems: s.stems, loopSeconds: loopSeconds(s),
      tracks: s.tracks.map((t) => ({ name: t.name, stem: t.stem, instrument: t.instrument, notes: t.notes.length })),
    }));
  },
  async renderStem(id: string, stem: string, sr: number) {
    const score = SCORES.find((s) => s.id === id);
    if (!score) throw new Error(`no score ${id}`);
    const r = await renderStem(score, stem, sr);
    storeBlob(`${id}_${stem}`, encodeWavF32(r.channels, sr));
    return { events: r.events, renderMs: r.renderMs, loopSamples: loopSamples(score, sr), stats: analyze(r.channels, sr), spectral: spectral(r.channels, sr) };
  },
};
(window as unknown as { __music: typeof api }).__music = api;
