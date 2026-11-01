# Art bible — Tiny Factory: Tycoon City

Target look: **a premium stylized miniature city** — a toy-like diorama with believable function. Soft
clay-like matte surfaces, crisp bevels that catch light, saturated-but-warm accents, readable
silhouettes from a 10–15 m camera on a phone. Everything is original procedural geometry
(`src/render/models/**`), see `docs/licenses/art.md`.

Gallery: `npx vite --port 5181` then open `/tools/model-gallery/index.html` (params documented at the top of
`tools/model-gallery/gallery.ts`). Captures: `node tools/model-gallery/capture.mjs [filter]` → `captures/models/`.

---

## 1. Palette (sRGB hex — `PAL` in `materials.ts`)

| Role | Swatches |
|---|---|
| Brick / masonry | brick texture (red `#c6684c` bricks, cream `#e9dcc6` mortar), plinth tint `#a8968c`, cap/coping `#e8dcc4` |
| Plaster / interior | cream `#f1e6cf`, lining `#f3ead8`, dado sage `#7d9a92`, house pastels mint `#b9dcc9`, butter `#f3dc8e`, sky `#a9cde8`, peach `#f4bf9c`, coral (store) `#f2b8a0` |
| Roofs | slate teal `#4d6670`, dark `#34474f`, terracotta `#a65a42`/`#b4583e`, slate blue `#52687e`, saw-tooth grey `#8a9aa2` |
| Signature accents | teal `#2e7c78` (Toy Works brand), deep teal `#1f5654`, mint `#93d6c3`, orange `#ef7f3a` (robots), safety yellow `#f2bb2c`, red `#d8453c`, blue `#3f7fc8`, purple `#6d4fa8` |
| Neutrals | graphite `#34383f`, rubber `#2a2c31`, steel `#aab3ba`, dark steel `#5c656d`, chrome `#e2e6ea`, white `#f5f3ee` |
| Materials | wood `#c9985f` / light `#e3c08a` / dark `#8a5d36`, cardboard `#c99b63` / dark `#a87b46`, concrete `#d3ccc0` / dark `#aaa296`, asphalt `#4c5056`, grass `#8dbf62` |
| Light | window glow `#ffc874`, lamp `#ffd08a`, cool LED `#e8f3ff`, tail `#ff3a24`, screen cyan `#58e0ff` |
| Status tiers | blue `#2f7cff`, green `#2fd35a`, amber `#ffa31a`, red `#ff3326`, white `#f2f4f8` |
| Products | blocks yellow box, car red box, robot blue box, smart robot aubergine `#3b2a6b` box with teal band |

Rules: one dominant hue per object + one accent + neutrals. Saturated colours are reserved for
signals (status, hazard, brand, products). Large surfaces stay mid-value and slightly warm so the
ACES tone curve never clips them to white.

## 2. Materials (shared — `mat(key)` in `materials.ts`)

All library materials are created once and shared. Colour per part = **vertex colour** multiplied
into the material, so a machine is typically 4–8 draw calls regardless of how many colours it uses.

| Key | Type / params | Use |
|---|---|---|
| `paint` | Standard, rough 0.82, metal 0, vc | plaster, cloth, cardboard, matte paint, characters |
| `satin` | rough 0.46, metal 0.02, vc | painted steel, plastic, vehicle paint, items |
| `metal` | rough 0.34, metal 0.85, vc | bare steel, chrome rollers, insulators of steel |
| `brick` / `concrete` / `wood` | canvas maps, world-metre UVs, rough 0.72–0.92 | masonry, floors (1 m joints align to the grid), timber |
| `ribbed` / `slats` / `tiles` | sinusoidal normal maps | corrugated roofs/cladding/containers, roller curtains, roof tiles |
| `hazard` | yellow/black stripe map, 0.12 m pitch | dock lips, guards, floor zones |
| `glass` | rough 0.08, metal 0.6, vc | vehicle glazing, never glows |
| `glassLit` | as glass + warm emissive × night | building windows |
| `glassClear` | transparent 0.28, no depth write, double-sided | booth windows, offices, display glass |
| `glow` (aliases `lamp`, `lampCool`, `tail`, `screen`) | emissive = vertex colour × intensity(night) | every light, HMI screen, tail light |
| `solar`, `wire` | cell texture / alpha-tested mesh | PV panels / guard + perimeter fences |
| `foliage` | rough 0.88, vc gradient (dark low, light high) | trees, hedges, planters |
| `contact`, `contactRound`, `lightPool` | unlit transparent / additive | soft contact shadows, night light pools |
| `sign:*`, `livery` | canvas text textures | signage (emissive at night where it is lit), vehicle liveries (4-row atlas) |

