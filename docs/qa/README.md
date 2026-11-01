# QA evidence index

Everything here was produced by commands in this repository. This page explains what each piece
of evidence does and does not prove.

| Evidence | Command | What it proves | What it does NOT prove |
|---|---|---|---|
| Unit/integration tests (`tests/*.test.ts`) | `npm test` | Goods conservation, ledger reconciliation, no internal-transfer profit, shipment reservation, explained stalls, power cap, determinism, save/load and offline equivalence, migration, backup recovery, contract rate limits, content validity, i18n completeness | Fun, feel, device behaviour |
| Content validation | `npx tsx tools/validate-content.ts` | The full 50-factory + 10-business catalog is internally consistent: sources, reachability, unlock graph, i18n | That those factories are playable (they aren't yet) |
| Balance report (`balance-report.md`) | `npx tsx tools/balance.ts 40` | The opening economy has no dead ends, and pacing is plausible for a perfect scripted player | Human pacing (no human playtests yet) |
| Simulation benchmark (`sim-benchmark.md`) | `npx tsx tools/bench-sim.ts` | Authoritative tick cost scales to 200 production sites on desktop-class Node | Phone CPU or GPU frame times |
| In-engine captures (`captures/gameplay/*.png` + `report.json`) | `node tools/capture.mjs captures/gameplay` | The real game renders these scenes at phone/tablet/desktop aspect ratios in EN and HE, with no console errors | GPU performance. SwiftShader is a CPU rasteriser |
| End-to-end UI journey (`captures/e2e*/`) | `node tools/e2e-opening.mjs [--phone]` | A fresh player can reach a first real sale using only the UI and canvas input: imports, placement, recipe selection, belt drawing, shipping | Real touch hardware, real browsers other than headless Chromium |
| Audio reports (`audio-sfx-report.md`, `audio-music-report.md`) | `node tools/audio/check-sfx.mjs` | Every sound event renders, isn't silent and doesn't clip. Music loudness and duration | That it sounds good. That needs human listening |
