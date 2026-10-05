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
| Esc | pause menu (recover, revert to launch/editor, quickload, settings) |
| F1 / ? button | controls cheat sheet (shown automatically on the first flight) |
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
| 153 original parts with procedural PBR models + exhaust plumes | ✅ |
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

## Science and Career (2026-10-04)

- New Game offers Sandbox (default, all equipment/no costs), Science (research progression), and Career (research, credits/reputation, commissions). Mode and progression survive Continue, quickload, scene changes and version-1 serialization; saves without the new fields remain sandbox. New programs immediately autosave and clear the previous editor craft. Revert restores and saves the preflight economy as well as the vessel snapshot.
- Deterministic biomes use terrain height, slope, latitude and albedo: seven Earth regions (including Launch Complex), four Moon, five Mars, three Titan, generic solid-body regions, and atmospheric bands for giants/stars. Situations: landed, splashed, flyingLow (<25% atmosphere height), flyingHigh, spaceLow (<max(2×atmosphere height, 25% radius)), spaceHigh. The terrain API is shared with collision/rendering.
- Six original radial instruments: Ember temperature probe (8 base science), Isobar pressure capsule (10), Tremor seismic sensor (18), Flux magnetometer boom (16), Contour gravity gradiometer (22), Patina material exposure bay (25). Occupied command pods provide crew observations (8); landed EVA provides surface samples (30). Body multipliers: Earth 1, Moon 3, Mars/Venus 4, Jupiter moons 7, Saturn moons 9, remaining bodies 6. Repeats multiply by 0.5; values below 0.01 are exhausted. Availability/biome dependency varies by experiment; pressure requires an atmosphere.
- Thread aerial and Lattice relay credit 40% / 65%. Data stays with hardware, so returning it to Earth credits the remaining value. An observation can be stored once per subject per vessel; the archive tracks all runs and actual credited science. EVA samples transfer on boarding. New instrument meshes have mount faces verified by existing mesh tests.
- Research & Development: six connected technology paths, 25 nodes including free First Principles (16 starter parts); subsequent tiers cost 10 / 35 / 90 / 180 science per node. Node selection shows equipment, prerequisite and affordability; Science Archive lists subjects, situations, runs and credit. Editor palette and part picking hide/gate locked equipment; loaded designs are checked again at launch. Career launch button shows cost. Hub shows balances and research/mission tiles.
- Career starts with 60,000 credits and 0 reputation/science. Three seeded contract kinds: orbit, surface-and-return, biome survey. Three active maximum; 20-year deadlines; advances, rewards, expiry/abandonment penalties, and progress/completion messages. Target pool expands after first Moon landing. A return requires actual expedition hardware or a boarded expedition astronaut. First Earth orbit / Moon landing / Saturn entry award one-time science, plus funds/reputation in Career. Refunds range from effectively 100% at the complex to 20% on the far side of Earth; only paid surviving parts count. Flight, Tracking Station, and launch-site clearance use the same settlement. Prelaunch science can be recovered directly.
- API: `new World(universe, catalog, ut, mode?)`, `world.progression`, `scienceContext`, `scienceInstruments`, `runExperiment(uid, experiment)`, `transmitScience`, `unlockTech`, `refreshContracts`, `acceptContract`, `abandonContract`, `recoverVessel(id)` / `recoverActive`. Event entry points: `onReachedOrbit`, `onLanded`, `onEnteredSoi`, `onScienceCollected`, `onRecovered`, plus `emitProgress`. Persistence: optional `SavedWorld.mode/progression`; `PartState.scienceData/visitedBodies/purchaseCost`. New scenes `research` and `missions` support the existing `?scene=` hook.
- Verification: `tests/science.test.ts` adds 14 focused tests covering named-biome coverage/determinism, all-body/scaled situations, science decay/subjects, transmit/recovery idempotency, EVA boarding and detached instruments, complete tech assignment/editor gates, launch costs/refunds, contract event completion/deadlines/return provenance, rails milestones, and legacy/career save round trips. Full suite: 35 files / 397 tests. TypeScript and production build checked. Browser checks through `scripts/shot.mjs` at localhost:5173 covered mode choice, career creation/autosave, mission acceptance, research graph, flight Run/Transmit/Review and biome contract completion. Screenshots are in `/tmp/wsp-new-game.png`, `/tmp/wsp-research-career.png`, `/tmp/wsp-missions.png`, `/tmp/wsp-science-flight.png`. A complete UI pass also verified the initial career launch debit, full recovery credit/refund, research spending, autosave and Continue (`/tmp/wsp-career-flow.png`). Existing three.js shadow-map deprecation warning and the production three.js chunk-size warning remain.
- Limits: transmission is instant with no charge draw, range, line-of-sight, relay routing or data mass. Contract refresh is manual; no part-testing, rescue, or agency variety. Research tiers are cost/category based and balance has not been playtested through a complete career on every scale. Biomes approximate the procedural terrain rather than authoritative geographic maps. The science panel uses the existing desktop HUD layout. No commits made; adjacent integration includes render mesh registry, vessel clone/runtime types, tracking recovery and editor toolbar.