Ranges: roughness 0.3–0.95 (nothing glossier than 0.3 except glass), metalness 0 for everything painted,
0.6–0.85 only for bare metal/glass. Per-instance materials exist only where state is per instance:
stack-light lens (shared shader program), status halo sprite, dock roller stripe texture offset,
paint mist / painted part tint, packed product tint, and transient clones during cutaway fades.
Measured: **31 shared materials** for the whole library (`captures/models/stats.json`).

## 3. Lighting (`lighting.ts`, identical in gallery and game)

* `configureRenderer`: ACES filmic, exposure 1.0, sRGB output, PCF shadows (`shadow.radius = 3` for
  softness — r187 removed `PCFSoftShadowMap`).
* `createLightRig()`: warm sun `#fff0d8` ×2.6 from the **east-south-east, ~50° high** (towards-light
  vector `(0.62, 1, 0.36)`), sky/ground hemisphere `#cfe4ff`/`#c8b496` ×0.95, cool back fill ×0.3.
  The sun direction is chosen so street-facing walls (S, E) read in two tones, shadows fall
  north-west (away from the camera), and the remaining west/north walls never shadow a cut-away
  interior. Night: moon `#8fa8ff` ×0.5, hemisphere `#2c3f70`/`#141a2a` ×0.42. `update(night, focus,
  radius)` fits the 2048² shadow frustum to the view and snaps it to texels (no shimmer).
* `createSkyAndFog(scene, renderer)`: background/fog `#bcdcef` (day) → `#0e1729` (night), procedural
  RoomEnvironment IBL ×0.45 → ×0.10. Recommended fog: `near ≈ 1.6 × camera distance`,
  `far ≈ 4.5 × camera distance` (the gallery does this); never fog the gameplay focus.
* Night is a single global: every model's `update()` forwards `AnimState.night` to
  `setNightLevel()`, which drives window glow, lamps, signs and light pools.

## 4. Scale, pivots, orientation

* 1 unit = 1 m, +Y up. Worker 1.71 m (1.76 with hard hat), door 2.15 m, bay door 1.8 × 2.5 m,
  van 4.8 m, box truck 7.6 m, belt top `BELT_TOP_Y = 0.42`.
* **Machines** face +X at rotation 0 (output side), centred on their footprint, base y = 0.
  `root.userData` carries `footprint`, `ports` (local in/out lip centres), `workerSpot {x,z,yaw}`.
* **Characters and vehicles** face +X at rotation 0, origin on the ground at the body centre.
* **Buildings**: origin = centre of the interior grid at floor level (houses/depot/substation: plot
  centre at yard level). Floor top is y = 0; foundations go down to −0.15. **Place building roots at
  `BUILDING_FLOOR_HEIGHT` (0.15) above the street** so slabs never z-fight the city ground. The street
  side of every building is +Z; the gameplay camera sits at +X,+Z.
* Grid: tile (gx, gy) occupies local x ∈ [gx − w/2, gx + 1 − w/2], z ∈ [gy − h/2, gy + 1 − h/2]. Use
  `placeOnGrid(obj, interior, gx, gy, footprint, rot)` from `models/index.ts` (anchor = min corner of
  the rotated footprint; odd rotations swap the footprint extents).

## 5. Silhouette & detail rules

1. Every primary form has a chamfer or rounded edge (flat-shaded 44-tri chamfer box); chamfers under
   8 mm are dropped automatically (invisible at 12 m, 32 triangles each).
2. Detail is **layered structure**, never noise: frames around openings, sills and lintels, plinths
   and copings, rails on posts, guards on machines, cables/hoses between parts.
3. Each machine has one **signature silhouette element** that reads at phone size: bench → pegboard +
   task lamp; packer → blue portal + tape head; paint booth → white cabin + extractor stack; robot
   cell → orange arm + yellow fence posts; dock → coloured roll-up portal; splitter → yellow gantry +
   orange paddle; storage → green cage.
4. Interior-facing walls (W, N) carry the storytelling detail (lights, pipes, extinguisher, notice
   board, clock, distribution board) because they are what the cut-away camera sees.
5. Contact shadows under every free-standing object; light pools under every night light.
6. No floating parts: every prop/fixture touches a support (verified in captures); no coplanar faces
   (offsets ≥ 4 mm, polygon offset on decals).

## 6. Budgets (measured — `captures/models/stats.json`)

