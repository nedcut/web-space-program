# Integration QA — cx/qa3

Worktree: `/home/nedcut/.t3/projects/wsp-wt/qa3`. Reviewed the combined planner, structural loads, scenarios, scale fleet, VFX/audio, flight records, sharing/library/photo and surface-feature merges. Main was merged through `f787707` in `8cd6d69`, including the separately owned Ringrunner Real repair.

## Findings and fixes

| Severity | Failure | Resolution / regression |
| --- | --- | --- |
| High | Quickload could fall back to another program when the selected program had no indexed slots. Deleting all slots could resurrect compatibility saves; New Game deleted a legacy quicksave before migration. | Restrict compatibility fallback to genuinely unmigrated legacy programs; an existing empty index stays authoritative. Preserve both old channels during New Game and keep unscoped legacy/dev quickload working. `sharing.test.ts`. |
| Medium | Docking rerooted the incoming tree but left accumulated structural fatigue on the old child, including the new docking latch. | Transfer fatigue with each reversed physical attachment; start the new latch without overload. Regression checks all old joints through merge and undock. `docking.test.ts`. |
| Medium | A tall rocket briefly settling after clamp release was recorded as a launch and soft landing, awarding Featherweight arrival. | Detect launch using bottom-of-hull clearance near the surface, rather than COM altitude. Real Meridian liftoff regression rejects false landing events and achievements. `liftoff-recorder.test.ts`. |
| Medium | Paused/photo frames re-enabled continuous flight audio immediately after React silenced it. | Silence every paused frame and clear the camera Doppler history; resume normal updates on exit. Reproduced before the fix. `flight-audio-integration.test.ts`. |
| Medium | Full multiplayer snapshots restored vessels but omitted flight records and the selected report. | Replace both fields with independent snapshot data. Combined persistence/replica regression verifies records, discoveries and fatigue alongside the older world extensions. `integration-qa.test.ts`. |
| Medium | Structural failures reached the recorder and sound but missed the VFX event dispatch. | Include structural failures in the shared burst-event predicate and use the smaller separation burst; World-driven breakup checks verify recorder and visual dispatch. `flightlog.test.ts`. |
| Low | Photo mode intercepted hard-coded P even after another action was rebound to P; photo/stress controls were absent from help. | Add photo mode to persisted bindings/conflict detection; camera entry/exit and photo hints honor live bindings. Add both actions to help. `input.test.ts`, `photo-mode.test.ts`. |

Additional regressions verify scenario/tutorial achievements persist independently while their original program/craft/records are restored, scenario loss is recorded and reload retains the completed pause, old saves acquire empty discovery/recorder defaults, and old settings get finite defaults for all added options. IndexedDB migration remains commit-before-delete and retry-safe. Worker UI is absent in multiplayer, assist entry rejects network worlds, and async plans cannot mutate server authority.

## Validation and browser evidence

Final validation on 2026-10-04 at merged source `8cd6d69`: `npm run lint`, `npx tsc --noEmit` and `npm run build` passed (existing bundle-size advisory). `npx vitest run --maxWorkers=2` passed **836 tests across 70 files in 237.62 seconds**, including Ringrunner Real. All **18 browser checks** passed (13 integration, three planner, two multiplayer), with **zero console errors**. An earlier final-suite attempt was terminated before its summary; these totals come from the completed retry. `git diff --check` passed.

The initial full run passed **830 tests** and failed only the explicitly excluded Ringrunner Real structural test. That run preceded the separate upstream repair and the final pad-settling regression. No test timeout, physics threshold or mission assertion was relaxed by this QA branch.

Playwright uses Chromium/SwiftShader at 1366×768, Low quality, half render resolution. Collaborative preview status/open were attempted first; localhost resolved to a Chromium error page, snapshot failed, and navigation/open retries against the environment address timed out. The user-requested local Playwright harness was used for reproducible coverage. Screen captures are software-rendered visual evidence, not laptop-GPU performance measurements. Simulation loops accelerate the long mission segments through public World APIs.

