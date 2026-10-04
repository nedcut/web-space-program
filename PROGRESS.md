# Progress Report

_Last updated: 2026-10-04_

## How to run
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation test suite
```
Dev shortcuts:
- `/?flight=stock-selene&scenario=moon` — start in low lunar orbit (`scenario=orbit`, `scenario=reentry` too)
- `/?flight=stock-meridian` — jump straight onto the launch pad (`stock-kestrel`, `stock-meridian`, `stock-selene`); `/?flight=stock-swift` puts the Swift jet on the runway
- `/parts-preview.html` — all parts on turntables (`?plume=1&pressure=0..1`, `?deploy=1`)
- `/map-preview.html?focus=saturn&dist=3e8` — solar system map
- `/planet-preview.html` — planet renderer test bench

## Flight controls
| Key | Action |
|---|---|
| W/S, A/D, Q/E | pitch, yaw, roll |
| Shift / Ctrl | throttle up / down; Z full, X cut |
| Space | stage (first press releases the launch clamps) |
| T / R | SAS / RCS toggles (SAS modes on the HUD panel) |
| I/K J/L H/N | RCS translation |
| M | map view (maneuver planner appears there) |
| ] | switch to nearby vessel (e.g. dropped stage) |
| F5 / F9 | quicksave / quickload |
| , . / | time warp down / up / stop |
| V | camera mode (auto / chase / free) |
| G / B (hold) | landing gear toggle / wheel brakes |
| Esc | pause menu |
| Mouse drag / wheel | orbit camera / zoom |

## Status
Milestone 1 (build → launch → orbit → Moon) is complete and verified. Beyond it: docking, aircraft, EVA, interplanetary.

| Area | State |
|---|---|
| Real solar system (Sun, 8 planets, Pluto+Charon, Ceres, 40 moons incl. 19 Saturnian) | ✅ |
| Scale presets (Standard 1/10, Challenging, Real) | ✅ |
| Orbital mechanics: Kepler, ephemeris, patched conics, SOI transitions, maneuver nodes | ✅ tested |
| Atmospheres (layered US-Std-76 for Earth; Mars, Venus, Titan, giants) | ✅ tested |
| Vessel physics: rigid body, fuel flow, pressure-dependent engines, Mach drag, lift, heating, chutes, legs, SAS | ✅ tested |
| 69 original parts with procedural PBR models + exhaust plumes | ✅ |
| World runtime: launch pad, physics ↔ rails warp, SOI changes, debris | ✅ (orbit reached in autopilot test) |
| Flight HUD, navball, staging, map view, maneuver planner | ✅ first pass |
| Procedural audio | ✅ |
| Vehicle Assembly editor (palette, snapping, symmetry, staging, Δv, stock crafts) | ✅ |
| Planet renderer: LOD terrain, atmospheric scattering, oceans, clouds, gas giants, Saturn rings | ✅ integrated in flight |
| Full Moon mission (launch → orbit → TLI → capture → landing → ascent → return) | ✅ verified by automated test |
| Flight assist: launch to orbit, execute node, land, circularize; transfer planner | ✅ |
| Save/load: persistent universe, autosave, quicksave F5 / F9, Continue | ✅ |
| Vessel switching (]) and recovery | ✅ |
| Re-entry plasma effect | ✅ (needs visual tuning on real GPU) |
| Launch complex scenery + 3D Space Center hub | ✅ |
| Tracking Station (fleet, body info, warp, fly/recover) | ✅ |
| Aircraft: jets + intakes, wheels/gear, SPH mode (mirror symmetry, CoL), runway, Swift jet (takeoff test) | ✅ |
| Rendezvous & docking: targets, closest approach, docking ports, merge/undock, docking alignment HUD | ✅ (`/?flight=stock-tender&scenario=rendezvous`) |
| Interplanetary transfers (Lambert/porkchop) + stock Saturn probe; Earth → Saturn orbit verified by test | ✅ |
| Crew roster + EVA: jetpack, walking on terrain, flags, boarding | ✅ (U = EVA, Enter = board, F = flag) |

See DECISIONS.md for choices made autonomously.

## Saturn / interplanetary flight

- `stock-ringrunner` / `buildRingrunner()` is a 26-part chemical Saturn probe (Chinook launcher, Foehn departure stage, Zephyr probe stage, tracking solar arrays and batteries), ~10.94 km/s staged vacuum Δv. Launch shortcut: `/?flight=stock-ringrunner`. Also `stock-swift` (jet, starts on the runway) and `stock-tender` (docking tug).
- The maneuver dropdown now includes sibling planets. `planTransferToBody` routes them to `planInterplanetaryTransfer(world, target, opts?)` in `src/game/interplanetary.ts`.
- Planner options: departure range / earliest + window, flight-time range (seconds), periapsis altitude, optional capture cost. Returns the maneuver, encounter patches/UT/periapsis, Δv, nominal Lambert arrival UT and capture estimate. Nodes are only added after a verified encounter; an unsuccessful search returns null. Departure requires a bound planetary orbit above the atmosphere.
- `planCourseCorrectionToBody(world, target, { arrivalTime, time?, periapsisAltitude?, maxDv? })` targets a planet from the heliocentric leg. Reuse the transfer's nominal arrival UT; execute corrections with `matchEnergy: false`.
- `porkchopGrid(world, from, to, departureRange, flightTimeRange)` returns row-major cells (`null` for singular cells). Ranges are `{ min, max, samples? }`, with absolute UT for departures and duration for flight times. Grid evaluation does not add nodes.
- `tests/world-saturn.test.ts` flies the stock probe through ascent, Earth parking orbit, injection, three cruise corrections, Saturn SOI entry, periapsis capture and two safe revolutions, entirely through the existing World/controllers/rails API. Typical standalone runtime: ~19 seconds. Inclined Earth → Mars/Jupiter/Saturn planner checks and Vallado / near-Hohmann / hyperbolic / long-way Lambert tests are included.
- Verified standard-scale mission: ascent 2626.69 m/s; parking 811.45; departure 2917.01; corrections 91.30 + 8.84 + 2.33; Saturn capture 3209.24. Nominal flight 942.78 days, departure wait 33.33 days. Arrival periapsis 1158.96 km; final bound orbit approximately 1029 × 1290 km above Saturn, eccentricity 0.0187, mass 2019 kg.
- Fixed `executeNode` failing to terminate an empty burn when no permitted stages remain. Shared simplex optimizer moved to `src/util/nelderMead.ts` (autopilot re-export retained). A small `world.ts` map-horizon extension uses the post-escape solar period so Saturn encounters remain visible; patched prediction skips only parking intervals proven safe by disjoint radial envelopes.
- Limits: impulsive planning, finite-burn corrections needed, synchronous search can pause UI for a few seconds, no gravity-assist or multi-revolution search, no direct moon departure, no Titan extension yet. Craft fuel margin and full mission verified in Standard only; rails power/thermal behavior remains the existing simulation model.

## Crew and EVA (2026-10-04)

- Human roster with seeded original names, courage/skill flavour stats, and procedural canvas portraits. Command pods fill automatically at launch/spawn; assignments remain on the actual pod through staging, docking, and undocking. Empty pods without a probe core display **No control** and reject input/staging.
- **U / Go EVA** transfers the selected astronaut outside the pod hatch to a separate 100 kg vessel and follows it with the camera. **WASD** moves, **Q/E** also strafe; in space **Shift/Ctrl** translate up/down using a finite 5 kg jetpack supply. On terrain **Shift** runs and **Space** hops. Mouse drag turns the camera/astronaut. **Enter / Board** boards a free hatch within 3 m (relative speed <3 m/s) and refills the suit. **F / Flag** plants a persistent flag while landed; the first lunar flag has a special message. B/G remain untouched for aircraft integration.
- Original procedural white/orange human suit, gold visor, backpack, animated limbs and jetpack puffs. Flags have an original agency graphic and use body-fixed coordinates with floating-origin rendering.
- World API: `crew`, `crewSeed`, `flags`, `assignCrew(v)`, `crewFor(v?)`, `canControl(v?)`, `hatchPosition(v,pod)`, `goEva(astronautId?)`, `boardingTarget()`, `boardEva()`, `plantFlag()`. Runtime additions: `PartState.crew`, `VesselState.eva`, `ControlInput.evaHeading/evaJump/evaRun`; `stepEva` and its constants are exported from the vessel API. `SavedWorld.crew/crewSeed/flags` are optional for version-1 compatibility. The hidden part is added only to `World.catalog`, not the editor catalog.
- Ten focused tests cover deterministic recruitment, hatch mass/COM/linear momentum, fuel-limited Δv, sustained lunar walking/hopping, hop edge latching, boarding/refill/rejection, empty-pod controls, dock/undock assignments, and save migration/roundtrip including flags. Final full suite passed: 31 files / 321 tests, including all 10 EVA tests. TypeScript and diff whitespace checks clean. SwiftShader screenshots checked orbital EVA and lunar walking/flag placement without page errors; the existing three.js shadow-map deprecation warning remains.
- Limits: suit refill uses abstract cabin supplies; crew mortality/recovery history is not yet modeled as roster statuses. EVA uses terrain capsule contact and ballistic/jetpack flight, without vessel-hull collisions, ladders, suit aerothermal damage, or life support. Hatch transfer conserves linear momentum/combined COM, not a detailed astronaut climbing animation or angular-momentum exchange. Large-body solar coordinates stay float64. The existing terrain mesh LOD can differ slightly from the analytic contact surface near flags/feet.
- Changes remain uncommitted. Flight `input.ts`, `controller.ts`, and `world.ts` edits are additive; adjacent required integration touched `FlightScene.tsx`, HUD/render registries, persistence, and vessel runtime/mass/clone exports.
