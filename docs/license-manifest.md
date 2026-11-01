# License and provenance manifest

## Shipped runtime dependencies (in the game bundle or native shell)

| Package | Version | License | Use |
|---|---|---|---|
| three | 0.187.0 | MIT | 3D rendering (plus addons: RoundedBoxGeometry, BufferGeometryUtils) |
| @fontsource/rubik | 5.3.0 | SIL OFL 1.1 | UI font (Latin + Hebrew). The OFL allows bundling, provided the fonts aren't sold on their own |
| @capacitor/core | 8.6.0 | MIT | Native bridge |
| @capacitor/app | 8.1.2 | MIT | Lifecycle (pause/resume/back) |
| @capacitor/filesystem | 8.1.5 | MIT | Reserved for native atomic file saves (not used yet) |
| @capacitor/android, @capacitor/ios | 8.6.0 | MIT | Native project templates |

## Build and test tooling (not shipped)

vite 8.3.5 (MIT), vitest 5.0.5 (MIT), typescript 7.0.2 (Apache-2.0), tsx 4.23.15 (MIT),
@capacitor/cli 8.6.0 (MIT). Playwright and Chromium were provided by the environment and are
used only for automated captures.

`npm audit` reports 4 moderate advisories (glob, minimatch, rimraf). They come only through
`@capacitor/cli`'s dev-time dependency chain, and nothing from that chain is in the game bundle.
The suggested fix downgrades the CLI to 4.x, a breaking change, so it was not applied.

## Original content created in this repository

| Asset class | Source | Provenance |
|---|---|---|
| 3D models (buildings, machines, vehicles, people, props, items) | `src/render/models/**` (procedural geometry in code) | Original. Details in `docs/licenses/art.md` |
| Music and sound effects | `src/audio/**`, `tools/audio/**` (synthesis code + scores as code), rendered files in `public/audio/**` | Original procedural synthesis, no third-party samples. Details in `docs/licenses/audio.md` |
| Game data, text, translations (EN/HE) | `src/content/**`, `src/i18n/**` | Original |
| UI icons | Rendered at runtime from the item 3D models, plus Unicode emoji/symbols drawn by the platform font | Emoji glyphs come from the OS font; nothing is bundled |

No assets were purchased, downloaded from asset stores, or taken from other games.