## Planet visual polish (2026-10-04)

- Saturn's rings now resolve into deterministic camera-local instanced ice chunks with two geometry LODs, opacity-profile gaps, a dithered range fade and a near-plane adjustment for flight through the ring plane. Ring lighting includes forward scattering and warm planetshine. Instance translations remain local and float32-safe.
- Gas giants have turbulent bands, a softened Great Red Spot-like storm, Saturn's north-polar hexagon/vortex and Neptune's irregular dark spot. Enceladus has south-pole jets, Io has volcanic plumes, Titan has layered amber haze and a detached cool limb layer, and Europa has warped, scalloped lineae.
- Earth gains an organized cloud cyclone, procedural coastal night lights and subtle auroral curtains. The resolved Sun has granulation, spots, limb darkening and a corona; glare fades as the photosphere resolves. Parent planets provide phase-dependent tinted illumination to moon surfaces in the same scene. Low disables resolved ring chunks, volume effects, emission and planetshine.
- Merged main through f77318c, preserving surface scatter, graphics settings and both sides of the progress/decision logs. Final post-merge TypeScript passed; Vitest passed all 45 files / 633 tests with `--maxWorkers=2`. Six focused tests cover ring determinism/gaps/floating-origin placement, reflected-light phase, Low quality, scene isolation and disposal.
- Browser verification caught and fixed the volume shader using an obsolete logarithmic-depth define; front-of-volume depth now works with the installed three.js, including aurora above the visible night surface.
- Capture parameters and visual-model limits are documented in `docs/screenshots/planet-polish.md`. Ring chunks are visual scenery with no collisions; settlement lights follow procedural land rather than real cities; parent planetshine requires the parent renderer to be live in the same scene.

## Communications network (2026-10-04)

- Added a DOM/three.js-free solver in `src/sim/comms/network.ts`: geometric-mean range, all-body sphere occlusion, smooth signal falloff, strongest-path multi-hop relay routing, and one-way light-time delay.
- Three body-fixed Earth stations and four rated antennas, including the new original Arcwatch Relay Dish and Horizon Relay Reflector with procedural meshes. World adapter/cache keeps ephemeris and catalogue handling outside the pure solver.
- Science/Career default on; Sandbox default off. Persistent Settings overrides control network difficulty and disconnected probe restrictions. SavedWorld carries resolved settings and pending transmissions, with backward-compatible mode defaults.
- Probe signal loss blocks throttle, staging and manual input while retaining SAS attitude hold; crew keeps local control. Science transmission requires a route and progresses at signal-scaled speed, pauses during outages, and survives save/load without duplicate credit. Network-disabled mode retains instant transmission.
- Flight HUD shows four bars, route names, percentage, one-way delay and “No signal”; flight map and Tracking Station offer a persistent link overlay toggle, with red-to-green strength colouring and floating-origin line coordinates.
- Added nine communications tests covering range/falloff, Earth/other-body occlusion, lunar far-side relay service, no forwarding through direct aerials, strongest routes, default/persisted settings, Earth station rotation, launch links, control gating/SAS/crew, and transmission interruption/save/resume. Existing science lifecycle tests explicitly exercise network-disabled instant transmission.
- Limits: spherical occlusion (no terrain shadows), abstract antenna power/deployment, no command-delay queue. Rails transmission catch-up is conservatively capped to one graph interval per update. A queued job belongs to a vessel ID; absorbed/destroyed vessels lose their job, but their part-owned partial science credit remains valid and can be retransmitted after docking/staging.

