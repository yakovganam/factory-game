# Audio guide — Tiny Factory: Tycoon City

Owner: audio workstream. Code: `src/audio/**`. Tools: `tools/audio/**`. Assets: `public/audio/music/**`.
The audio system only presents. It reacts to simulation events and camera context and never
changes simulation state.

## 1. Sonic identity

- **Toy-workshop warmth.** The materials are wood, felt and glass. Marimba, kalimba, glockenspiel and celesta play over a
  soft FM electric piano, a round bass and a light brushed kit. Nothing is distorted, nothing is
  aggressive, and nothing is "epic".
- **One key for the whole game.** The main theme is in **F major**. UI confirmations, purchases, unlocks,
  level-ups and milestones use F-major pitches (F, A, C), so progression sounds like part of the score.
  Evening music sits in Bb (the subdominant), which is a calmer neighbour.
- **Gentle information, never alarms.** `alert_blocked` is a soft *descending* muted knock ("stuck").
  `alert_starved` is a soft *rising* hollow "hm?" ("waiting for input"). `ui_error`
  and `build_invalid` are dull, low "nuh-uh" sounds, not buzzers.
- **Small-speaker aware.** Every impact has a mid-range "knock" layer, and loops carry upper harmonics.
  SFX are loudness-normalized with K-weighting plus a 100 Hz small-speaker high-pass, so what you hear
  on a phone keeps the intended balance.

## 2. The main motif

`C5 F5 A5 G5-F5 G5` (sol–do–mi re-do re), in eighths with a 16th-note turn. It is a rising arpeggio that
stops on the 2nd degree like a curious question. Bar 3 of the theme answers it a step higher
(`D G Bb A-G A`). The motif appears in:

- `workshop` (A sections on marimba, kalimba+marimba in thirds, marimba+glock). In the bridge it is
  transposed onto E minor with a lydian B natural, for the "curious detour".
- `evening`: augmented into quarter notes in Bb (`F Bb D C-Bb C`) on celesta, then flute.
- the `milestone` SFX, where the motif head is played quickly and resolves to an F chord.

## 3. Themes and stems

| Theme | Key / tempo | Length | Stems | Context |
|---|---|---|---|---|
| `workshop` (main theme) | F major, 100 BPM, light swing | 52 bars = 124.8 s | `base` (stereo): e-piano, pad, round bass, bridge nylon arpeggio · `rhythm` (stereo): brushed kit, shaker, bongos, woodblock "workshop clock" · `lead` (mono): motif and counter-melodies | Default for daytime, every district (city included until a `city` theme exists) |
| `evening` | Bb major, 76 BPM, lilting | 40 bars = 126.3 s | `base` (stereo): arpeggiated e-piano, warm pad, soft bass, nylon arpeggio, whisper-quiet brushes · `lead` (mono): celesta, flute, kalimba answers | Night (`night > 0.62`, returns to day below 0.4) |

The form of `workshop` is intro(4) A(8) A2(8) B(8) bridge(8) A3(8) coda(8). The coda thins out to shaker and
clock, and that leads back into the intro. The form of `evening` is intro(4) A(8, celesta) B(8, flute) C(8, G-minor
interlude on kalimba) A2(8, flute+celesta) outro(4). Neither theme repeats a section literally.
Each repeat changes instrumentation, harmony (thirds, counter-lines) or groove.

**City theme: not delivered in this milestone.** The two themes already use 4.9 MB (Ogg) and 5.3 MB (M4A)
of the ~6 MB budget, and a third 3-stem theme would add about 2.8 MB. The director already handles a `city` theme.
Add a score and re-render (section 11) once the budget allows, or once the bitrates are re-balanced.

## 4. Integration (for the game code)

```ts
import { audio } from './audio/AudioManager';           // or './audio'

// 1) Unlock from the first user gesture (required by browser autoplay policy; safe to repeat).
window.addEventListener('pointerdown', () => void audio.unlock(), { capture: true });

// 2) Apply persisted settings whenever they change (persistence is the game's job).
audio.applySettings({ master: 0.9, music: 0.7, sfx: 0.9, ambience: 0.8, ui: 0.8, muted: false });

// 3) Every frame: listener/camera context (drives spatial mix, ambience and music).
audio.update(dt, {
  x: target.x, y: 0, z: target.z,          // camera target on the ground, metres
  zoom01,                                   // 0 = interior/close … 1 = whole city
  night,                                    // 0 day … 1 night
  district: 'workshop',                     // dominant district in view
  activity,                                 // 0..1 healthy production in view (smooth it a little)
  interior: inCutaway,
  yaw: Math.atan2(-camDir.x, -camDir.z),    // optional; needed for correct L/R when orbiting
});

// 4) One-shots: UI without pos, world events with pos.
audio.play('ui_tap');
audio.play('build_place', { pos: { x, y, z } });
audio.play('combo_tick', { variation: step % 4 });       // some events use variation deliberately

// 5) Loops: call each frame (or at least every few hundred ms) per running source; gain 0 stops it.
audio.setLoop(`belt:${belt.id}`, 'loop_belt', belt.pos, belt.running ? 1 : 0);
audio.stopLoop(`belt:${belt.id}`);                       // when the entity is removed

// 6) App lifecycle.
document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));
// Capacitor: App.addListener('pause', () => audio.suspend()); App.addListener('resume', () => audio.resume());
```