- `npm run dev -- --host 0.0.0.0 --port 5198 --strictPort`
- `node scripts/qa3-integration.mjs`: all five settings tabs; ten scenario briefings; hub photo/PNG; actual IndexedDB legacy migration, duplicate/search and scale badges; editor code→preview→import round trip; liftoff VFX/stress toggle; running and paused photo transitions; report charts/summary/achievements; named save/export; Ring Skimmer; Earth-return entry and touchdown; tutorial; Titan sea splashdown.
- `node scripts/qa3-planner.mjs`: real module-worker cancellation, unchanged nodes, successful Moon plan with fresh IDs and main-thread heartbeat, rendered progressive Saturn transfer grid.
- `HOST=127.0.0.1 PORT=8798 npm run server`, then `node scripts/qa3-multiplayer.mjs`: real room/probe ownership, authoritative comms, no photo entry, no planner/assist authority, snapshot flight records, single-player save isolation.

Reports and screenshots are in [`qa3/`](qa3/): [`report.json`](qa3/report.json), [`planner-report.json`](qa3/planner-report.json), [`multiplayer-report.json`](qa3/multiplayer-report.json). The export fixture is [`program.wsp-save.json`](qa3/program.wsp-save.json). Local command logs are ignored by Git.

Measured browser outcomes: 16-part Meridian remains intact during liftoff; a 909-character share code restores its complete editor craft; Ring Skimmer earns Gold with 0 m/s thrust Δv and about 0.17 m gap-center miss; Homeward survives >1,100 K skin heating and splashes down at 7.71 m/s; Hazewalker floats in Titan's Hydrocarbon Seas with all 19 parts and about 0.05 m/s settled surface speed. Photo UT is unchanged across the freeze. Worker cancellation keeps the old maneuver and a subsequent successful Moon transfer replaces it with a fresh ID while the browser timer continues.

## Remaining limits

- Fresh Chromium sessions emit pre-gesture AudioContext autoplay warnings (35 in the main run); the reports retain them. Runtime/console errors and framebuffer warnings are separately asserted absent. Audio graph/lifecycle is tested; subjective listening quality is not claimed.
- Titan surface placement is a short sea approach, not a flown Earth-to-Titan mission. Ring Skimmer and the Earth-return scenario are completed with accelerated real simulation. Full Grand Tour and all medal budgets have not been player-balanced here.
- Multiplayer browser coverage uses one actual local client; the unit/socket suite covers multiple clients. Multiplayer flight records update on full authoritative snapshots rather than every state delta, and the single-player Flight log UI is not exposed in rooms.
- The Low-quality Titan sea view remains very dark at local daylight, despite correct buoyancy, biome and achievement output; the screenshot records that limitation.
- High-quality rendering, physical laptop performance, and decorative landmark collision remain outside this pass. Landmarks use existing headless discovery/persistence tests; their meshes are intentionally decorative.

---

# Integration QA — cx/qa2

All implementation changes and evidence in this pass belong to `/home/nedcut/.t3/projects/wsp-wt/qa2`.

Final validation on 2026-10-04: `npx tsc --noEmit` passed; `npx vitest run --maxWorkers=2` passed all 673 tests across 50 files; `npm run build` passed (existing bundle-size advisory). All 24 Playwright checks passed: 13 integration, nine scenario and two multiplayer checks. All three browser reports contain zero console errors and zero warnings.

Measured outcomes: assist reached an 81.3 × 85.1 km Earth orbit; map dragging changed radial delta-v by 96.1 m/s and node time by −69.1 s without commanding attitude; the HUD dock ended at y=758 in a 768 px viewport and scrolled internally; Titan entry retained 19/19 parts and landed at 0.455 m/s. The multiplayer browser used one real local client; the existing automated suite exercises two WebSocket clients.

## Confirmed findings and fixes

