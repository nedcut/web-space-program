# Browser support and cross-browser testing

The game is developed in Chrome. This page covers what differs in Firefox (and Firefox forks such as Zen) and
Safari/WebKit, what was fixed, and how to re-check.

## Requirements

- **WebGL 2** (hard requirement). Without it the menus still work; the Vehicle Assembly, flight and the
  Tracking Station show a "3D graphics are unavailable" screen with fixes (current browser, hardware acceleration,
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
| `EXT_disjoint_timer_query_webgl2`, `KHR_parallel_shader_compile` | Not exposed by Firefox | Already optional: adaptive resolution falls back to frame intervals; three compiles synchronously behind the loading screen. |
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
  camera drag/wheel → orbit → map (M, wheel) → quicksave/quickload (F5/F9) → Space Center → Tracking Station →
  main menu → Continue/Load; no console errors.
- **Playwright Firefox 155 (Linux, llvmpipe), WebKit 26.6 (Safari proxy), Chromium**: `browser-smoke.mjs` passes,
  including Firefox with `privacy.resistFingerprinting` at Medium.

Screenshots: `docs/screenshots/firefox/`.

## How to run the smoke test

```sh
npx playwright install chromium firefox webkit       # once; Linux also: sudo npx playwright install-deps
npx vite --port 5328 --strictPort &                  # or: npm run build && npx vite preview --port 5329 --strictPort &
node scripts/browser-smoke.mjs --base http://localhost:5328            # all three engines (a few minutes, software GL)
node scripts/browser-smoke.mjs --browsers firefox --quality medium \
  --firefox-prefs '{"privacy.resistFingerprinting":true}' --verbose     # hardened Firefox
```

It clicks through menu → New Game (Sandbox) → Vehicle Assembly → Launch → stage, then
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