Notes:
- `play()`/`setLoop()` before `unlock()` are silent no-ops. Loop requests are remembered and start after unlock.
- Unknown ids are ignored with a one-time console warning. `REQUIRED_SFX_IDS` and `SFX_CATALOG` are exported.
- **Ambience is automatic.** `update()` cross-fades `loop_amb_city_day`, `loop_amb_city_night` and `loop_amb_interior`
  from `night`, `interior` and `zoom01`. If the game calls `setLoop()` with one of those ids, the
  automatic beds switch off so they don't double up. `audio.setAutoAmbience(false)` does the same explicitly.
  District beds (`loop_amb_industrial`, `loop_shop_chatter`) are left to the game.
- Loops that aren't refreshed by `setLoop` for **4 s** fade out (this protects against leaked keys). Ambience-bus loops are exempt.
- Extra helpers: `audio.prewarm()` (start SFX rendering early; `update()` also does this 1 s after the first frame),
  `audio.forceTheme(id|null)`, `audio.stopAllLoops()`, `audio.debugInfo()`, `audio.configure({ baseUrl })`.
- Contract change: `ListenerContext.yaw?` was **added** as an optional member (it has JSDoc in `types.ts`). Nothing else changed.

## 5. Buses and levels

`voices → ui | sfx | ambience bus` (outdoor sources heard from inside go through a 950 Hz lowpass first) and
`music director → duck → music bus`. All buses feed `master → 40 Hz high-pass → compressor (−16 dB, 3:1, soft knee) → limiter (−2.5 dB, 20:1) → output`.

| Bus | Internal trim | Contents |
|---|---|---|
| music | 0.50 | stems, pre-mastered to −17 LUFS integrated (true peak ≤ −1 dBTP) |
| sfx | 0.85 | world sounds, machines, vehicles, economy |
| ambience | 0.60 | beds and nature one-shots |
| ui | 0.70 | taps, panels, notifications |

User settings multiply the trims through a perceptual curve (`gain = slider²`). `muted` zeroes the master,
and music stops loading while its volume is 0. Default settings are in `DEFAULT_SETTINGS`.

Every SFX variation is normalized to a per-category loudness. The measure is the loudest 100 ms window, K-weighted plus a 100 Hz HP,
LUFS-like: UI −17, economy −16, build/machine/vehicle −15, alerts −17, foley −16, loops −19. Sample peak stays ≤ −1 dBFS.
The catalog `gain` then sets the mix level. The `eff` column in `docs/qa/audio-sfx-report.md` is the resulting relative level per event.

## 6. Voice management

| Limit | Value |
|---|---|
| one-shot voices on sfx+ambience | 24 (`LIMITS.sfxVoices`) |
| UI voices | 8 |
| loop voices (after clustering) | 12 |
| per-event | catalog `maxVoices`, e.g. `bench_work` 3, `sale_coin` 4, `level_up` 1 |
| retrigger | catalog `minInterval`, e.g. `sale_coin` 60 ms, `bench_work` 120 ms, `alert_*` 800 ms |

- When an event is at its cap, its oldest voice is faded out in 30 ms.
- When the global pool is full, the voice with the lowest `level × (0.25 + 0.75 × remaining)` is stolen,
  but only if the new sound is louder. Otherwise the new sound is dropped.
- Variation choice is random but never repeats immediately. `opts.variation` forces one.
  `pitchJitter` adds a small extra random rate (±2–6 %). It comes on top of the real variations and doesn't replace them.
- A `play()` whose buffer isn't rendered yet waits up to 250 ms (UI/economy/build only) and is then dropped.

## 7. Ducking

- `audio.duck(amount, seconds)` lowers the music bus to `1 − amount` in about 0.1 s and holds it. It then recovers with τ 0.35 s.
  Overlapping ducks keep the deepest amount and the latest end.
- These catalog events duck automatically: `unlock` (35 %, 1.4 s), `level_up` (45 %, 2.2 s), `milestone`
  (55 %, 2.6 s), `research_done` (35 %, 1.5 s). Ordinary SFX never duck.

## 8. Spatial rules (`src/audio/spatial.ts`)