- Resume completion: merged `main` through `6c7852d`, preserving the new flight dock, help/pause/loading flow, editor improvements and craft persistence. Signal status occupies the scrollable dock; transmission status distinguishes an outage from active sending. Disconnected directional SAS falls back to attitude hold. Added a two-relay chain/removal regression.
- Verification after merge: `npx tsc --noEmit` passed; `npx vitest run --maxWorkers=2` passed all 36 files / 410 tests (including both new relay mesh contracts); `git diff --check` clean. Vite served port 5184 and local HTTP returned 200, but the T3 collaborative browser could not reach the server (connection refused at localhost; environment IP timed out), so resumed visual verification was unavailable.
## Experimental LAN multiplayer (2026-10-04)

- Opt-in main-menu connection screen, room codes, four-player authoritative Node/ws rooms, 50 Hz simulation, 10 Hz deltas and ~30 Hz inputs. Ownership, pad/runway launch queues, consensus warp with limiting-pilot HUD, player list/chat/name tags, authoritative staging/docking/EVA actions and disconnect cleanup are implemented.
- Controlled-vessel prediction/reconciliation and remote interpolation reuse a transport-free replica. Single-player remains the default; network mode isolates local saves and disables local world mutations through recovery/science/assist panels. Run instructions and prototype limitations are in MULTIPLAYER.md.
- Tests cover protocol validation/roundtrip, two in-process replicas, ownership and stale inputs, launch queues, consensus/safety warp, docking/undocking, interpolation, bounded reconciliation error and two actual WebSocket clients. Integration also changes World stepping, flight/controller/UI entry points, package dependencies and TypeScript server inclusion.
- Resumed from WIP `855384f`, merged main's flight loading/help/pause/HUD dock and editor/menu UX changes, preserving both single-player behavior and multiplayer authority. Moved the multiplayer panel clear of the new left HUD dock; vessel viewing cannot redirect the controls of an owned vessel. Final required checks: `npx tsc --noEmit` passed; `npx vitest run --maxWorkers=2` passed all 37 files / 409 tests (including 12 multiplayer tests). Server CLI startup verified. Browser UI validation remains unverified because the collaborative preview's localhost reached a different application's environment.
## Expedition parts expansion (2026-10-04)

