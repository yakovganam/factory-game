// Browser entry for tools/audio/check-sfx.mjs: renders catalog events offline in Chromium.
import { SFX_CATALOG, SFX_BY_ID, REQUIRED_SFX_IDS } from '../../src/audio/sfx-catalog';
import { renderSfxPcm, sfxRenderRate } from '../../src/audio/sfx-render';
import { encodeWav16 } from '../../src/audio/synth/render';
import { spectral, seam, storeBlob } from './lib/analysis';

const api = {
  list() {
    return SFX_CATALOG.map(({ recipe: _r, ...meta }) => meta);
  },
  required() {
    return [...REQUIRED_SFX_IDS];
  },
  async render(id: string, v: number, keepWav = false) {
    const def = SFX_BY_ID[id];
    const sr = sfxRenderRate(def);
    const r = await renderSfxPcm(def, v, sr);
    if (!r) return null;
    const out = {
      id,
      v,
      sr,
      stats: r.stats,
      normGainDb: 20 * Math.log10(r.normGain),
      loudness: r.loudness,
      renderMs: r.renderMs,
      spectral: spectral(r.channels, sr),
      // centroid trajectory: first vs second half (distinguishes up/down sweeps, call/response)
      trajectory: (() => {
        const n = r.channels[0].length;
        const h = Math.floor(n / 2);
        if (h < 2048) return [0, 0];
        return [spectral(r.channels.map((c) => c.subarray(0, h)), sr).centroidHz, spectral(r.channels.map((c) => c.subarray(h)), sr).centroidHz];
      })(),
      seam: def.loop ? seam(r.channels, sr) : null,
    };
    if (keepWav) storeBlob(`${id}_${v}`, encodeWav16(r.channels, sr));
    return out;
  },
};

(window as unknown as { __sfx: typeof api }).__sfx = api;
