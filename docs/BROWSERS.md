# Browser support and cross-browser testing

The game is developed in Chrome. This page covers what differs in Firefox (and Firefox forks such as Zen) and
Safari/WebKit, what was fixed, and how to re-check.

## Requirements

- **WebGL 2** (hard requirement). Without it the menus still work; the Integration Hall, flight and
  Fleet Tracking show a "3D graphics are unavailable" screen with fixes (current browser, hardware acceleration,
  `about:support` / `chrome://gpu`), and the main menu shows a warning. See `src/ui/browserSupport.ts`.
- Module workers, top-level `await` and ES2022: Firefox 115+, Safari 16.4+, Chrome/Edge 111+.
- Optional: Web Audio, IndexedDB, `localStorage`, GPU timer queries. Each fails safe (see below).

## Differences that mattered

| Area | Firefox / WebKit behaviour | Handling |
| --- | --- | --- |
| `AudioParam.cancelAndHoldAtTime` | Missing in Firefox | Fallback in `GameAudio.setMusic` (owner's fix, PR #1). Its exception blanked the whole app because the audio hook sits above the scene error boundary. |
| Any Web Audio error | — | `GameAudio` wraps every method, timer and listener: on an exception it logs `Audio disabled after an error`, disposes the graph and the game continues silently. |
| Errors outside the scene boundary | — | `RootErrorBoundary` (main.tsx) renders a store-free recovery page instead of a blank screen. |
| Blocked site data (cookie blocking, privacy extensions) | Any `localStorage` access throws `SecurityError` | `src/ui/storageGuard.ts` (first import of main.tsx) swaps in an in-memory Storage for the session and shows a notice. A full but readable store is left alone. |
| WebGL 2 limits under `privacy.resistFingerprinting` (Firefox, LibreWolf, Mullvad, some Zen setups) | Reports the spec minimums: 2048-px textures/renderbuffers, devicePixelRatio 2, minimum varyings | Part-heat shader passes a scalar slot instead of a `vec3` varying (physical materials were at the 15-vector limit: link failure). Flight and editor clamp the pixel ratio to the context's renderbuffer/texture size (`render/core/drawingLimits.ts`), which also protects 6K displays. Shadow maps in flight, Space Center and editor are capped to the same limit. |
| Cropped `ImageBitmap` → `texSubImage2D` | Firefox uploads from the source bitmap's first rows, ignoring the crop (Earth imagery became repeated Arctic rows: white, streaked Earth) | The decode worker hands Firefox plain pixel strips instead (next row); checked on Windows Firefox 143 |
| Canvas-backed `ImageBitmap` uploads | A bitmap copied through a 2D canvas is read back synchronously by every `texSubImage2D`: 5–16 ms per 1 MiB imagery strip, one strip per frame for ~10 s while Earth imagery streamed | `imageStrips.ts` returns tightly packed `Uint8Array` strips in Firefox (`getImageData` on a `willReadFrequently` canvas in the worker; masks keep only red, a quarter of the bytes). Uploads are plain shared-memory copies |
| `EXT_disjoint_timer_query_webgl2`, `KHR_parallel_shader_compile` | Not exposed by Firefox | Adaptive resolution falls back to frame intervals. Without parallel compile every program links synchronously on its first use, so programs that first draw mid-flight are a hitch: the cloud-field bake took 0.6–1.05 s about 20 s into a flight. Off-screen bakes/merges now register with `render/core/offscreenWarmup.ts` and compile behind the loading screen; no program links after loading in the orbit test. |
| `WEBGL_multi_draw` | Not exposed by Firefox (Windows 143 or Linux) | Terrain/ocean still use `BatchedMesh`: three's fallback draws chunk by chunk with one program setup and vertex array (2 GL calls per chunk instead of 4+) |
| Remoted WebGL | Every GL call is a command to Firefox's GPU process; per-call cost ~1.3–1.7× Chrome's, and the GPU process, not the page's main thread, can be the bottleneck (low "CPU" in F8 with dropped frames) | Fewer calls per frame: see "Firefox performance" below |
| `WEBGL_debug_renderer_info` | Firefox returns a generalised GPU name ("GeForce GTX 980, or similar") | GPU tiering still works on the vendor/family. |
| Wheel `deltaMode` | Firefox uses lines | Map, flight camera and editor already normalise. |
| Keys (Quick Find on `/`, Alt menu bar, F-keys) | Firefox defaults | Flight `keydown` handlers call `preventDefault` on bound keys; checked on Windows Firefox that Alt then T still reaches the game. |
| `requestIdleCallback` | Missing in Safari | Already guarded everywhere. |
| Canvas read-back under resistFingerprinting | Blank/randomised | The launch-site texture cache verifies read-back once and does not persist untrusted output. |

## Measured

- **Real Windows Firefox 143 (RTX 3060 Ti, ANGLE/D3D11)**, production build, Medium, 1600×915, adaptive off:
  ~59 fps, p95 16.8 ms, main-thread CPU ~6 ms/frame (render section ~4.5–5 ms). Chrome on the same machine:
  60 fps, CPU 3.6–6 ms (its window stayed smaller, 988×597, so GPU cost is not directly comparable).
  Firefox's WebGL is remoted to its GPU process, so its per-call CPU cost is roughly 1.3–1.7× Chrome's.
  On this PC Firefox's hardware vsync source runs at 30 Hz even on an empty page; the numbers above use
  `layout.frame_rate = 60`. This is an environment quirk, not the game.
- **Full flow on real Windows Firefox**: menu → New Game → editor (mouse orbit/wheel) → Launch → stage (Space/Z) →
  camera drag/wheel → orbit → map (M, wheel) → quicksave/quickload (F5/F9) → Space Center → Fleet Tracking →
  main menu → Continue/Load; no console errors.
- **Playwright Firefox 155 (Linux, llvmpipe), WebKit 26.6 (Safari proxy), Chromium**: `browser-smoke.mjs` passes,
  including Firefox with `privacy.resistFingerprinting` at Medium.

Screenshots: `docs/screenshots/firefox/`.

## Firefox performance (2026-10-08, `op/ffperf`)

Firefox executes WebGL in its GPU process, so judge it by GL calls per frame, frame-interval distribution and
hitches rather than the F8 "CPU" figure. Details and method: `docs/PERFORMANCE.md` → "Firefox / Zen pass".

- Steady orbit, Windows Firefox 143 in ASAP mode (`layout.frame_rate = 0`), Medium, 1600×915: GL calls per frame
  1,655 → 1,481, draws 221 → 212, mean frame interval −10 to −17% in three of four pairs (e.g. 6.70 → 5.56 ms,
  p95 9.1 → 9.0 ms), render submit −15 to −23%.
- Loading and the first 40 s of flight: frames over 100 ms after the loading screen 4 → 0 (the 0.9 s cloud-bake
  compile and imagery-streaming stalls are gone), frames over 40 ms 8–11 → 1–2.
- Re-entry no longer re-allocates the sky environment once a second.
- Test PC quirk: Firefox's vsync here is 30 Hz; use `layout.frame_rate = 0` for A/B timing
  (`scripts/windows-firefox/ab.mjs`), and `scripts/windows-firefox/timeline.mjs` with `GLCOUNT=1` to see which GL
  calls a slow frame made.

## How to run the smoke test

```sh
npx playwright install chromium firefox webkit       # once; Linux also: sudo npx playwright install-deps
npx vite --port 5328 --strictPort &                  # or: npm run build && npx vite preview --port 5329 --strictPort &
node scripts/browser-smoke.mjs --base http://localhost:5328            # all three engines (a few minutes, software GL)
node scripts/browser-smoke.mjs --browsers firefox --quality medium \
  --firefox-prefs '{"privacy.resistFingerprinting":true}' --verbose     # hardened Firefox
```

It clicks through menu → New Game (Sandbox) → Integration Hall → Launch → stage, then
`?flight=stock-meridian&scenario=orbit` → map view, and fails on page errors, unhandled rejections, console errors,
failed requests, WebGL error warnings, programs that did not link (queried directly, so production builds where three
skips shader checks are covered) and audio fail-safe warnings. Headless Firefox has no WebGL on Linux, so without a
`DISPLAY` the script runs it headed under Xvfb (install `xvfb`). It is not part of `npm test` (minutes per engine).

Real Windows browsers: `scripts/windows-firefox/{flow,perf}.mjs` drive installed Firefox/Chrome over WebDriver BiDi
with puppeteer-core installed on the Windows side (instructions in the file headers).

## Caveats

- The opt-in Ultra preset bakes 4096-px planet textures; on contexts limited to 2048 px (resistFingerprinting) choose High or lower.

- Real Safari on macOS was not tested; WebKit on Linux is a proxy (different GPU backend, no Metal).
  Firefox on macOS draws WebGL through Apple's OpenGL driver rather than ANGLE/Metal, which was not tested either.
- Under resistFingerprinting, canvas read-back is blanked. The launch-site texture cache checks read-back once and
  stops persisting (textures are regenerated each visit instead); editor part thumbnails can still be blank.
- Low-power modes that cap rAF at 30 Hz make adaptive resolution try lower scales; its episode guard restores the
  scale when that does not help.