- Added **59 original parts** (153 catalogue entries total), all with procedural meshes and exactly one research assignment. New meshes stay below 9,000 triangles; the largest is the four-bell Monsoon at **8,144 triangles**. Explicit expansion tiers preserve the original catalogue's research placement.
- Five metre hardware: Cistern 5-25/5-50/5-100 tanks, Monsoon Heavy Cluster, Bellmouth 375-500 adapter, Breakwater 500 decoupler, Cinder 500 heat shield and Spire 500 nose cone.
- Propulsion: Hearth LF-only nuclear thermal drive (850/185 s), Mistral/Boreal methalox engines, Needle annular aerospike (340/330 s), Dewdrop monoprop maneuver engine, Reed/Furnace large SRBs, Candle vacuum kick motor, Spray/Rill radial engines. Fuel resources retain the existing abstract LF/OX model.
- Structures/crew: Web I-beams 1/2, Deck panels 1/2, Cell cubic strut, Octant open truss, Saddle radial mount, Vault 125/250 cargo bays, Locker 125/250 service bays, Petal 375/500 fairings, Collar 062-250/125-375 adapters, Wayfarer four-seat cabin, Crucible two-seat lab. Cabins/lab carry crew without granting flight control. Bay doors animate with G and preserve their state through vessel cloning/save data.
- Utility/control: Rung ladders 1/2, Glint/Daybreak lamps, Tap linear/Flurry five-way RCS, Flywheel 250/375 attitude rings, Reservoir 250/375 batteries, Catalyst fuel cell/bank, Isotope generator, Sundial/Solstice arrays, Finch/Heron radiators, Reef drogue, Orchard heavy/radial chutes, Colossus leg, Pebble/Boulder powered rover wheels, Trailhead chassis. W/S drives landed rovers, A/D steers and B brakes.
- Fuel cells consume a balanced LF+OX mixture only while storage has headroom; starvation scales both reactants and output. Radial sources draw from their host stack and respect decouplers. Isotope power works in darkness and caps at battery capacity. Tests exercise direct source rates, headroom, starvation, blocked crossfeed and the physics integrator, plus non-controlling crew, bay deployment/cloning, technology coverage, booster burn/TWR and forward/reverse terrain driving.
- Merged main without conflicts, preserving its flight/editor UX changes. Preview on port 5182 loaded the new bays/habitats with a ready WebGL canvas; collaborative browser screenshot capture failed, so no visual screenshot review is claimed. Mesh geometry, attachment faces, nozzle anchors and deployment were checked headlessly.
- Limits: radiators and ladders are visual hardware; no active cooling/climbing yet. Bays do not add aerodynamic shielding. Continuous power runs during physics steps, matching the existing solar model; no new rails power model. Rover motor torque uses the existing contact model without electrical draw. Methalox has styled performance/plumes but uses the shared LF/OX resources.
- Final validation: `npx tsc --noEmit` and `git diff --check` passed. Initial merged full suite passed 36 files / 531 tests. After the final rover regressions, `npx vitest run --maxWorkers=2` passed 531/533 tests; unchanged terrain performance and science biome tests failed only on wall-clock bounds under shared-machine load. Immediate focused rerun of both files passed all 23 tests. All parts/mesh/expansion checks passed, including 18 focused expansion tests.
## In-situ resources (2026-10-04)

- Added deterministic seamless regolith concentration for every solid body (zero on stars/gas giants), seeded by the body's terrain seed and enriched near poles. Same field drives drills, surface scans and the map texture.
- Seven original parts: Burrow/Quarry surface drills, Scree radial hopper, Talus stack silo, Foundry processor, Meridian orbital resource surveyor and Assay surface spectrometer. All have procedural meshes and discovery-tech assignments. Tanks follow the existing full-at-launch convention; use editor resource sliders to reserve feedstock/product space.
- Flight **Surface resources** panel: deploy/retract drill; start/stop converter and choose fuel+oxidizer or monopropellant; landed local concentration; machinery-core temperature; orbital survey action. Map mode offers a regolith overlay for surveyed bodies, blue (0%) to gold (100%), rotating with the body's surface. Surveys require a bound polar orbit (80–100 degrees to the body's equator), above atmosphere and terrain.
- `advanceISRU(v, concentration, dt)` handles simultaneous drill/converter flows, finite stored charge, limited tank capacity, deployment and isolated core heat by analytical boundary events. World invokes it for landed rails, remote packed vessels during physics, and prelaunch equipment; normal physics supplies the body's local concentration through Environment. Survey flags and scalar machinery state round-trip in existing version-1 saves; old saves default to no surveys and inactive machinery.
- Scope limits: the existing rails electrical model does not regenerate solar charge or drain command-module charge; landed catch-up uses the stored EC budget. Physics/rails parity applies to the machinery given identical power budgets, not solar illumination or other flight loads. Process cores have integral radiators and do not exchange heat with hull thermal nodes. Deposits do not deplete; surveys reveal the full field immediately when requested in a qualifying orbit. Atmospheric harvesting is out of scope.

