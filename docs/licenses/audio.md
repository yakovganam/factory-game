# Audio provenance and licensing

**Summary: all audio in this repository is original and was made procedurally in this repository.
It contains no third-party samples, loops, impulse responses, soundfonts or recordings.**

## What exists and how it was made

| Asset | Location | How it is produced |
|---|---|---|
| Sound effects (75 events, 174 variations) | No files. They are synthesized at runtime from `src/audio/sfx-catalog.ts`. | Each event's `recipe` schedules oscillators, seeded noise, filters and envelopes. Those come from `src/audio/synth/` and render once per variation into an `AudioBuffer` through `OfflineAudioContext` (`src/audio/sfx-render.ts`). The same code renders them for QA in headless Chromium (`tools/audio/check-sfx.mjs`). |
| Music stems (`workshop`: base/rhythm/lead; `evening`: base/lead) | `public/audio/music/*.ogg`, `*.m4a` | The compositions are written as code and data in `tools/audio/music/*.ts`: melodies, chord charts, bass styles and drum grids. They are performed by the synth library in headless Chromium (`OfflineAudioContext`) and exported as 32-bit float WAV. ffmpeg then encodes them (`tools/audio/render-music.mjs`). |
| Reverb impulse responses | Generated at render time (`src/audio/synth/fx.ts`, `makeImpulse`) | Decaying, seeded stereo noise with frequency-dependent damping. No recorded spaces are used. |
| Noise sources | Generated at render time (`Kit.noise`) | Seeded white, pink (Paul Kellet's filter approximation, a public-domain algorithm) and brown noise. |

The melodies, harmonies and arrangements were written for this game. The main motif
(C–F–A–G–F–G in F major) and its variations are original to this project.

## Tools used

- Web Audio API (`OfflineAudioContext`, oscillators, biquads, convolver, dynamics compressor) running in
  **Chromium 153 headless** through **Playwright**. Both were pre-installed in the build environment.
- **esbuild** (already a dependency of the project's toolchain) bundles the TypeScript sources for the headless page.
- **ffmpeg 6.1** with **libvorbis** (Ogg Vorbis, q3) and ffmpeg's native **AAC** encoder (`.m4a`,
  80 kbps stereo / 56 kbps mono). Integrated loudness was measured with ffmpeg's `ebur128` filter and band statistics with `astats`.

Encoders only convert our own renders. Using them adds no licence obligations to the encoded audio.

## Licence of the audio

The sound and music assets belong to the project, like its other original assets. To regenerate
them you only need the sources in this repository (see `docs/audio-guide.md`, "Editing and re-rendering").

## Third-party audio

None. If you add any later, list it here with source, author, licence, and the exact files that contain it.
