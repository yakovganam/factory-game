# Art provenance and licences

Status: all 3D art in this repository is **original, procedurally generated in code**. No models, textures, HDRIs,
fonts or images were downloaded, purchased, traced or converted from third-party sources.

## What is in the library

| Asset class | Where | How it is made |
|---|---|---|
| Buildings, machines, vehicles, characters, props, items | `src/render/models/**` | Procedural geometry written for this project (chamfered boxes, extrusions, lathes, custom arc / frustum generators), merged per material at runtime. |
| Tiling textures (brick, concrete, wood grain, hazard stripes, corrugation / tile normal maps, solar cells, wire mesh, soft shadow falloffs, roller stripes) | `src/render/models/materials.ts`, `machines/docks.ts` | Drawn at runtime into `<canvas>` with the 2D API (`CanvasTexture`). Seeded PRNG, so they are deterministic. |
| Signage and liveries ("TOY WORKS", "TOY STORE", "IMPORT DEPOT", "FOR SALE", bus stop, danger plates, van/truck liveries) | `materials.ts` (`signMat`, `liveryMat`) | Runtime canvas text + simple vector icons (robot, gear, bus, lock, bolt, blocks, truck) drawn with canvas paths. All brand names are fictional in-game businesses. |
| Lighting environment | `src/render/models/lighting.ts` | three.js `RoomEnvironment` (a procedural scene) baked to a PMREM at runtime. No HDRI file. |
| Gallery captures | `captures/models/*.png` | Rendered by `tools/model-gallery/capture.mjs` from the code above. |

### Fonts

Sign text is drawn with the CSS font stack `'Rubik', 'Arial Rounded MT Bold', 'Helvetica Neue', 'DejaVu Sans', Arial, sans-serif`.
No font files are shipped by the art library. If the UI has already loaded Rubik (`@fontsource/rubik`, SIL Open
Font License 1.1, a project dependency), the signs use it; otherwise the platform's system sans-serif is used.
Glyphs are rasterised into textures at runtime and are not redistributed as font files.

## Third-party code used by the art library

| Package | Licence | Used for |
|---|---|---|
| three.js 0.187.0 (`three`) | MIT, © 2010–2025 three.js authors | Rendering, geometry primitives, materials. |
| three.js addons: `three/addons/utils/BufferGeometryUtils.js` | MIT (part of three.js) | `mergeGeometries` to merge static sub-geometry per material. |
| three.js addons: `three/addons/environments/RoomEnvironment.js` | MIT (part of three.js) | Procedural room used to build the image-based-lighting environment. |
| Playwright (pre-installed tool, not a project dependency) | Apache-2.0 | Headless capture script `tools/model-gallery/capture.mjs` (dev only, not shipped). |

No other third-party code, shaders or assets are used. The small shader patches (stack-light lens tiers,
vertex-coloured emissive "glow") are original and injected via `onBeforeCompile`.