- Distance is measured on the ground plane from the listener (camera target). Height counts at half weight.
- Close views use a reference distance of 6 m and a max of 48 m. The city view (`zoom01 = 1`) uses 32 m and 260 m. Interior uses 4 m and 34 m.
  Rolloff is inverse-distance (1.15). There is a smooth fade over the last 28 % before max. **Sources beyond max never start a voice.**
- Category scaling with zoom: machines/foley drop to 45 % in the city view, vehicles to 80 %, economy/retail to 70 %.
  This turns a city of machines into texture.
- Pan is the offset along the camera right vector (uses `yaw`), divided by a width that grows with zoom (10 m to 75 m).
  It is capped at ±0.85 and collapses to centre for very close sources.
- `outdoor` events (vehicles, birds, horns, wind) heard while `interior` are attenuated to 40 % and low-passed.

## 9. Loops and the "100 machines" rule (`src/audio/loop-mixer.ts`)

Every 100 ms the requests are spatialized and grouped into **clusters**: same event, same world grid cell.
The cell is 8/16/32/64 m depending on zoom, with hysteresis, and 6 m inside. Each cluster plays **one voice**.
That voice gets the gain-weighted pan and a gain of `loudest member × min(1 + 0.25·log2(n), 1.6)`.
After clustering, a per-event cap (catalog `maxVoices`, 2–3 for machines) and a global cap of 12 apply. Existing
voices get a 1.3× ranking bonus so voices don't flap. Each loop voice starts at a hashed random offset with a slight
detune, so identical loops never phase-lock. Fades are 0.15 s for machines and 0.5 s for beds. Measured result:
100 belt/motor requests become 3 + 3 voices (see `docs/qa/audio-runtime-report.md`).

## 10. Music director (`src/audio/music-director.ts`)

- **Start.** Music starts only after `unlock()`, and loading happens in the background. The base stem is fetched and decoded first, then lead, then rhythm.
  Playback starts with a fade-in as soon as base is decoded, and later stems join in sync. Nothing blocks game start.
- **Theme choice.** Night with hysteresis → `evening`. The `city` district or a wide outdoor view goes to `city` if it exists. Everything else → `workshop`.
  A new choice must be stable for **2.5 s**. The crossfade then starts **on the next bar line** of the current theme:
  the old theme fades out (τ 1.1 s, about 4 s) and the new one enters at a **section start** (τ 0.9 s fade-in). When you return
  to a theme, it resumes at the section after the point where you left it.
- **Adaptive stems** (bounded, never escalating):
  - `base` = 1.
  - `lead` = 0.72 → 1 as the view widens, −15 % when interior (more intimate).
  - `rhythm` turns on when smoothed `activity` (τ 6 s) rises above 0.38 and off below 0.22. Entrances and exits are bar-aligned and take about a bar.
    The level is 0.65–1 by activity, scaled by zoom and interior.
- **Formats.** Ogg Vorbis is preferred when `canPlayType('audio/ogg; codecs="vorbis"')`. Otherwise `.m4a` (AAC) is used. If one format
  fails to decode, the other is tried. Any failure leaves the music silent and logs one warning.
- **AAC priming.** Loop points use the exact `loopSamples` from the manifest. If a decoder keeps the AAC encoder delay (the decoded
  buffer is too long), 1024 leading frames are skipped. Chromium decodes our M4A sample-exactly (see the music report). Safari is still unverified.
- **Memory.** Stems decode at 32 kHz (22.05 kHz if `navigator.deviceMemory ≤ 2`): about 80 MB for `workshop` and about 48 MB for `evening`.
  Only the playing theme and one fading theme stay decoded. Others keep only their compressed bytes, which are prefetched after the first theme is ready.
  The SFX bank adds about 27 MB when fully rendered.

## 11. Editing and re-rendering

**Scores.** Edit `tools/audio/music/<theme>.ts`. Melodies use `mel('C5:.5 F5:.5 A5:1! -:.5', startBeat, vel)`:
`-` is a rest, `_` a tie, `!` an accent and `?` a ghost note. Chords are one string per bar (`'Bbmaj7 C7'` means two halves).
Bass styles are `pedal|half|bounce|walk|octaves|sparse`. Drums use 16-step grids: `'x.....x.x.......'` with `X/x/o/-` velocities.
Per-stem balance is set with `stems[].lufs`. The renderer trims each stem to that value, then normalizes the whole mix to −17 LUFS.
To add a theme, add it to `tools/audio/music/index.ts`.

```sh
node tools/audio/render-music.mjs                 # all themes → public/audio/music + src/audio/music-manifest.ts (≈2–3 min)
node tools/audio/render-music.mjs --theme evening # one theme; manifest entries for the others are kept
node tools/audio/render-music.mjs --keep-wav      # also keep float WAVs in tools/audio/out/music (gitignored)
```

