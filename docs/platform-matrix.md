# Platform verification matrix

The states are separate: **Implemented → Builds → Installed → Tested → Release-ready**. A
platform only counts as being at a state if that state was actually observed. "Unverified"
means nobody has checked it.

| Platform / browser | Implemented | Builds | Installed | Tested | Release-ready | Evidence / blocker |
|---|---|---|---|---|---|---|
| Web — Chromium 153 headless (Linux, SwiftShader) | ✅ | ✅ `npm run build` | n/a | ⚠️ Automated only: in-engine screenshots + console-error capture | ❌ | `captures/gameplay/report.json`. Software rendering, so no GPU or performance evidence |
| Web — desktop Chrome (GPU) | ✅ | ✅ (same bundle) | n/a | ❌ Unverified | ❌ | Needs a manual run on real hardware |
| Web — desktop Edge | ✅ | ✅ | n/a | ❌ Unverified | ❌ | — |
| Web — desktop Firefox | ✅ | ✅ | n/a | ❌ Unverified | ❌ | Playwright Firefox isn't installed in this environment |
| Web — desktop Safari | ✅ | ✅ | n/a | ❌ Unverified | ❌ | Needs macOS. M4A music fallback is provided for Safari |
| Web — Android Chrome | ✅ | ✅ | n/a | ❌ Unverified | ❌ | Needs a device |
| Web — iOS Safari | ✅ | ✅ | n/a | ❌ Unverified | ❌ | Needs a device |
| Android app (Capacitor 8.6, Gradle) | ✅ project generated (`android/`) | ❌ **Blocked** | ❌ | ❌ | ❌ | `./gradlew assembleDebug` fails: `dl.google.com` (Android Gradle Plugin + SDK) is denied by the network policy (HTTP 403). Unblock: allow `dl.google.com`, or provide an image with the Android SDK |
| iOS / iPadOS app (Capacitor 8.6, Xcode, SPM) | ✅ project generated (`ios/`) | ❌ **Blocked** | ❌ | ❌ | ❌ | Needs macOS + Xcode (not available) and Apple signing credentials (not provided) |

## Build commands

```bash
npm run build
```

`npm run build` writes the web bundle to `dist/` (static files you can host anywhere; the base
path is relative).

```bash
npx cap sync
```

`npx cap sync` copies `dist/` into the native projects.

```bash
cd android && ./gradlew assembleDebug
```

`./gradlew assembleDebug` builds the debug APK and needs Android SDK access. A release `.aab`
needs a signing keystore, which isn't provided.

```bash
npx cap open ios
```

Run `npx cap open ios` on macOS, then build, sign and run from Xcode.

## Minimum devices

**Not established.** Minimum device tiers must be measured on real hardware: a mid-range Android
phone, an older iPhone, and a low-end tablet. The brief's provisional targets are 30 FPS stable
on mid-range phones and 60 FPS on strong devices, and they remain open.
