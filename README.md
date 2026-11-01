# Tiny Factory: Tycoon City (working title)

A stylized 3D economic city-builder for the web, Android and iPhone/iPad. You start with one
small toy-and-robot workshop and grow it into a connected industrial city.

> **Working title only.** The name hasn't been checked for trademark or store availability.
> Do that before any public branding.

## Current state (honest summary)

This repository is at **Milestone A, and Milestone B is in progress**. It is a playable vertical
slice of the opening, not the full game.

| Area | State |
|---|---|
| Simulation core (fixed-step, deterministic, integer money) | Implemented and tested (`npm test`) |
| Toy & Robot Workshop (factory #01) playable interior | Implemented and playable in the browser |
| Toy Store (business #3) retail | Implemented and playable |
| Imports, delivery vans, supplier trucks, contracts, research, tutorial | Implemented and playable |
| Saves (IndexedDB atomic + backup, migrations, export/import), offline catch-up | Implemented and tested |
| English + Hebrew (real RTL) | Implemented. Hebrew needs review by a native speaker |
| Remaining 49 factories + 9 businesses | **Data only.** The catalog has 377 items, 346 recipes, 255 machines and 226 unlocks, and it validates with 0 errors. None of it is playable yet |
| Web build | Builds (`npm run build`). Tested only in headless Chromium |
| Android | Capacitor project generated. **Doesn't build here:** the Android SDK host is blocked by the network policy |
| iOS/iPadOS | Capacitor Xcode project generated. **Not compiled:** needs macOS, Xcode and signing |
| Physical devices, Safari, Firefox, Edge | **Not tested** |

See `docs/platform-matrix.md`, `docs/known-issues.md` and `docs/resume-state.md` for detail.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open http://127.0.0.1:5173.

```bash
npm test
```

```bash
npm run build
```

```bash
npm run preview
```

Other tools:

```bash
npx tsx tools/validate-content.ts
```

```bash
npx tsx tools/balance.ts 40
```

```bash
node tools/capture.mjs captures/gameplay
```

`tools/validate-content.ts` validates the full catalog: dependency graph, sources, unlock
reachability and i18n. `tools/balance.ts` runs the scripted-player pacing report and writes
`docs/qa/balance-report.md`. `tools/capture.mjs` takes in-engine screenshots with headless
Chromium.

## Stack

TypeScript 7.0.2, Three.js 0.187 (WebGL2), Vite 8.3.5, Vitest 5.0.5 and Capacitor 8.6. The ADR
`docs/adr/0001-engine-and-stack.md` explains why this stack was chosen instead of Unity 6: Unity
couldn't be installed or licensed in this environment. It also lists how to unblock Unity if you
want it.

## Layout

```
src/sim/        authoritative simulation (no DOM / Three.js imports)
src/content/    data schema, chapter data, catalog, validator, DB indexing
src/persist/    save envelopes, backends, migrations
src/render/     Three.js presentation: city, interiors, agents, camera, models/
src/audio/      WebAudio engine, procedural SFX, music director
src/ui/         DOM UI: HUD, panels, tutorial, settings, app controller
src/i18n/       en + he string tables and runtime
tests/          vitest suites (economy, determinism, saves, content)
tools/          capture, balance, content validation, audio rendering, model gallery
docs/           ADRs, design, economy, art/audio guides, matrices, QA evidence
android/ ios/   Capacitor native shells
```