- Resumed implementation: merged main’s flight/editor UX changes and integrated Surface resources into the new Resources dock chip; overlay state survives closing/reopening the panel. Fixed local concentration to use the current position after unpacking and included remote prelaunch machinery in the catch-up hook. Added a regression for the stale packed-position case.
- Final verification after merging main: `npx tsc --noEmit` passed; `npx vitest run --maxWorkers=2` passed all 36 files / 424 tests (including 13 ISRU tests and catalogue mesh checks); `git diff --check` clean. Collaborative preview on dev port 5183 verified the Resources dock, drill deploy/retract label, converter start/stop label, map overlay toggle and retained toggle state after closing/reopening the dock. Screenshot capture was unreliable in the shared browser, so no complete visual-layout or surveyed-texture screenshot validation is claimed.
## Training (2026-10-04)

- Main-menu Training screen offers eight original lessons: rocket building, first flight, orbit, maneuver nodes and lunar transfer, lunar landing, rendezvous/docking, aircraft, and EVA. Flight Director Ama Okafor supplies instructions, goal-based Next, Skip, Restart, and return-to-lessons controls. Goals observe editor hardware/staging, controller controls, and actual World flight state; UI highlights follow each step.
- Practice scenarios use public helpers and isolated Standard-scale sandbox worlds. Existing program state and remembered craft survive practice; completion checkmarks persist separately when storage is available. Skipped practice does not earn a checkmark. The tutorial overlay sits below pause/help/loading dialogs, and F1 help opens only on request during lessons.
- Definition/scenario, simulated-state predicate, progression/storage tests are in `tests/tutorial.test.ts`; the existing orbital ascent integration also verifies the tutorial orbit predicate. After merging main, `npx tsc --noEmit` and `npx vitest run --maxWorkers=2` passed (36 files / 411 tests). Browser checks confirmed all eight lesson buttons, an empty initial editor and hardware-triggered Next.
- Flight visual verification remains limited: shared-machine SwiftShader checks timed out waiting for scene readiness, and a low-quality retry lost its browser connection. No flight visual pass is claimed.
### Near-camera surface scatter
- Added deterministic camera-local cube-face cells, instanced procedural rocks, grass, bushes and trees. Shared `heightAt` places bases on the collision terrain; two-stage cell-local transforms preserve centimetre placement through floating-origin translation and rotation.
- Airless surfaces and Mars get power-law stones/boulders; Titan gets smaller pebbles. Earth climate colors and slope select vegetation or mountain rock; water, snow, desert and the entire launch flat radius are excluded. Existing terrain detail now includes a sub-metre normal octave. Decorations have no collision shapes.
- Quality: Low off; Medium 256 m rocks; High 1024 m rocks and vegetation; all enabled presets stop above 3 km and yield per candidate within cell/time budgets. PlanetRenderer owns update/disposal and includes scatter readiness in `idle`.
- Tests cover deterministic cells at seams/poles, launch plateau and biome exclusions, float32 placement within 2 cm after rotated origin changes, build limits, altitude suspension and eviction after relocation. Screenshot evidence: `docs/screenshots/moon-surface-scatter.png` and `earth-ground-scatter.png`, captured sequentially using the actual PlanetRenderer after terrain/scatter readiness.
- Final integration: merged current main cleanly into `cx/scatter`. Post-merge `npx tsc --noEmit` passed; `npx vitest run --maxWorkers=2` passed all 36 files / 401 tests (88.30 s). Temporary preview/capture files and the isolated Vite cache were removed; dev port 5185 was stopped.
## Flight readouts and map planning (2026-10-04)

