# Resume state

Use this to pick up work in the next session. Keep it short and current.

## Where we are

* **Milestone A** (feasibility): the stack is decided and pinned (ADR 0001). The web build runs.
  Input, save, audio and loading are proven in the browser. Native shells are generated.
  The Android and iOS builds are blocked by the environment (see the platform matrix).
* **Workstreams finished this session:**
  * Content catalog: 377 items, 346 recipes, 50 factories and 10 businesses. The validator reports 0 errors.
  * Model library: 33 model ids and 18 item visuals, with gallery captures in `captures/models/`.
  * Audio: 75 events, 174 variations and 2 themes, all synthesized and not yet reviewed by a human listener.
* **End-to-end UI journey** (fresh city to first sale using real input) passes on desktop 1366×768 and on a phone-size 844×390 touch screen. Evidence is in `captures/e2e-evidence/`.
* **Milestone B** (opening experience): playable in the browser. Workshop and toy store, imports,
  belts, 7 machine types (bench, packer, paint booth, robot assembler, storage, splitter, belts)
  plus loading bays, orders, research, tutorial, saves, offline progress, EN/HE. Pacing has only
  been checked with a scripted player.

## Verify the baseline

```bash
npm test
```

All suites should pass. They cover economy invariants, determinism, saves, offline progress and
the content catalog.

```bash
npx tsx tools/validate-content.ts
```

This should report 0 errors.

```bash
npm run build
```

```bash
node tools/capture.mjs captures/gameplay
```

## Next concrete actions (in order)

1. Human playtest of the first 30 minutes (desktop + a phone). Log friction points against
   `docs/game-design.md` and re-run `tools/balance.ts` after any tuning.
2. Device pass: desktop Chrome/Edge/Firefox/Safari and mobile Chrome/Safari. Record results in
   `docs/platform-matrix.md`.
3. Unblock native builds: allow `dl.google.com` (Android), and get a Mac worker plus signing
   (iOS).
4. Milestone C, batch 1: Sawmill (#02, offcuts → `wood_pieces`), Packaging (#06 → `carton_flat`),
   Plastics (#14 → `plastic_parts`, `toy_wheels`), Distribution warehouse (business #8), Delivery
   depot (#7), Supermarket (#1). Each needs:
   * sim mechanic modules for its tags
   * interior bays and machines in the model library
   * a city plot with construction
   * roads to the plot
   * audio
   * a save fixture
   * a completion-matrix update
5. City layer: purchasable plots (the "For sale" signs), road building, inter-factory transfers
   as internal shipments (no profit), heatmaps.
6. Performance: replace linear `find`s with index maps (G2), and measure GPU frame times on
   devices.