| Class | Budget | Measured (tris · draw calls) |
|---|---|---|
| Item (18 + fallback) | ≤ 400 tris, 1 draw (InstancedMesh) | 72–388 · 1 |
| Belt / belt Mk2 / curves | ≈ 700–1200, 3 draws | 680 / 752 / 1120–1180 · 3 |
| Machines | ≤ 4 k | 1.0–3.6 k · 7–20 (robot cell 3.6 k · 20) |
| Worker / pedestrian | ≤ 1.5 k, 2 draws (skinned body + blob) | 1.36–1.47 k / 1.14–1.31 k · 2 |
| Vehicles | ≤ 4 k | van 2.8 k · 19, truck 3.35 k · 16 |
| Houses (6) | ≤ 5 k | 3.3–5.0 k · 10–11 |
| Workshop L1 / L2 / L3 | L3 ≤ 20 k | 10.6 k · 35 / 14.5 k · 45 / 19.8 k · 43 |
| Toy store L1–L3 | (≈ 15 k) | 8.9–14.5 k · 25–27 |
| Import depot / substation | — | 11.2 k · 17 / 8.0 k · 7 |
| Props | — | 106–930 · 1–10 |
| Materials (library) | ≤ ~40 | **31 shared** + per-instance: stack lens (1 shared program), halo sprite, dock rollers, paint mist/part, packed item |

Static geometry of each model is merged per material and **cached per model id** (60 belts share one
geometry); only animated parts are separate meshes. `update()` never allocates.

## 7. Animation-state language (`VisualStatus`)

Every machine has a stack light (5 tiers bottom→top: blue, green, amber, red, white) or, on belts and
storage, a single LED. Status reads by **tier position + rhythm**, not colour alone, plus an additive
halo for phone readability.

| Status | Light | Mechanism |
|---|---|---|
| `working` | green, steady | animates, synced to `progress` |
| `loading` / `unloading` | green, quick blink | docks: curtain rolls up, rollers turn; vehicles: rear doors/shutter open |
| `starved` | amber, slow blink (0.8 Hz) | stops, parks |
| `blocked` | amber, double flash | stops, parks |
| `no_power` | red, short flash every 1.8 s, otherwise dark | stops; robot arm droops |
| `no_worker` | blue, breathing | stops |
| `no_recipe` | white, slow blink | stops |
| `upgrading` | amber ⇄ green alternate | stops |
| `idle` | dim white (reads grey) | stops; dock curtains close |

Per-model drivers: belts scroll at `BELT_BASE_SPEED × speed` (1 m/s); curved belts (`mach_belt[_mk2]_turn_r/_l`, exit +X, entry +Z for _r / −Z for _l, quarter circle r = 0.5 about the exit-side corner) rotate their cleats about that corner at the same surface speed; robot cycle pick (0–0.26) →
place (0.26–0.48) → screw (0.52–0.78) → home; bench presses 3× per cycle; packer erects (0–0.14),
item drops (0.16–0.36), flaps fold (0.42–0.7), tape passes (0.72–0.92), carton exits; paint booth
sweeps 3× and tints the part toward `itemColor`; storage shows `round(progress × 8)` cartons.
Characters: `pose` walk/carry/work/idle; root speed must be `WORKER_WALK_SPEED × speed` (1.3 m/s)
for planted feet. Vehicles: wheels from `speed` in m/s.

## 7b. Integration cookbook

```ts
import { createModel, getItemVisual, placeOnGrid, BUILDING_FLOOR_HEIGHT, BELT_TOP_Y, WORKER_WALK_SPEED } from './render/models';
import { configureRenderer, createLightRig, createSkyAndFog } from './render/models/lighting';

const bld = createModel('bld_toy_workshop', { level, interior: lvl.interior, bays: lvl.bays.map(b => ({ ...b, kind: role(b.machine) })) });
bld.root.position.set(cityX, BUILDING_FLOOR_HEIGHT, cityZ);           // floor slab sits 15 cm above the street
const m = createModel(def.model);                                     // e.g. 'mach_paint_booth'
placeOnGrid(m.root, lvl.interior, x, y, def.footprint, rot);          // building-local
bld.root.add(m.root);                                                 // or add bld.root.position yourself
bld.setCutaway?.(cutaway01);                                          // call when it changes (ease it 0→1 over ~0.4 s)
m.update?.(dt, { status, progress, time, night, speed, itemColor });  // every frame while visible
```

* Bays: pass `kind` (`'receiving' | 'shipping'`); if omitted, `x === 0` ⇒ receiving. A bay becomes a wall
  opening on the wall its machine backs onto (receiving: behind its −X; shipping: in front of its +X).
  The roll-up curtain belongs to the dock machine, so **always place the dock machines on the bay tiles**.
* Cutaway hides the roof and the south and east walls (camera at +X,+Z). A rotated camera would need
  the walls facing it instead; ask the art owner if that becomes a feature.
* Night: one global value; pass the same `night` to all `update()` calls and to `rig.update` / `sky.update`.
* Items: `const v = getItemVisual(id); new THREE.InstancedMesh(v.geometry, v.material, n)`; geometry base
  is y = 0, so on belts set the instance y to `BELT_TOP_Y`. Geometry and material are shared — never
  dispose them. One InstancedMesh per item id; unknown ids return a tinted crate.
