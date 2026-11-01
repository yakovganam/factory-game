# Known issues and open requirements

Severity levels: **S1** blocks release or the platform gate · **S2** major gap against the brief ·
**S3** quality defect · **S4** polish.

## Platform and verification

| ID | Sev | Issue | Disposition |
|---|---|---|---|
| P1 | S1 | The Android build is blocked: `dl.google.com` (AGP + SDK) is denied by the environment network policy | Owner: allow the host or provide an SDK image. The project itself is generated |
| P2 | S1 | iOS compile, sign and install need macOS, Xcode and Apple credentials | Owner: provide a Mac build worker and signing assets |
| P3 | S1 | No physical device has been tested. Desktop Chrome/Edge/Firefox/Safari and mobile browsers are unverified | Manual test pass on the device matrix |
| P4 | S2 | GPU performance hasn't been measured. Captures use SwiftShader (CPU), which is not performance evidence | Measure on target devices, then set budgets |
| P5 | S3 | `npm audit`: 4 moderate advisories in the dev-only `@capacitor/cli` dependency chain | Accepted for development; watch for an upstream fix |

## Scope (against the full brief)

| ID | Sev | Issue | Disposition |
|---|---|---|---|
| C1 | S2 | Only factory #01 and business #3 are playable. The other 49 factories and 9 businesses are defined as data (recipes, sources, unlocks, levels, mechanics tags) but aren't simulated, modelled or reachable in play | Milestone C/D batches, each passing the content checklist |
| C2 | S2 | City-level building, roads, expansion plots and districts aren't playable. The starter road graph is fixed | Milestone C |
| C3 | S2 | Heatmaps, supply-relationship highlighting and production graphs aren't implemented | Milestone C |
| C4 | S2 | Only the first chapter's mechanics are simulated. Mechanic modules for the other tags (curing, aging, cold chain, yield, …) aren't implemented | Per batch |
| C5 | S2 | Soundtrack: 2 of the 8 target themes (`workshop` main theme 124.8 s, `evening` 126.3 s) and 75 of ~120 sound events (174 variations). The `city` theme was deferred to stay within the 6 MB first-load budget. **All audio is synthesized and has not been reviewed by a human listener** | Listening review using the checklist in `docs/audio-guide.md`. Then the remaining themes (food, retail, logistics, high-tech, large city, industrial) |
| C7 | S3 | Decoded audio memory: ~80 MB for the `workshop` stems plus ~27 MB for the effects bank. That is high for low-end phones | Stream long stems or lower the sample rate after measuring on devices |
| C6 | S3 | Weather isn't implemented (presentation-only weather is planned first) | Milestone C |

## Simulation and gameplay

| ID | Sev | Issue | Disposition |
|---|---|---|---|
| G1 | S3 | Offline catch-up runs the real simulation. On very large cities it is limited by a 15 s compute budget, and the player is told about it. An aggregate fast-forward model is future work | Design an aggregate model, then validate it against step-by-step simulation |
| G2 | S3 | Sim lookups use linear `find`, so tick cost grows a bit faster than linearly. 200 sites = 1.7 ms/tick on desktop Node (`docs/qa/sim-benchmark.md`) | Index maps before Milestone D |
| G3 | S3 | Pacing has only been checked with a scripted player. **No human playtest yet** | Run moderated playtests of the first 30 minutes |
| G4 | S4 | Vehicles don't queue or avoid each other at shared stops, so they can overlap visually | Add stop slots |
| G5 | S4 | Workers path around machines but not around each other | Acceptable for now |

## Presentation

| ID | Sev | Issue | Disposition |
|---|---|---|---|
| R1 | S3 | Store shelves inside the toy store model don't show actual stock (stock is shown in the UI) | Bind shelf anchors from the model |
| R2 | S3 | Hebrew strings were written by the development team, not a native-speaker reviewer | Native review before release |
| R3 | S4 | Title-screen text overlaps the 3D backdrop. Legibility depends on the scene | Add a framed backdrop or vignette |