**SFX.** Add an `ev({...})` entry to `src/audio/sfx-catalog.ts`. Build the recipe from `tone`, `noiseHit`, `ring`,
`grains`, `chirp`, `roomSend` and the instruments. Rules:
- Each variation must change a material, layer, gesture or seed, not only pitch. `check-sfx` fails near-duplicates.
- Loops must be `loop: true` with an id prefix of `loop_`. Use `k.loopFreq(f)` for tonal parts and `periodic: true` grains with
  `loopRate()` so the content is loop-periodic. The renderer wraps a 0.35 s crossfade.
- Tonal "reward" events stay in F major.

**Naming conventions.**
- Events are `snake_case`, prefixed by domain: `ui_*`, `build_*`, `alert_*`, `loop_*` (with `loop_amb_*` for beds), plus
  plain nouns for world events (`sale_coin`, `van_horn`).
- Music files are `public/audio/music/<theme>_<stem>.{ogg,m4a}`. Stems are always `base`, `rhythm` and `lead`.

## 12. QA tools and evidence

| Command | Output |
|---|---|
| `node tools/audio/check-sfx.mjs [--wav]` | `docs/qa/audio-sfx-report.md`: every event/variation with duration, peak, RMS, loudness, centroid, band split and loop seam. Fails on silence, clipping, DC, bad seams and near-duplicate variations. `--wav` dumps WAVs to `tools/audio/out/sfx/` for listening. |
| `node tools/audio/check-music.mjs` | `docs/qa/audio-music-report.md`: sizes, bitrates, durations, LUFS/LRA/true peak per stem and full mix, band energy, decoded seam, Chromium decode lengths per format. |
| `node tools/audio/test-runtime.mjs` | `docs/qa/audio-runtime-report.md`: the real `AudioManager` in headless Chromium (Vite on port 5191). Covers unlock, bank, caps, culling, clustering, music start, crossfade, adaptive stems, duck and suspend. |
| `npx tsx tools/audio/selftest.ts` | Pure logic: spatial rules, clustering, catalog invariants, score sanity. |
| `npx vite --port 5190` → `http://127.0.0.1:5190/tools/audio/sandbox.html` | Manual review. It has buttons for every event and variation, loop toggles, a 100-machine stress test, theme forcing, listener sliders, the mix and a live `debugInfo()`. |

### What a human reviewer should listen for (none of this has been heard by a person yet)

1. **Main theme (sandbox → `workshop`, activity 0.6).** Is the motif memorable and does it feel warm and playful? Is the melody clearly
   above the e-piano? Does the bridge's B-natural detour feel "curious" rather than wrong? Listen at the loop point
   (about 2:04): there should be no click and no bump in level.
2. **Brightness.** The base stems are deliberately warm, and the report shows little energy above 4 kHz. On good headphones,
   check that it doesn't sound muffled. If it does, raise `presenceDb` or the pad `cutoff` in the score.
3. **Rhythm entrance.** Move activity 0 → 0.9: the groove should arrive on a bar line within about 6–8 s and never feel like it keeps accelerating.
4. **Evening crossfade.** Move night 0 → 1. After 2.5 s plus a bar, there should be a smooth handover with no tempo clash during the overlap.
5. **SFX on a phone speaker.** Check that `build_place`, `unload_thud` and `dock_door_close` still read. Check that `alert_blocked`
   and `alert_starved` can be told apart. Check that the loops (`loop_belt`, `loop_motor_hum`, engines) are audible but not annoying.
6. **Repetition.** Fire `sale_coin`, `item_drop`, `footstep_concrete` and `bench_work` rapidly. The variations should not sound "machine-gunned".
7. **Synthesis artefacts.** Listen for zipper noise, filter whistle, aliasing on high glock notes, and the formant "walla" of
   `loop_shop_chatter`. That last one is the riskiest design and may read as gibberish.
8. **Stress test.** It should sound like a busy hall, not noise. Toggle `interior` to hear outdoor muffling.

## 13. Honest quality notes and limitations

- Everything is **synthesized**: no recorded instruments or foley. Timbres are stylized, closer to a cosy toy-box than
  to realism. Foley like footsteps, doors and engines is plausible but simplified. `loop_shop_chatter` is an abstract formant
  murmur, not speech.
- Quality was judged by measurement only: loudness, band energy, seams and distinctness metrics. **It needs a human listening
  pass** on headphones and on at least one phone speaker before release.
- The base stems are dark (high band about −60 dB vs mids −27 dB). This is intentional warmth, but it's the first thing to tune.
- The `workshop` full mix sits at about −18 LUFS because it is limited by true peak (−1 dBTP). That is inside the target range, at its quiet end.
- Safari/iOS: AAC decode, loop points and `audioSession` behaviour are implemented but **unverified on a device**.
- Memory: decoded music PCM (about 80 MB for the main theme at 32 kHz) is the biggest audio cost. Measure it on low-end Android.
- The `city` theme is deferred because of the size budget (section 3).