* Workers: move the root at `WORKER_WALK_SPEED × speed` m/s while `pose` is `walk`/`carry`; face the
  travel direction with `rotation.y = atan2(-dz, dx)` (+X forward). Stand them at
  `machine.root.userData.workerSpot` (local x, z, yaw) with `pose: 'work'`. `root.userData.hand` is the
  carry bone if you want to attach a real item instead of the default carton.
* Vehicles: `speed` in m/s drives wheel spin; status `loading`/`unloading` opens rear doors / shutter.
* Storage crate: `progress` = fill ratio (0..1 → 0..8 cartons).
* `dispose()` frees per-instance GPU resources only; shared geometry/materials live for the session
  (`disposeMaterialLibrary()` / `clearGeometryCache()` exist for full teardown).

## 8. Naming

* Model ids: `bld_*`, `mach_*`, `veh_*`, `chr_*`, `prop_*` (snake case, as in content data).
* Files: one family per file (`machines/stations.ts`, `buildings/house.ts`, …); factories are
  `createXxx(opts)` registered in `index.ts`.
* Meshes are named `<part>:<material>` (e.g. `benchBody:satin`) so profiling tools show what costs what.
* Canvas textures: `sign:<key>` materials; per-instance materials set `userData.perInstance`.

## 9. How to add a model

1. Write `createFoo(opts): ModelInstance` in the right family file. Build static geometry with a
   `Builder` inside `cached('foo', () => …)`; use `box/boxB/span` (chamfer ≥ 1 cm on primary forms),
   `cyl/rod/lathe/sphere`, `add(…, geometry)`; colours from `PAL`.
2. Separate meshes only for parts that move (pivot `Group`s). Add a `StackLight(null, …)` +
   `stackHousing(b, …)` for machines, `contactShadow()` for anything standing on the ground.
3. `return makeInstance({ root, update, setCutaway?, extraDispose? })` — `update` must not allocate.
4. Register the id in `REGISTRY` (`index.ts`), add it to `CATALOG` in `gallery.ts` and the per-model
   list in `capture.mjs`, run the capture, look at the PNG, check `stats.json` against §6.

## 10. Honest self-review (current benchmark vs. the bar)

Review passes done: hero workshop ×3 (L1–L3, closed/cut away, day/night), robot cell ×2, full
library sheet ×1. Fixed along the way: washed-out exposure and flat front lighting (sun moved to
ESE, hemisphere lowered), sign hidden under the eave, accidental solid plate on the L3 office,
saw-tooth gable teeth floating in cutaway (moved to the roof group), robot cell reading as a dark pit
(lighter plinth, chunkier two-tone arm, camera-side fence opened to light curtains), pegboard dot
noise (1.2 k triangles of 1 cm dots replaced by grooves), budget overruns (auto chamfer / segment LOD
cut the store L3 from 30 k → 14 k and characters from 2.5 k → 1.4 k), a fragment-shader compile error
in the shared `glow` material (`vColor` is `vec4` in r187 → use `.rgb`).

**Where it meets the bar:** the cut-away workshop reads as a warm, coherent diorama at gameplay
distance; every machine has a distinct silhouette and a readable status beacon; materials are
consistent (31 shared), budgets are met, nothing is a plain cube — primary forms are chamfered and
layered (plinths, copings, frames, sills, rails, guards). Night mode (glowing windows, rooflights,
light pools, beacons) is the strongest look.

**Where it falls short / top 5 improvements still needed:**
1. **Characters** are rigid-segment toy figures (blocky hands, dot eyes, visible joint breaks at
   extreme poses). Next: weighted skinning at shoulders/hips/knees, mitten hands, a few hair/hat
   silhouettes per variant, secondary motion (head bob, box sway).
2. **Surface depth**: no ambient occlusion (only contact blobs) and few decals — big floors, yard
   slabs and roofs are clean flat colour. Bake per-vertex AO into the merged geometry (cheap, fits the
   pipeline) and add a decal set (floor zones, oil stains, roof weathering, painted bay numbers).
3. **Post / lighting**: no bloom or SSAO; status readability relies on additive halo sprites. A
   cheap bloom on emissives and a tuned night exposure would lift the premium feel; shadow map is a
   single 2048² cascade (soft but low-res at wide zoom).
4. **City-scale cost**: buildings are 35–45 draw calls, machines 9–20; fine for one factory interior
   but a full city needs per-model LODs (merge everything into 2–3 draw calls beyond ~40 m) and
   instancing of belts/props.
5. **Content depth**: houses are fixed set pieces (6 designs, no terrace tiling or corner variants);
   items inside machines are placeholders (packer drops a tinted box, the paint booth always shows a
   car body); cutaway assumes the default camera azimuth; the depot crane runs a canned loop rather
   than reacting to deliveries.
