# Architecture

## Boundaries

```
content (data + schema) ──► sim (authoritative, pure TS) ──► events ──► render / audio / ui
                                     ▲                                        │
                                     └──────────── commands ◄─────────────────┘
persist (envelopes, backends) ◄──► sim state (plain JSON)
platform (Capacitor lifecycle) ──► app controller (save on pause, catch-up on resume)
```

* **`src/sim`** has no DOM, Three.js, timers or platform imports. Its state is plain JSON and is
  the save format, so saving is a direct serialisation. Derived caches (occupancy grids, road
  graph paths) live in `WeakMap`s outside the state and are rebuilt on demand.
* **Commands** (`src/sim/commands.ts`) are the only way the presentation mutates state. Each is
  validated and is either applied atomically or rejected with an i18n reason key plus parameters.
  The UI shows the reason.
* **Events** (`SimEvent`) are transient presentation signals: craft, sale, stall, vehicle and so
  on. They are never needed to reconstruct state.
* **Rendering is derived**: each frame, the presentation syncs to sim state with interpolation
  (`alpha` = fraction of the next tick). Zooming, opening interiors or quality settings never
  change simulation results. The interior and city views read the same state.

## Tick order (10 Hz fixed step)

1. Factories, in sorted id order: staffing → power → machines (bays, storage, recipes) → belts →
   expansion completion → running costs.
2. Vehicles move or load/unload.
3. Dispatch policies: orders first, then shop restocking.
4. Stores: shelving, demand arrivals, checkout, wages.
5. Trends.
6. Orders.
7. Auto-import policies.
8. Tutorial progress.

The game loop runs `n = floor(acc)` ticks per frame, capped at 60. If the device falls behind, the
game slows down rather than spiralling. Simulation speed can be 0 (pause), 1, 2 or 3×.

## Determinism

* Integer arithmetic everywhere in the simulation (cents, mm, permille, milli-units). There is no
  `Math.exp`, `pow` or `sin`, because those can differ between JS engines.
* A seeded `mulberry32` RNG lives in the state. Iteration order is stable (sorted ids,
  arrays in id order).
* Tests show: same seed + same commands → identical state hash; chunked stepping equals
  continuous stepping; save → load → continue equals uninterrupted play; offline catch-up equals
  online stepping.

## Performance strategy

* The simulation cost scales with the number of entities and does not depend on the camera.
  Interiors are rendered only when cut away. Repeated props are `InstancedMesh`, and belt items
  use one instanced mesh per item type.
* Vehicles follow road graphs with no physics. Pedestrians are a sampled presentation of the
  aggregate population, and shoppers spawn only on real sale events.
* Quality tiers change pixel ratio, MSAA, shadow map size and pedestrian count. They never change
  simulation content.
* Benchmarks so far have run only in software-rendered headless Chromium (SwiftShader). Real
  device budgets are open (see `known-issues.md`).

## Persistence

* `SaveEnvelope { format, version, slot, savedAt, summary, checksum, state }` with an FNV-1a
  checksum of the stable-stringified state.
* IndexedDB backend: one `readwrite` transaction moves `slotN` to `slotN.bak` and writes the new
  `slotN`. A corrupt primary falls back to the backup. A newer-version save is refused, not
  overwritten.
* Fallbacks are localStorage, then in-memory. The player is warned to export when storage is
  unavailable.
* Autosave runs every 30 s, plus on tab hide, `pagehide`, and Capacitor `pause`.
* The migration chain is `MIGRATIONS[v]: v → v+1`. A committed v0 fixture is migrated in tests.
