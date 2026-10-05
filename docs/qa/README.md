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