- Flight data joins the persisted HUD dock chip bar. Configurable sections show current/max TWR, pressure/vacuum stage and total Δv, next-node burn duration, terrain-aware ballistic impact time/speed, vertical suicide-burn altitude/countdown, axial terminal speed, aerodynamic/attitude angles, orbital elements, target AN/DN times, phase angle and biome.
- Map labels show AN/DN crossings, impact, node countdowns and named SOI transitions. Drag node rings along the pre-burn conic; six coloured 3D handles adjust signed prograde/normal/radial Δv. Existing jog controls remain available.
- The map maneuver dock offers a sibling-planet transfer-window selector. Its 36 × 36 porkchop grid uses `porkchopGrid`, hover shows departure/arrival/flight duration and departure/capture/total Δv, and clicking searches that cell for a verified encounter before replacing the node. The modal renders outside the scrolling dock.
- Ten pure calculation tests cover surface-relative impact speed, future terrain sampling, grazing contact on eccentric orbits, finite horizons, gravity-aware braking, elliptical/hyperbolic plane crossings, exact node boundaries, radial descent and signed phase angles.
- Limits: impact prediction ignores drag/thrust and stops at the current SOI; terminal speed uses axial drag only; braking assumes vertical descent, constant mass/thrust and local gravity. Transfer search is synchronous and may briefly pause rendering.
- Final verification after merging main: `npx tsc --noEmit` and `npx vitest run --maxWorkers=2` passed (36 files / 407 tests). A prior concurrent run timed out in the science biome coverage test; the final requested-command rerun passed. Collaborative preview could not connect to the dev server, so browser interaction/visual verification remains unconfirmed.

## Rebindable input and settings (2026-10-04)

- Central persisted action map (`src/input/bindings.ts`) covers flight, aircraft, EVA, map shortcuts and editor commands. Settings → Controls captures keys/modifier chords, reports overlapping active contexts, restores defaults and exposes gamepad dead zone/sensitivity, pitch inversion, optional mouse flight and smoothing. Typing and settings capture suppress gameplay shortcuts. The help overlay follows rebound keys.
- Standard gamepads control attitude/translation, trigger throttle, EVA movement/run/boarding, SAS/RCS, map, pause and warp. A 0.75-second A hold confirms stage/hop once per press; reconnects latch held buttons. HUD shows precision mode, controller connection and stage hold progress.
- Shared five-tab settings modal opens from menu, hub and flight pause. Graphics provides preset and individual effects; Audio routes master/music/effects volumes live to GameAudio; Gameplay applies units, navball/HUD sizing, FOV and configurable autosaving; Accessibility applies UI scale, contrast, reduced animation/flicker and navball marker colours. Flight quality/cloud/scattering changes rebuild from its saved snapshot; bloom/shadows/render scale update the pipeline in place.
- Resumed the interrupted WIP and merged current main, retaining its flight loading/recovery/pause handling and decluttered HUD. Focused input/audio tests cover bindings, storage migration, chord matching, stage hold/reconnect/pause, EVA and live volume subscriptions. Browser checks verified menu tabs, capture persistence/reset and dialog sizing. Full validation results are recorded in the implementation handoff.
## First-play QA pass (2026-10-04)

- HUD declutter: left dock with Assist / Crew / Science / Target toggles (persisted); target panel expands only with a target, crew opens on EVA, map planner shares the column. Right column stacks orbit + resources. Checked at 1280×800, 1366×768 and 1920×1080.
- Orbital readouts show dashes while landed/prelaunch. Staging: next stage at the bottom with a Stage button; burning engines stay as the "Active" stage; numbering matches the editor (highest fires first).
- First-flight help overlay (F1 / ?), flight loading screen (waits for focused-planet terrain, 20 s cap), pause menu: Revert to launch, Quickload, Controls, Settings (volume/invert live; quality rebuilds the scene from a snapshot). Keys are ignored while paused; Esc closes help/settings first and never dismisses "Vessel lost".
- Transfer planner: Moon transfers failed ("No transfer window found") from most post-assist parking orbits because a grazing SOI hit scored worse than a near miss; a squashed-cost retry now finds them (1 s). Planner shows "Planning…" feedback.
- Editor: top bar no longer clips the Launch/exit buttons at ≤1366 px; Launch warns once for TWR < 1 / no engines; load dialog flags stock craft needing research; Kestrel uses starter parts so new Science/Career programs can fly a stock rocket.
- Hub tiles readable over the bright sky; recovery summary on the hub; New Game warns it replaces the program and clears the old quicksave; Continue restores the last editor craft; Tracking Station starts focused on the fleet.
- Known remaining: AudioContext autoplay warnings when entering flight without a prior gesture (dev URLs only); synchronous transfer search briefly freezes the UI; tech-tree page relies on page scroll at 768 px height.