| Severity | Failure | Resolution |
| --- | --- | --- |
| High | A client's persisted comms difficulty could disable control of a server-authorized sandbox probe. Practice lessons also inherited personal difficulty overrides. | Only single-player program worlds receive local comms overrides; server snapshots restore authoritative comms settings. |
| High | Tutorial buttons swallowed flight keys after Next, and stopped keyup propagation. | Non-activation keys and key releases reach flight input; Next/Skip release focus. Tutorial and EVA instructions show rebound keys. |
| Medium | A loaded world reused maneuver ID 1 and shared node objects with its saved snapshot. Editing/deleting nodes could affect the wrong node or saved practice/revert state. | Clone loaded nodes and restore the allocation counter above the largest saved ID. |
| Medium | Deserialization and cloning reset derived vessel bounding radii to zero. Docking range, camera framing and clearance checks depend on these. | Recompute load-time mass/bounds and retain clone bounds; deep-copy docking identity metadata. |
| Medium | Multiplayer deltas omitted cargo doors, drill deployment, converter state/core heat and docking rearm state; packed miners omitted changing resources. | Replicate these fields, send dynamic state for landed machinery, rebuild derived mass/bounds, and restore world extensions on full snapshots. Removed local targets are cleared. |
| Medium | Multiplayer prelaunch stepping released clamps before checking comms authority. | Gate inputs before the prelaunch branch, as well as during physics. |
| Medium | Gear/cargo-door commands were ignored on clamped vessels. | Apply authorized gear commands in prelaunch without firing a stage. |
| Medium | Turning off pitch inversion during flight left an earlier copy enabled. | Read the live setting as the sole source. |
| Medium | Optional mouse flight interpreted maneuver/camera dragging in map view as attitude input. | Disable mouse-flight input in map view. |
| Medium | Low resolution rounded the bootstrap framebuffer to zero before PMREM setup. SwiftShader emitted hundreds of invalid-framebuffer warnings. | Start with a valid 64 px buffer and keep actual buffer dimensions at least one pixel. |
| Low | Flight Data had no rebindable shortcut. | Add F3 to the central binding map and help; suppress it while paused, typing or in a settings/help modal. |

## Regression coverage

`tests/integration-qa.test.ts` covers combined world-extension roundtrips (comms, queued transmission, science data/credit, surveys, crew, flags, progression, targets and nodes), old-save migration, part modules through cloning/docking/undocking, mass and bounds, all 20 stock launches, unique catalogue/research placement, prelaunch controls, server comms authority and replica updates.

`tests/input.test.ts` adds live inversion, rebound EVA/gear/brake actions, tutorial binding labels and map/mouse-flight isolation. Existing suites cover relay geometry, ISRU conservation/heat/rails catch-up, fuel cells, crew transfers, staging, stock delivery hardware, real two-client WebSocket rooms, aircraft takeoff and Titan aerobraking.

## Reproducible browser checks

Run the local worktree server with `npx vite --port 5192 --strictPort`. The scripts use Playwright Chromium with SwiftShader at 1366×768 and write reports/screenshots here. Do not edit runtime sources during a run: Vite hot reload replaces tutorial/module state. Tests drive the exposed editor/flight objects and public scenario helpers to accelerate long simulations.

- `node scripts/qa-integration.mjs`: Saturn menu; settings tabs and key capture; Science/Career/Sandbox hub/editor paths; new stock designs; assist ascent; HUD overflow; map/node dragging; porkchop plot.
- `node scripts/qa-scenarios.mjs`: Training lessons 1–2; lunar EVA; docking; Moon rover; Moon mining; Titan entry/landing; Tracking comms overlay; Spacepedia.
- Start `HOST=127.0.0.1 PORT=8792 npm run server`, then `node scripts/qa-multiplayer.mjs`: room creation, probe launch/ownership, comms authority, hidden unsupported panels and single-player-save isolation.

Machine-readable `*-report.json` files record final assertions and console diagnostics. PNGs document the inspected views. Local `*.log` files retain command output and are ignored by Git.

## Limits and remaining work

- Browser rendering was checked using software WebGL and Low quality. This does not establish integrated-GPU performance or High-quality visual fidelity.
- Destination hardware was placed through public scenario APIs; complete Earth-to-Titan/Mars/Enceladus missions were not flown in this pass. Long flight segments use accelerated simulation rather than real-time waiting.
- The existing interplanetary encounter search remains synchronous and can pause rendering while a selected porkchop cell is verified.
- Landed-rails fuel-cell/RTG generation was resolved during main integration: power and machinery now share tank/deployment boundary events. Regression tests compare long catch-up against 50 Hz stepping, check physics/rails agreement, balanced fuel exhaustion, crossfeed isolation, and full-battery shutoff. Solar illumination and command-module electrical loads remain physics-only.

## UI polish follow-up

The pre-gesture audio and Low Titan sea leftovers from qa3 are addressed on `cx/uipolish`. See [the UI review](../screenshots/ui-polish/README.md) for all 72 before/after screenshots, reproduction scripts, browser interaction evidence and the merged 875-test result.
