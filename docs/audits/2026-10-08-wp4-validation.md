# WP4 mission planning validation — 2026-10-08

Branch `cx/wp4`, based on `99138f6e4455da7675cd43dbcadbdb0bd03be24a`.
Scope comes from [the veteran audit](2026-10-07-veteran-gap-audit.md), items 9–10 and WP4.
No push or merge; the implementation builds on the transfer search and maneuver executor already on main.

## Delivered

- Local maps enter centred on the active body, frame the active orbit, expand during a burn when necessary,
  and offer separate active-orbit and whole-transfer framing controls. Local views hide small-body labels,
  orbits and the asteroid field, except for a targeted/focused small body. The numerical map also preserves
  frozen maneuver anchors, including after node time.
- A fleet alarm panel provides custom reminders and automatic node/SOI alarms. Saves preserve them;
  rails advancement stops at the deadline, physics warp checks every 20 ms, and unattended Tracking Station
  advancement also stops. Warp-to/coasting assists respect the stop. Powered assists continue safely at 1×.
- A lazy planner worker predicts unpowered landing/re-entry using the actual vessel drag, heating, attitude,
  armed chute and contact physics. The map shows the drag-integrated line and impact; flight shows a projected
  surface marker. Hold-attitude, surface-retrograde and off controls state the prediction's assumptions.
- Retained the existing selectable next-window list (wait and Δv), with a clearer “now · next orbit, plane
  change if needed” option. Planning keeps the local map; whole-transfer framing is explicit. The signed
  countdown typo was already fixed on main.
- Retained the existing staging-aware, burn-leading, fine-trimming executor and its frozen plan. Explicit
  assist cancellation now restores temporary engine limiters through `Autopilot.release()`.

## Logic and build evidence

- The seeded 120 km Standard-scale capsule/chute re-entry predicts splashdown at T+443.9 s; actual flight
  splashes at T+444.0 s. Body-fixed miss: **0.9 m**, against the audit's 5 km requirement; 15,142 physics
  steps. This validates the same physics under the documented unpowered/retrograde/chute assumptions.
- Existing `assist-node.test.ts` exercises three stock-Selene orbital phases, asserting automatic staging,
  first thrust before the node, residual below 3 m/s, encounter periapsis error below 10 km, limiter restoration,
  and a clean 1× physics handback. These tests pass with the new alarm clock.
- New alarm tests cover rails and physics warp, consecutive reminders, node edits/removal, saved fleet alarms,
  cached SOI events, warp-to/assist behavior and unattended advancement. Crossing error is below 1 s.
- The real-scale 200 km LEO → Moon window test checks departure near the known 3.13 km/s Hohmann value,
  an approximately five-day coast, and a next-orbit option. Existing Earth → Mars Lambert/SI tests remain.
- Driver tests verify no worker for a safe orbit, one Earth-grid upload, no duplicate in-flight request,
  rejection of a stale burn result, and disposal. Numerical anchor and map framing/filter tests pass.

`npm run lint` (including simulation layering), `npm run typecheck`, and `npm run build` pass.
Final `npx vitest run --maxWorkers=4`: **142 files, 1,446 tests passed, one skipped**, 190.98 s,
including the final drag-path draw-order change. Logs: `/tmp/wp4-{lint,typecheck,build}-visual.log`,
`/tmp/wp4-full-final.log`.

## Performance design and reproducibility

There is no atmospheric integration or transfer search in the animation loop. Landing eligibility is checked
at 1 Hz, prediction submits at most once per 5 s, and only one job is active. The persistent worker uploads the
Earth grid once, analytically coasts above atmosphere/terrain, and yields after 100 physics steps or an 8 ms
soft budget. Results/markers are cached; the map's single extra line rebuilds only for a new prediction.
The flight surface marker updates at 4 Hz. Main-thread submission and worker total/chunk durations are exposed
on `controller.mapUi.landing` for measurement.

Alarm SOI deadlines reuse existing world trajectory/event caches. Steady synchronization and the cached
deadline check took **0.000047 ms/call pair** in a one-million-iteration Node probe with 200 alarms and one
unchanged node. This is an isolated steady-path measurement, not a browser frame-time or Apple claim.
Reproduce with:

```sh
node --import tsx --import ./scripts/earth-data/register.ts scripts/wp4-planning-bench.ts
```

`scripts/wp4-baseline.config.ts` provides a read-only source overlay of the pre-WP4 commit for paired builds.
`scripts/windows-firefox/wp4.mjs` records LEO, a short mid-injection burn and lunar orbit, plus the after-build
alarm and re-entry flows. All real browser runs use ports 5441/5442 and `flock /tmp/wsp-gpu.lock`.
Captures and traces stay outside git.

## Real browser evidence

Real Windows Chrome / RTX 3060 Ti, Medium, 1600×900 CSS: baseline DPR 2 and after DPR 1 captures completed
with no page/console errors. The after-build camera focus equals the active body's Float64 position in LEO,
mid-injection and lunar orbit. The live orbit remains visible and Bennu is absent in all three after images.
The custom alarm records `held: true`, `warp: 0`. These are functional captures; comparison at matching DPR
is still pending, so the different-DPR timings are not presented as a paired GPU improvement.

The after re-entry worker produces an impact path (19,782 physics steps) in 1,661.3 ms off the main thread;
the largest yielded chunk is **14.6 ms**, and first main-thread submission is **14.4 ms**. Safe-orbit scenes
record no worker submission. All three steady map scenes retain 92 shader programs, matching the baseline.
Calls are 32/46/32 before and 20/34/20 after for LEO/burn/Moon; filtering removes 12 draws.
The capture records two **157/128 ms** application long tasks around the re-entry transition. Their causes
are not proven by this probe; submission/chunk measurements alone do not establish a hitch-free app.

Artifacts: `/home/nedcut/.t3/projects/wsp-traces/wp4/{before-dpr2,after-dpr1}/`.
Each directory contains `leo.png`, `mid-tli.png`, `moon.png`, `report.json`, raw screencast frames with timestamps
and `video.mp4`. The after directory also contains `alarms.png`, `surface-marker.png` and `reentry-map.png`.
The first flight screenshot's landing point is outside the camera view; a near-surface visible-marker check
was added to the driver. The final drag-line draw-order fix follows this first capture and is being recaptured.

## Limits / review still required

- Prediction assumes no future burn, staging or chute-arm command. Changed thrust, vessel, body, stage or
  attitude invalidates displayed results. A bounded horizon/escape/breakup returns a partial path, not an
  invented landing. There is no future control-program optimizer or uncertainty corridor.
- Alarm storage is bounded to 200 entries. SOI reminders follow the existing cached prediction and are updated
  when the plan changes; they are not an independent continuous fleet trajectory search.
- Shared Windows/RTX browser evidence cannot establish M-series MacBook, Zen/macOS or 120 Hz performance.
  Owner/reviewer video review and real Apple testing remain necessary.
