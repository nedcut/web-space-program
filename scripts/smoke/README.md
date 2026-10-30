# Maintained production browser smoke

`npm run build && npm run test:browser` (first install: `npx playwright install --with-deps chromium`).
The runner owns Vite preview on 127.0.0.1:5586; do not start another server there.
Chromium/ANGLE SwiftShader, Low quality, fresh browser storage per test, one worker,
no retries, 30fps rendering cap. This is a functional regression guard, not a GPU performance benchmark.

Named steps across five isolated tests cover startup, Sandbox hub, stock editor/Δv/toolbar at 1366×768
and 1920×1080, keyboard launch/ascent, map round trip, first training lesson,
challenge launch, settings/UI scale, persistence/reload, and Spacepedia.
Programs currently use localStorage; saved craft use IndexedDB. The persistence
check exercises both, without replacing the application's storage implementation.

Every test records page exceptions, console errors and WebGL diagnostics (including
production shader link status and context loss). Only the documented pre-gesture
AudioContext warning is allowed. Compositor PNGs are decoded to sample pixels:
more than 20 of 2304 samples must exceed near-black (15/255), and brightness
spread must exceed 10/255. These deliberately broad bounds catch blank rendering,
not changes in art. Flight and map have explicit canvas checkpoints too.
Failure screenshots and traces are in `test-results/`; `playwright-report/` has
the HTML report (`npx playwright show-report`). CI uploads both on failure.

Overlapping one-off coverage, retained for the owner to review:
- `scripts/browser-smoke.mjs`: Chromium main route/map; retain its Firefox/WebKit use.
- `scripts/qa-integration.mjs`, `scripts/qa3-integration.mjs`: menu/settings,
  Sandbox/editor/stock load/launch/save overlaps only; their deeper scenarios remain useful.
- `scripts/ui-polish-browser.mjs`: menu/settings/editor smoke overlaps.
- `scripts/ui-polish-shots.mjs`, `scripts/ui-polish-details.mjs`: basic scene-load
  checks overlap; art screenshots and other scene-specific probes are not replaced.
