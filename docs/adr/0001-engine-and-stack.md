# ADR 0001 — Engine and technology stack

Status: **Accepted (for now)**. Date: 2026-11-01.

## Context

The production brief says to use a supported, stable Unity 6 release with C# and URP **unless**
an existing working implementation, or a measured prototype on the target platforms, justifies a
different engine.

What we found in the environment on 2026-11-01:

| Check | Result |
|---|---|
| Existing project | Empty repository (README + .gitignore only). Nothing to preserve or migrate. |
| Unity Editor / Hub | Not installed. `download.unity3d.com`, `public-cdn.cloud.unity3d.com` and `services.api.unity.com` are **denied by the environment network policy** (HTTP 403 at the egress proxy). |
| Unity licence | Unity needs a Unity ID licence (even Personal) before it can build in batch mode. We have no credentials, and the brief forbids using credentials without authorisation. |
| Android SDK | `dl.google.com` is denied, so the SDK, build-tools and platform images can't be downloaded. Java 21 and Gradle 8.14.3 are present, and `maven.google.com` is reachable. |
| Apple toolchain | Linux container. There is no macOS or Xcode, and no Mac build worker is reachable. |
| Web toolchain | Node 22.23, npm registry reachable, Chromium 153 + Playwright pre-installed, WebGL2 available headless via SwiftShader, ffmpeg with Vorbis/Opus/MP3/AAC. |

With Unity we could write C# but never compile, run, play, profile or screenshot it. That
conflicts with the brief's central rule: build, run, observe and verify, and don't count static
code as proof that anything works.

## Decision

Build the game as **one TypeScript code base** that is rendered with **Three.js (WebGL2)** and
bundled with **Vite**. Ship to native mobile through **Capacitor**, which wraps the same build
output.

* Web: a real game running locally in the browser (no streaming).
* Android: a Capacitor Android project (Gradle). It builds when the Android SDK is available.
* iOS/iPadOS: a Capacitor iOS project (Xcode). Compiling, signing and installing it need macOS,
  Xcode and Apple credentials.

Pinned versions (exact, in `package.json`): three 0.187.0, vite 8.3.5, typescript 7.0.2,
vitest 5.0.5, tsx 4.23.15, Capacitor 8.6.0 (core/cli/android/ios), @capacitor/app 8.1.2,
@capacitor/filesystem 8.1.5, @fontsource/rubik 5.3.0 (SIL OFL 1.1).

## Architecture rules that keep the decision reversible

1. `src/sim/` is pure TypeScript with no DOM, Three.js or platform imports. It is deterministic
   and seeded, keeps money in integer cents, and avoids transcendental math (`Math.exp`/`pow`/`sin`
   give different results on different JS engines).
2. `src/content/` holds plain data under a typed schema. It can be exported to JSON for any engine.
3. Assets come from reproducible generator scripts (procedural meshes, offline-rendered audio) and
   are kept with their sources. The generated glTF/OGG/MP3 files are engine-neutral.
4. Simulation threading is not required. Web Workers may be used for optional off-main-thread
   catch-up, and a main-thread fallback must always exist.

If a Unity licence and build machine become available later, we can port the simulation and data
by translating `src/sim` to C#. The determinism tests in `tests/` are the equivalence spec for that
port.

## Consequences and risks

* A WebView-hosted game on mobile is a legitimate shipping technique, but it isn't a Unity native
  player. GPU and thermal performance must be **measured on real devices** before we set minimum
  device tiers. We can't do that in this environment.
* SwiftShader frame times are software-rendered and **are not GPU performance evidence**. We use
  them only to compare relative cost and catch regressions.
* Safari/WebKit WebGL2 quirks must be tested on real Apple hardware. Until then that status stays
  unverified.

## Unblocking actions for the owner

* Allow `dl.google.com` in the environment network settings (or provide an Android SDK image). An
  unsigned debug APK can then be built here.
* Provide a macOS build worker with Xcode, plus Apple signing credentials, for the iOS build.
* If you want Unity regardless, allow the Unity hosts and provide a licence. We would then
  reconsider this ADR with a measured comparison.
