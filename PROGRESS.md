# Progress Report

_Last updated: 2026-10-06_

## Start here (for Ned)
**Run it:** `npm install && npm run dev`, open http://localhost:5173. Pick **New Game → Sandbox → Standard** for the easiest start;
the first flight shows a controls cheat sheet (Shift+F1 or the toolbar "?" brings it back). **Training** on the main menu has 8 guided lessons.

**What exists:** the real solar system (Sun, 8 planets, Pluto, Ceres, 40+ moons, plus asteroids/comets like Vesta, Bennu,
67P and Halley). Saturn and its moons get special treatment: rings you can fly through, the polar hexagon, Enceladus plumes,
Titan's haze and methane seas you can splash into. ~170 original parts and ~25 stock crafts; rockets, planes, rovers,
stations, docking, struts/fuel lines, EVA, mining, comms relays. Physics: rigid-body vessels with structural stress and
breakup, re-entry heating, environmental hazards (Venus pressure/heat, Jupiter radiation, eclipses), optional precise
n-body gravity with Lagrange points (Settings, off by default). Modes: Sandbox / Science / Career, 10 scored Missions
(4 at Saturn), 8 Training lessons, flight log with reports and achievements, Spacepedia, photo mode, craft share codes,
save slots, rebindable controls + gamepad. Three scale presets (Standard 1/10, Challenging, Real). Experimental LAN
multiplayer (see MULTIPLAYER.md).

**Verified by automated tests (~914):** orbit at all three scales, Moon landing + return (standard and real scale),
Earth → Saturn orbit, real-scale Saturn departure, Titan landing, real-scale re-entry, jet takeoff, docking, EVA,
structural limits on every stock mission, n-body L4 stability, save/load determinism.

**Please check on your laptop (I could only test with a slow software renderer):** in flight press **F8** for the
performance overlay (fps, frame-time graph, CPU/GPU breakdown) and use **Copy report** on the pad, in orbit, in the
map and in the Ring Skimmer mission — `docs/PERFORMANCE.md` ("What to measure on the laptop") lists what to send.
Graphics are auto-tuned once per device (weak GPUs start on Low; adaptive resolution is on). Then tell me what feels
wrong — handling, balance, visuals, UI. Open decisions for you are in MULTIPLAYER.md and DECISIONS.md.

## Map readability on Retina (2026-10-06, op/mapviz2)
You said the map lines were barely visible and a planned course looked like straight pixels. Checked on a real GPU at
2× device pixel ratio: every trajectory line now has a thin dark outline (it reads over bright planets), and the active
and planned paths get a soft glow. Widths stay fixed on screen (active orbit 3 px). Curves are sampled more densely
where they bend, so there are no straight chords at periapsis or along flybys. Dashes are a fixed size on screen, and
the glow continues through the gaps. The Moon's orbit stays visible when you zoom out to plan a transfer. Your planet's
own path round the Sun is faint and fades towards the screen edges. The part of a course inside the Moon's SOI is drawn
where the Moon will be at the encounter. That spot shows a ghost Moon icon and a faint SOI bubble. The node gizmo
shrinks when the orbit is small on screen, and its handles hide when the orbit is only a few pixels across, so it no
longer covers the transfer. Ap/Pe/encounter/escape/impact/AN-DN markers are sharp SVG glyphs in the colour of their
trajectory. Their labels have outlines. Apsides of orbits too small to tell apart are hidden. The map also has a
faint starfield.

## Map view and maneuver planning, the classic way (2026-10-06, op/mapksp)

Owner feedback: the map and maneuver planning felt unfamiliar. The map now follows the genre classic's hand habits
with our own visuals (details in DECISIONS.md):

- **Plan a burn:** open the map (M), hover your orbit — a ghost node follows the cursor with time-to and altitude —
  and click to place a node. Drag the coloured handles outward (green prograde/retrograde, magenta normal/anti-normal,
  cyan radial out/in): the further you pull, the faster Δv flows; push back to remove, scroll over a handle for
  0.1 m/s steps. Drag the node itself along the orbit to change its time. Click the node for its menu (exact Δv
  fields, −/+ 1 orbit, Warp to, Fine tune, Zero, Delete; Delete key works too). Several nodes are allowed; the
  planned path is orange/dashed with its own Ap/Pe and encounter markers. The navball burn readout follows the next node.
- **Markers:** Ap/Pe on every orbit, AN/DN against the target, encounter (with periapsis at the body), escape,
  impact, closest approach (both positions + separation, speed and time). Hover for details, click to pin,
  right-click to warp there; right-click the orbit line to add a node or warp to that point.
- **Focus and targets:** double-click a body, vessel or its orbit to focus; Tab / Shift+Tab cycle vessel → its body →
  bodies on the trajectory → target → moons; Home or ` returns to the vessel. Click or right-click an object for
  Focus / Set as target / Warp to closest approach or SOI change / Switch to vessel / Info. Hover shows distance and
  relative speed. Right-drag (or left-drag) orbits the camera, the wheel zooms smoothly with per-focus limits.
- The old planner (circularize, transfer to…, transfer-window porkchop, node list) is the collapsible
  **Maneuver planner** button at the top-left in map view. The Tracking Station shares hover, double-click focus and
  the click/right-click menu (Focus, Fly, Info).
- Verified on the RTX 3060 Ti (Windows Chrome, 1600×900): placing, dragging, wheel trims, sliding, node menu,
  Moon transfer markers, pinning, context menus, Tab/Home focus, Tracking Station menu.

## Flight HUD in the classic layout (2026-10-06, op/hudksp)

Owner feedback: the HUD was hard to learn coming from the genre classic. The flight HUD now follows its 1.12 placement
and key conventions with our own visuals (details in DECISIONS.md):

- **Where things are:** time warp + MET/UT clock top-left · altimeter (click: sea level/terrain) with status lamps top-centre ·
  app toolbar top-right (Resources, Flight data, Science, Crew, Assist, Target, Comms, orbit strip, Settings, Help) ·
  staging stack bottom-left (click an icon: highlight + part panel; lock with Alt+L) · navball cluster bottom-centre
  (G meter, SAS/RCS, SAS mode glyphs, throttle arc, speed mode, burn readout when a node exists) · crew portraits with EVA,
  MAP and camera bottom-right. Ap/Pe live in the orbit strip (always on in map view).
- **Keys changed:** U lights (was C), O EVA (was U), C interior view notice, F1 screenshot, F2 hide UI, F3 flight results,
  Shift+F1 help (was F1), Shift+F3 flight data (was F3), Alt+L stage lock, hold F momentary SAS, [ ] switch vessel.
  Saved bindings that were still on the old defaults migrate automatically; customised keys are kept.
- Verified on the RTX 3060 Ti (Windows Chrome) at 1366×768, 1600×900 and 1920×1080: pad, ascent, orbit with a node,
  map view, EVA, rendezvous/target, F2 and help. Lint, TypeScript, tests and build pass (see commit log).

## Laptop performance pass 2 (2026-10-05, op/perf2)

- **Diagnosis (headless evidence):** main-thread work is small (≈1.2–2.6 ms/frame plus 2–3 ms of three.js submission on a desktop CPU); the laptop costs were pixels (Medium rendered at up to 1.5× device pixels) and shader compiles at runtime (24 programs linked after loading in a scripted flight: 8 on the first map open, 14 on the first decouple — a flash light toggling the scene's light count, plus three's PCFSoft→PCF swap invalidating keys).
- **Fixes:** Medium caps DPR at 1 (−56 % pixels on 1.5× and 2× panels); adaptive resolution on by default and GPU-timer aware; weak GPUs auto-start on Low; Low trims atmosphere steps and site vegetation. Flight and map shaders compile behind the loading screen and the flash light stays resident → 3 runtime links in the same session. Part templates merge draws (Ring Skimmer 407 → 255 calls, three.js submission −18 %); vegetation culls per cell; site textures cached across scenes and sessions; menu loads 3D on idle (interactive 600 → 140–370 ms headless); editor renders only on change.
- **New tools:** F8 performance overlay with copyable report; `scripts/perf-probe.mjs` (CPU/alloc/draws/programs/loading/session). Details, tables and limits: `docs/PERFORMANCE.md`. Laptop GPU frame time is still unmeasured.

## Art pass: parts, plumes, hangar (2026-10-05, op/artpass)

- **Direction:** `docs/ART.md` sets out the palette, material families, wear rules, decal placement and liveries for all ten manufacturers plus the agency. Every manufacturer has an original, procedurally drawn mark.
- **Materials:** Part textures are generated in a worker and cached in IndexedDB, with packed ORM maps. Painted surfaces now show panel seams, rivets, welds, grime and chips under a clear coat. Foam, MLI foil, honeycomb ablator, scorched engine bays, tyre tread and deck plate each have their own look.
- **Decals:** Tanks, pods, engines, SRBs, decouplers, fairings, nose cones, adapters, probes and instruments now carry maker badges, part plates, insignia and stencils.
- **Geometry:**
  - Pods: window bezels, framed hatches with hinges and handles, rescue markings.
  - Landing legs: hoses and ribbed pads.
  - Science instruments and antennas: a distinct design for each (probe, capsule, penetrator, boom, gradiometer, carousel, exposure tray, whip, Yagi, dishes).
- **Plumes:** Plumes are volumetric, with sea-level shock diamonds, vacuum expansion, per-propellant colour and throttle response.
- **Lighting:** Flight uses a procedural sky/planetshine environment. The hangar, preview and thumbnails use a procedural studio environment.
- **Performance:** The Low quality preset builds half-tessellation, decal-free part meshes (−43% triangles). High-detail triangles rose about 5%.
- Screenshots are in `docs/screenshots/art/`.

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
| V (pad: R3) | camera mode (auto / free / orbital / chase / locked); the CAM chip on the top bar shows and cycles it |
| Arrows, + / − (pad: RB + right stick) | orbit / zoom the camera |
| G / B (hold) | landing gear toggle / wheel brakes |
| C | lights on / off |
| Backspace | abort (cut throttle, fire the Abort group) |
| 1 … 0 | custom action groups 1–10 (assign in the editor's **Actions** mode) |
| Right-click a part (long-press on touch) | part panel: live status, actions (activate/shut down, deploy, decouple, chute, transmit, undock …) and settings |
| Esc | pause menu (recover, revert to launch/editor, quickload, settings) |
| F1 / ? button | controls cheat sheet (shown automatically on the first flight) |
| Mouse drag / wheel | orbit camera / zoom |

## Part panels, settings and action groups (2026-10-05)
Right-click any part in the hangar or in flight for a floating panel that follows the part (pin several; Esc or × closes).
In the editor it sets fill levels (including empty ballast), thrust limiter, gimbal, crossfeed, ejection force, control-surface
limits, chute deploy pressure/height, deploy state at launch, RCS axes, reaction-wheel mode and lamp colour; Δv/TWR update
immediately. The **Actions** button switches to action-group mode: pick a group (Stage, Gear, Brakes, Lights, RCS, SAS, Abort,
1–10), click parts and tick their actions; the left list shows every binding. Staging chips select parts (and the 3D view
highlights them); hovering a part shows a tooltip. In flight, the panel shows temperature, structural load, contents and
engine state, offers part actions, and adjusts flight-safe settings. Stock crewed rockets come with an Abort sequence.
Everything goes through the authoritative command path, so it works in LAN multiplayer.
## Flight feel pass (op/feel, 2026-10-05)
What changed after "pretty good, but feels unfinished":
- **No more fixed-step judder.** Rendering now interpolates every vessel between the two latest 50 Hz physics
  steps (and draws the planet, launch site, flags and navball at the same in-between time). Measured frame-to-frame
  unevenness: 60 Hz display 1.21 → 0.0004, 144 Hz 2.91 → 0.0004 (`tests/render-interpolation.test.ts`); the
  simulation stays bit-identical.
- **Camera with weight.** Orbit/zoom ease towards targets (70 ms / 140 ms, gentle fling), framing and zoom limits
  follow vessel size (staging and vessel switches re-frame smoothly), never dips below terrain or sea, and has five
  labelled modes (Auto, Free, Orbital, Chase, Locked) that keep the view when switching. Small launch rumble /
  max-q buffet and a staging kick, all off with Settings → Accessibility → Reduce motion.
- **Controls.** Keyboard attitude keys ramp (tap ≈ ¼ deflection, full in 0.2 s), sticks stay direct; R3 / RB + right
  stick for the camera. SAS was measured on three stock craft and already settles without overshoot (see below).
- **HUD.** Prioritised cautions above the message stack (NO CONTROL, OVERHEAT, HIGH G, TERRAIN / SINK RATE, GEAR UP,
  STAGE FUEL / FLAMEOUT, LOW POWER) with anti-flicker hold; orbit rows hide on the ground and Mach / dynamic pressure
  hide in vacuum; heading box on the navball; STAGE n flash. Fixed: the navball radial-in/out markers were swapped
  relative to SAS RAD+/RAD−.
- **Time warp.** Rails warp ramps up (1×→1000× reaches 90 % in ~1 s) instead of jumping; ⇥ next to the warp rate
  warps to the next maneuver, apoapsis, periapsis or SOI change and stops just before it (physics warp in air).
- **Moment to moment.** Loading screen fades out, then a vessel name / situation banner; optional 3-2-1 launch
  countdown (Settings → Gameplay); short, dismissible first-orbit hints (gravity turn → coast → circularise → orbit,
  once per browser profile); map view opens with a zoom-out and both directions dip briefly through black.

Measured (headless, `tests/sas-feel.test.ts`, vacuum, wheels only): Sounding rocket 45° step 5.5 s, Orbiter 30° 19.4 s,
Moon lander 15° 41 s, overshoot ≤ 1.0° in every case; an Orbiter tumble of 0.18 rad/s is stopped in 20 s and then holds
with 0.000° drift. Large stacks turn slowly in vacuum because their only torque is the command pod's reaction wheel —
a part-balance question, not a controller one. Gravity turn sanity (`Orbiter`, prograde SAS after a 10–15° kick at
60 m/s): AoA stays below 0.5° through max-q; with SAS off the finned stack weathervanes into prograde. Landed legs show
a ~3 mm 50 Hz contact chatter (invisible, and hidden further by interpolation); quickload still rebuilds the scene.
Browser smoke test for this layer: `PORT=5204 node scripts/feel-browser.mjs` (banner, countdown, camera chip and modes,
warp-to; 7 checks, no page errors).

## Status
Milestone 1 (build → launch → orbit → Moon) is complete and verified. Beyond it: docking, aircraft, EVA, interplanetary, science/career, comms, mining, multiplayer prototype. Feature notes per area follow below the table.

| Area | State |
|---|---|
| Real solar system (Sun, 8 planets, Pluto+Charon, Ceres, 40 moons incl. 19 Saturnian) | ✅ |
| Scale presets (Standard 1/10, Challenging, Real) | ✅ |
| Orbital mechanics: Kepler, ephemeris, patched conics, SOI transitions, maneuver nodes | ✅ tested |
| Atmospheres (layered US-Std-76 for Earth; Mars, Venus, Titan, giants) | ✅ tested |
| Vessel physics: rigid body, fuel flow, pressure-dependent engines, Mach drag, lift, heating, chutes, legs, SAS | ✅ tested |
| ~160 original parts with procedural PBR models + exhaust plumes | ✅ |
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

## Spacepedia and Saturn menu (2026-10-04)

- Main menu now crossfades its immediate 2D fallback into a live Low-quality Saturn scene, with analytical ring/planet shadows, Titan and Enceladus, Starfield, HDR pipeline, golden illumination and slow camera drift. Renderer imports are lazy; WebGL initialization failure/context loss leaves the fallback available. Hidden fallback drawing pauses after readiness.
- Added `pedia` scene and menu / Space Center / Tracking Station entry points with return navigation. Searchable index covers all 51 catalog bodies, 162 parts and ten original flight-school notes. Scaled/real figures, actual sampled atmosphere pressure/temperature curves, orbital-shape schematics, worker-baked far-LOD rotating globes and part turntables are included. Saturn-family prose is expanded with NASA science links; other bodies reuse the original catalog descriptions.
- Part detail includes mass, cost, heat/impact limits, manufacturer, resources, modules and research assignment. Turntables reuse the editor thumbnail mesh/framing/lighting in its existing renderer module. `farOnly` avoids portrait terrain allocation; pending texture bakes do not attach resources after disposal.
- Validation: TypeScript clean; full Vitest run passed 45 files / 630 tests, including index coverage, monotonic altitude/pressure across every preset and shared forbidden-name checks. SwiftShader screenshots inspected at 1280×800; adjusted menu framing and initial render-target size after the first pass. Evidence in `docs/screenshots/pedia-menu.png`, `pedia-world.png`, `pedia-part.png` and `pedia-atmosphere.png`. Final full suite rerun also passed 45 files / 630 tests; 30 fps throttling and offscreen preview suspension resolved a SwiftShader atmosphere capture timeout.
- Limits: portraits are procedural, spherical and composed rather than photographic ephemerides; orbital illustrations are explicitly schematics. Atmosphere temperature is allowed to invert and fades at the modeled vacuum cutoff. Existing module field names and catalog units describe game hardware, not real manufactured products.
## Showcase fleet and Titan (2026-10-04)

- Added 14 original stock entries (20 total): Hearthlight station core, Homeward crew ferry, Moonmoth rover and delivery lander, Bedrock mining lander, Longreach nuclear transfer ship, Daybreak runway spaceplane, Emberleaf Mars lander, Hazewalker Titan probe, Frostwhisker Enceladus sampler, Gossamer Saturn ring observatory, Atlaswake five metre lifter, Beaconseed relay launcher and Alembic laboratory. All use CraftEditor/Builder attachments; symmetric gear, legs, propulsion and utility hardware. New craft identify career research requirements and intended delivery/deployment context.
- Resource overrides reserve mining capacity and remove unused oxidizer from Longreach. Fixed craft serialization's missing regolith resource ID. Complete Earth delivery stacks use staged upper/booster engines; destination landers carry restartable propulsion; rover carrier release leaves command authority on both pieces.
- Stock validation covers all entries, command authority, save roundtrip, stage modules, positive simulated delta-v and liftoff TWR > 1.15 at the specified Standard-scale body conditions. World regressions exercise Moonmoth driving on lunar terrain, carrier separation and Daybreak jet-only runway takeoff.
- Titan regressions check density (~5.26 kg/m³), gravity (~1.35 m/s²), compressed profiles and nitrogen heating across all presets. Hazewalker approaches Standard Titan at 1.2 km/s, aerobrakes shield-first, transitions through semi/full chutes, retains every part and lands below 5 m/s without thrust. Existing atmosphere, thermal and chute physics pass unchanged.
- Scope: destination/orbital craft require transport or scenario placement; full Earth-to-Mars/Titan/Enceladus trips and Daybreak orbital insertion are not integration-tested. No browser screenshot review performed.
- Final validation: `npx tsc --noEmit` passed; `npx vitest run --maxWorkers=2` passed all 46 files / 646 tests with exit code 0 (60.29 s); `git diff --check` clean.
## Laptop performance pass (2026-10-04)

- Added reproducible Node benchmarks covering World physics/rails, trajectory prediction, every catalogue terrain preset, chunk generation, Δv, comms, real controller telemetry/navball, ISRU and science. Raw measurements and the landed CPU profile are in `docs/performance`; methods, before/after tables and all changed files are in `docs/PERFORMANCE.md`.
- Retained measured Δv, station-location, hull-point and absent-machinery caches; removed duplicate ground sampling. Memoized HUD panels, pooled map sprites/buffers, reused planet transforms and quadtree selections, and bounded unnecessary shadow/scatter work. Static vessel leaves are merged/instanced; distant non-command debris uses a point. Low uses half resolution and no bloom; adaptive render scale is optional. FPS readout now includes full composer/shadow draw calls and triangles.
- Ten baseline/final 100-step traces are bit-identical. Typecheck passed; full suite passed 45 files / 632 tests. Multi-time ephemeris caching and in-place mass accumulation were reverted after unfavorable measurements.
- Remaining external validation: actual pad/orbit renderer counts, visual review and integrated-GPU frame times. T3 preview navigation failed repeatedly despite the local dev server responding. Headless Selene visible meshes fell 236→195 with unchanged triangles; those are not GPU draw-call counts.

## Integration QA, qa2 (2026-10-04)

- Audited persistence, module cloning/splitting/docking, communications and multiplayer authority, bindings/tutorials, catalogue/research coverage and stock launches. Added combined integration regressions, including old-save migration and all 20 stock launches.
- Fixed node snapshot aliasing/duplicate IDs; zero loaded/cloned vessel bounds; shared cloned docking metadata; missing network module state/world extensions and stale targets; local comms overrides on server/practice worlds; unauthorized multiplayer clamp release; and ignored prelaunch gear/bay commands.
- Fixed tutorial keyboard focus/keyup handling and rebound instructions, live pitch inversion, and map dragging accidentally commanding mouse flight. Flight Data now has a rebindable F3 shortcut. Low-resolution renderer bootstrap no longer creates zero-sized framebuffer attachments.
- Reproducible SwiftShader/Playwright scripts and evidence are in `scripts/qa-*.mjs` and `docs/qa`. See `docs/qa/README.md` for severity, coverage and remaining limitations, including the separate landed-rails power/ISRU model.
- Final validation: TypeScript and production build passed; all 673 tests across 50 files passed with `--maxWorkers=2`. All 24 browser checks passed with zero console errors/warnings, including actual map handle/time dragging, settings key capture, completed Training lessons 1–2, docking/undocking, lunar mining/rover/EVA, Titan landing, and a real local multiplayer launch/save-isolation check.

## Code health pass (2026-10-04, cx/health)

- Worked only in `/home/nedcut/.t3/projects/wsp-wt/health`. Split World (1127 → 690 lines), FlightController (1042 → 712) and the catalog facade (1580 → 47), preserving public import paths, bound navball callbacks and private state ownership. Moved responsibilities into `game/world/`, `flight/controller/`, and category arrays/shared builders in `data/parts/`; moved basis math to `util/basis.ts` with a World re-export.
- Added flat ESLint/typescript-eslint/react-hooks config, `npm run lint`, a sim dependency checker and Knip entry-point configuration. TypeScript 7 remains the compiler executable; TypeScript 6 supplies the tooling API. Fixed unused imports/assignments and unsafe switch scoping, named the paused-effect dependency, and explained the tutorial's intentional epoch-only frame-loop dependency. Skipped Prettier to avoid broad formatting churn.
- Removed the unused FloatingOrigin wrapper, legacy save-game API (saved craft API retained), unused vector/quaternion/matrix helpers, quality detection and fallback-mesh flag; made verified file-local helpers private. Kept public sim contracts/barrels and catalog compatibility exports despite audit reports. All three dev previews are retained and build as explicit HTML inputs; T3 browser navigation failed, so runtime preview smoke testing was unavailable.
- Moved pure UI formatting into `util/format.ts` with the original UI path re-exported. FlagView now accepts a structural input. ARCHITECTURE.md records the current module layout, the static bodies facade exception and remaining render → game settings dependencies.
- Validation: `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` pass. Final `npx vitest run --maxWorkers=2`: 49 files / 660 tests passed. All ten baseline/final 100-step trace hashes are identical; all 162 serialized part definitions and their order are byte-identical to the original branch. Production/preview builds retain the existing large-chunk warning. Knip reports retained public exports, not an enforced zero-unused-exports gate.
## Scale presets (2026-10-04)

Challenging and Real now have catalog-built stock launchers and automated flight coverage. D-003 physical scaling is preserved; fuel capacity, specific impulse and engine thrust were not increased.

| Preset | Earth radius | Atmosphere top | Surface gravity | New career credits |
| --- | ---: | ---: | ---: | ---: |
| Standard (`s=0.1`) | 637.101 km | 70.166 km | 9.82022 m/s² | 60,000 |
| Challenging (`s=0.32`) | 2,038.723 km | 99.466 km | 9.82022 m/s² | 614,400 |
| Real (`s=1`) | 6,371.008 km | 140.000 km | 9.82022 m/s² | 6,000,000 |

Stock hardware after the `cx/realbal` quality pass (catalog parts unchanged; vacuum Δv sums the simulated staging sequence):

| Design | Preset | Parts | Launch mass | Vacuum Δv | Launch ASL TWR | Cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Meridian Orbiter | Challenging | 16 | 75.21 t | 8,135.1 m/s | 3.975 | 42,925 cr |
| Selene Expedition | Challenging | 35 | 670.38 t | 15,106.3 m/s | 1.733 | 157,177 cr |
| Meridian Orbiter | Real | 17 | 219.69 t | 10,873.7 m/s | 1.361 | 84,332 cr |
| Selene Expedition | Real | 92 | 4,791.47 t | 20,379.2 m/s | 1.302 | 1,393,197 cr |
| Ringrunner Saturn Probe | Real | 76 | 4,781.84 t | 20,090.1 m/s | 1.305 | 1,440,344 cr |

- **Stock hardware:** Selene Real adds eight Thunderclap solid assists to its independently fed liquid strap-ons; solids and strap-ons ignite together and separate together, preserving the dormant core's fuel reserve. Its liftoff TWR rises from 1.097 to 1.302, with an explicit ≥1.2 regression; all complete stock launchers again meet the common >1.15 check. Dedicated `stock-meridian-challenging` and `stock-selene-challenging` use smaller delivery stacks at `s=0.32`, with orbital and lunar flight coverage. Selene variants retain independent descent and ascent/return stages. `stock-ringrunner-real` carries five liquid-fuel-only nuclear cruise reservoirs, isotope generators and a Horizon reflector; it is sized for a Saturn **flyby**, aiming 120,000 km above Saturn with circular capture disabled. A real-scale SSTO was skipped: the existing chemical/airbreathing spaceplane has no demonstrated real-Earth orbital fuel margin.
- **Editor scale guidance:** Every stock entry has a `scale` preset badge in Load, highlighting the current program scale. Library craft keep their `stockId` through renaming, edits and save/load. A mismatched launch shows one notice per design/current-scale pair in the editor session; the next Launch proceeds. Unknown/custom craft receive no stock attribution. ASL Δv and TWR continue to use the selected universe's Earth pressure/gravity, including the fallback estimator.

- **Ascent/landing:** Larger presets need sustained orbital insertion; the old ballistic-hop guidance could reach target apoapsis yet fall into the atmosphere during the long circularization burn. Radial acceleration feedback includes centrifugal support and limits climb while horizontal speed builds. It also fixes lunar ascent. Landing prediction now runs at 2 Hz with interval clearance rather than 50 Hz; tall craft stop higher and use slower terminal feedback, and throttle below an engine's minimum is pulsed at 4 Hz. The Standard mission remains covered by its existing end-to-end test.
- **Atmosphere/heating:** Pressure, temperature and composition already follow the compressed physical profile correctly. Sutton–Graves heating retains its density/nose-radius dependence and cubic velocity term. Capsule hull limits are now 1,600 K; separate shields retain 3,400/3,600 K limits. A tapered capsule exposed a tiny parachute rim to full stagnation heating on lunar return: the thermal model now includes an aligned heat shield's finite near wake, protecting wholly enclosed downstream parts while retaining 3% residual convective flux. Outboard and nose-first parts still burn. Radiation, conduction, ablation and aerodynamic drag are unchanged.
- **Terrain/rendering:** Relief remains `s^0.8`; the physical 3 km launch plateau and runway fit at every scale and sample 10 m elevation. Existing float64 origin subtraction, chunk-local float32 vertices, adaptive terrain levels and logarithmic depth need no scale-specific renderer patch. New tests check real-Earth adjacent terrain boundaries within 1 mm and actual vessel object-matrix centimetre motion across ±1 km origin shifts within 0.1 mm. Save loading now rebuilds bounding radius/mass properties immediately (previously radius stayed zero until physics stepped). Inspected real-size pad/runway captures at port 5187: [pad](docs/screenshots/real-pad.png), [runway](docs/screenshots/real-runway.png). These are 1280×800 SwiftShader captures at Low quality, after terrain readiness, with no visible near-surface cracks; they are not hardware-GPU performance measurements.
- **Warp/prediction:** Rails clearance fractions cap their reference radius at 637.1 km, allowing 10,000× in real LEO while retaining atmosphere/terrain/SOI event stops. The existing conic predictor's adaptive dynamical-time/boundary steps and isolated-orbit fast path handle the real lunar transfer and weeks-long launch-window wait within its 500,000-step budget. Interplanetary horizons and parking altitudes already derive from ephemerides/body parameters; Ringrunner Real now has actual Earth ascent/parking plus a refined Earth → Sun → Saturn planner encounter and a remaining-fuel budget check. Full nuclear departure/cruise exceeded the three-minute allowance on the shared machine, so Saturn arrival/capture is not claimed; the test explicitly reserves 500 m/s for course trims.
- **Comms/science/career:** Antenna ratings remain physical metres. Earth stations now rate 8 Tm; the Horizon reflector pairs at 2 Tm, enough for far-side real Saturn (more distant missions need relay infrastructure). Science situations already derive from atmospheric height and body radius; values/reputation stay unchanged. Starting funds, newly generated contract advances/rewards/penalties and cash milestones scale by `(s/0.1)²` (1 / 10.24 / 100). Existing saved balances and offers survive unchanged. Full career progression remains future balancing work.
- **Reproduction:** `npx vite --port 5187 --strictPort`, then `node scripts/shot.mjs 'http://localhost:5187/?flight=stock-meridian-real&scale=real' docs/screenshots/real-pad.png`. `?scale=standard|challenging|real` also selects the universe for existing flight shortcuts; orbit/rendezvous/reentry dev scenarios now derive heights and speeds from it. `MOON_DEBUG=1 npx vitest run tests/world-moon-real.test.ts --maxWorkers=2` adds terminal-descent traces.

Mission logs (time since launch; Δv is integrated thrust acceleration, rounded):

| Mission / phase | T+ | Result | Phase Δv |
| --- | ---: | --- | ---: |
| Meridian / Challenging orbit | 638 s | 154.94 × 155.15 km; 5,175 kg | — |
| Meridian / Real orbit | 957 s | 221.39 × 222.01 km; 4,260 kg | — |
| Selene Real / ascent | 614 s | 201.6 km altitude | 9,593 m/s |
| Parking circularization | 1,040 s | 250.0 × 275.2 km | 268 m/s |
| Trans-lunar injection | 1,980,406 s | Earth apoapsis 385,003 km | 3,131 m/s |
| Early / late / final course trims | 1,982,210 / 2,220,996 / 2,302,974 s | Lunar SOI encounter; final trim resolves finite-burn periapsis drift | 4 / 3 / <1 m/s |
| Lunar capture | 2,390,310 s | 11.0 × 26.3 km | 815 m/s |
| Lunar touchdown | 2,391,093 s | 1.59 m/s, upright cosine 1.000, slope 0.5°, all 21 lander parts intact | 1,775 m/s |
| Lunar ascent / circularization | 2,402,420 s | 31.7 × 33.1 km | 1,852 + 52 m/s |
| Trans-Earth injection | 2,406,084 s | Earth-return trajectory | 807 m/s |
| Earth SOI entry | 2,474,028 s | Earth periapsis 45.8 km | — |
| Earth touchdown | 2,892,281 s | Capsule, shield and fully deployed chute survive; 1,482 kg | — |

Ringrunner Real planning log: Earth parking 205.58 × 234.24 km; remaining vacuum Δv 9,744.0 m/s versus a refined 7,759.5 m/s departure, leaving 1,984.5 m/s (the test requires at least 500 m/s). The selected launch window is 12.8 days after parking, with a 1,580.4-day nominal flight. This is a planned encounter, not a flown Saturn arrival.

Challenging Selene logs: parking 191.4 × 203.1 km at T+871 s; TLI 1,757 m/s; capture 35.1 × 37.6 km at T+1,561,772 s; landing at T+1,562,789 s with 1.53 m/s touchdown, upright cosine 1.000 and 3.3° slope. It moved 0.66 m during three hours of surface warp, ascended into 42.1 × 42.6 km orbit, and splashed down on Earth at T+1,805,261 s with its capsule/shield/deployed chute intact (1,535 kg).

The Moon lander remained landed through three hours of surface warp, moving 0.26 m in the revised Real mission. The spent return-stage separator burns away on Earth entry; the crew capsule, heat shield and chute survive. Both Meridian orbital tests also coast two full periods intact, with periapsis drift below 20 m across heliocentric packing/unpacking. The shared Moon mission test covers both Real and Challenging launch, transfer, capture, landing, surface warp, ascent and Earth recovery, using rails for idle phases and a 600-second budget per mission (matching main) to allow concurrent worktree CPU contention. A final approach trim handles centimetres-per-second finite-burn residuals after the stronger ascent; capture has a bounded burn window.

LEO reentry coverage starts at 220 km apoapsis / 35 km periapsis. The shielded capsule reaches about 7.46 km/s air-relative speed, a peak skin temperature of 1,589 K, and splashes down under its chute with about 143.8/150 ablator remaining. The same unshielded capsule burns up; an unshielded empty tank also fails from overheating before impact. A separate thermal regression checks an 11 km/s shield wake, outboard exposure and reversed orientation.

Final validation on `cx/realscale`: `npx tsc --noEmit` passed; `npx vitest run --maxWorkers=2` passed **48 files / 642 tests in 92.43 s**, including the original Standard orbit/Moon/Saturn/runway missions and the new larger-preset missions, thermal, save-cache and renderer precision regressions. Temporary mission snapshots and debug scripts were removed.

Quality-pass validation on `cx/realbal` before the final main merge: `npm run lint`, `npx tsc --noEmit`, `npx vitest run --maxWorkers=2` (**56 files / 701 tests in 439.67 s** on the shared machine), `npm run build`, and `git diff --check` passed. Both scale-variant Moon return missions and the new real Saturn orbit/planning test pass. T3 preview navigation failed on both direct URL and environment-port attempts, so the new library badges have no browser screenshot evidence; launch-notice persistence and staging are covered headlessly.

Final quality-pass validation after merging main through `981e915` (audio, craft sharing/library and the shared-machine test deadline): `npm run lint`, `npx tsc --noEmit`, `npm run build`, `git diff --check`, and `npx vitest run --maxWorkers=2` pass — **57 files / 721 tests in 345.58 s**. Retained both decision-log additions, the async saved library and editor placement-audio hook, the scale badges/notices, and main's 600-second Moon mission budget. The earlier 300-second local allowance was superseded by main's deadline. All revised craft/mission numbers above reproduce on this merged tree.

## Main integration into code health (2026-10-04, cx/health)

- Merged main `67b75f5` using merge base `1954dd4`. Retained both branches' decisions/progress entries and the extracted module layout. Ported both 1,600 K capsule limits into `data/parts/pods.ts`, scale-aware dev scenarios into `flight/controller/scenarios.ts`, and contract scaling into `game/world/progression.ts`; World initializes scaled career progression. Editor stage statistics retain main's selected-universe pressure/gravity and fallback calculations with the refactor's private reference constants.
- Audited every main-added line in all eight overlapping source/test files against the merge-base-to-main diff. Other main changes merged intact. All 162 serialized catalog definitions/order and all 22 stock craft definitions/metadata match main byte-for-byte. Ten 100-step determinism traces match main exactly.
- Validation: `npm run lint`, `npx tsc --noEmit`, `npx vitest run --maxWorkers=2` (53 files / 675 tests, 169.93 s), `npm run build`, and `git diff --check` pass. Build retains the existing large-chunk warning.


## QA merge and landed power (2026-10-04, cx/qa2)

- Merged main's extracted World/controller/catalog/util layout and scale, HUD, fleet and performance changes. Audited added lines from all four QA commits (`1261ec4`, `8ccedba`, `cdb8f85`, `184cca8`): all remain, except the obsolete combined World import, whose required `setGear` import is retained in the new import layout. QA runtime changes remain in the orchestration methods that were not extracted; extracted helpers remain identical to main. Retained both branches' decisions, progress and QA evidence. Removed a duplicate load-time mass recomputation introduced by the automatic merge.
- Fuel cells and RTGs now participate in the ISRU tank/deployment boundary solver used by both physics and landed/prelaunch rails. Fuel-cell mixture consumption respects stack feed groups; full batteries throttle sources, and empty batteries support simultaneous generation and mining. Tests cover 50 Hz versus long catch-up, physics versus rails, propellant exhaustion, crossfeed isolation and full-storage shutoff. Solar and command-module loads retain their existing physics-only behavior.
- Validation: `npm run lint` (including simulation layering), `npx tsc --noEmit`, `npx vitest run --maxWorkers=2` (54 files / 693 tests, 126.36 s), and `npm run build` all pass. Lint tooling was already installed. Build retains the existing large-chunk advisory. Browser evidence above is from the original QA pass; no new browser playthrough was needed for this merge.

## Vessel and world VFX (2026-10-04, cx/vfx)

- Added independent hottest-face blackbody emission and engine-bell heat with 12-second cooldown; cloned materials own no template geometry/textures. Static parts receive heat updates too.
- Re-entry shock placement uses the leading oriented part bounds and transverse center, with streaked plasma, short-lived trailing sparks and Earth/Mars/Titan colors. Low uses a smaller shock mesh.
- A bounded, reusable GPU particle pool supplies nozzle smoke, SRB trails, high-altitude jet contrails, ground steam and body-colored touchdown/engine dust. Emission is capped at eight engines; quality changes resize the pool. GPU positions are relative to a float64 moving anchor and rebase at 10 km; particles inherit surface/orbital motion. Soft ground contact uses an approximate tangent plane, not scene-depth sampling.
- Existing World destruction/separation events now drive fireballs, smoke, debris sparks and a fading point light even without audio. Cached part locations survive sim removal. Explosion shake respects Reduce Motion; existing explosion audio remains connected.
- Focused tests cover shared-material isolation, hottest-face emission, blackbody color, nozzle cooldown, solar-system rebasing/pool bounds and runtime quality changes, paused simulation time, rails clearing and Reduce Motion. Performance caveat: per-part material ownership reduces cross-part batching; laptop GPU timing remains unmeasured.
- Particles follow simulation time, freeze while paused, and clear on rails jumps or large focus teleports.
- Screenshot reproduction uses the requested `scripts/shot.mjs` with port 5194, 40-second waits and the first-flight panel dismissed. Liftoff sets `input.state.throttle=1` and stages; re-entry uses `?scenario=reentry` with a 16 km hot-entry visual fixture (one skin face initialized to 1,400 K, then three frames before freezing); explosion injects one `partDestroyed` event through `world.onEvent` to exercise the visual/audio hook without altering a stock craft. Screenshots use Low at 0.5 render scale for the shared-host software renderer. Images: `docs/screenshots/vfx-{liftoff,reentry,explosion}.png`.


- Validation before the sharing/photo merge: `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` pass after merging main's audio improvements (`240a11e`). Focused merged audio/VFX/renderer tests pass **25/25**. Full `npx vitest run --maxWorkers=2` was run twice: the final run passes **704 tests / 54 files**, with only `world-moon-real.test.ts` failing its existing 180-second wall-clock timeout (255.65 seconds on the shared host; mission log reaches Earth splashdown). The VFX changes do not alter simulation tests or timeout limits. Build retains the existing large-chunk advisory. Captured browser logs contain no shader/page errors. Main's audio changes merged cleanly into the event hook; both branches' appended decision/progress notes were retained when resolving documentation conflicts.

- Final merged validation (`e72538a`, main through `981e915`): lint, TypeScript, **56 files / 719 tests** (272.61 s), production build and diff checks pass. Main independently increased the shared-host Moon-test timeout to 600 seconds; that upstream change resolves the earlier timing-only failure. Photo-mode imports and appended notes were merged preserving both branches; camera shake is disabled while paused so frozen explosions do not drift the photo camera. The existing build chunk-size advisory remains.
## Structural loads and breakup (2026-10-04, cx/stress)

- Added DOM-free joint force/moment evaluation from the existing rigid solution and per-part applied wrenches. Aero, engines, RCS, reaction wheels, suspension, buoyancy and solved contact impulses expose their application points without changing ordinary integration order. Static attachment geometry and unit inertia are cached; load residual scratch vectors are reused.
- Added size/type-based strength, optional definition overrides, brief overload fatigue with recovery hysteresis, momentum-preserving simultaneous splits, and structuralFailure events. World reports failures, the controller plays an explosion hook, and a rebindable F4 overlay colours individual parts by load fraction while preserving normal material/batching state.
- Crushed contacts transmit limited impulses instead of arresting the entire vessel; impact energy fractures neighbouring joints and scatters surviving debris with opposing impulses. Every struck part is removed even if an earlier failure detached it. Water-impact energy uses surface-relative velocity. New debris carries its substep birth time so World advances it only for the remaining time.
- Added analytic subtree/rotation/moment and strength tests, overload recovery, nested-break momentum/position conservation, broadside transonic rocket versus aligned flight, excessive-g wing versus ordinary flight, a 30 m/s lander crash, water-frame invariance, deterministic replay, and renderer material/batching restoration. Existing orbit, Moon, Saturn, larger-scale, runway and Titan missions now explicitly reject structural failures on the active craft. Long real-Moon/Titan timeout budgets allow shared-machine contention without changing physical assertions.
- Final validation after merging main `981e915`: `npm run lint`, `npx tsc --noEmit`, `npx vitest run --maxWorkers=2` (**58 files / 726 tests**, 303.18 s), `npm run build`, and `git diff --check` pass. Build retains the existing large-chunk advisory. All ten existing 100-step serialized determinism traces are bit-identical to pre-change `31fdfba`; hashes and reproduction command are in `docs/performance/structural-traces.txt`. The complete Real Moon mission retains all 21 lander parts, lands at 1.19 m/s, and returns the 1,482 kg capsule/shield/chute assembly to Earth. Save/JSON-network regression coverage verifies partial fatigue persistence and recovery clearing.
## Quick-start Missions (2026-10-04, cx/scenarios)

- Added main menu → Scenarios → Missions: ten original briefing cards with NASA science links, starting-state instructions, objective text, explicit medal budgets, live flight status, retry, debrief and browser personal bests. Training lessons and career contracts retain their own routes and stores.
- Saturn missions reuse Gossamer, Hazewalker, Frostwhisker and Longreach: a Cassini Division plane crossing/clearance, Titan shield-first entry and parachute landing near Haze Sound, a south-polar Enceladus pass with a deep-sample bonus, and five distinct moon SOI visits. Other missions cover Copernicus Survey lunar precision landing, atmosphere-only Mars capture, Hearthlight docking race, hover-limited terminal lunar descent, a limited-fuel lunar-return Earth entry and a Jupiter flyby to Saturn.
- Public spawn/placement helpers and stock assemblies supply all starts; daylight search fixes target illumination, and the Jupiter setup inverts a hyperbola from a solar Lambert corridor. Objectives follow the mission vessel rather than an unrelated fleet selection. Post-step observations capture pre-contact landing speed, SOI changes and ring crossings. Engine/RCS impulse cost is integrated over actual physics substeps; air braking is free. Save/load and recovery controls are suspended during missions; the prior program and craft return on exit.
- Focused tests cover every setup/snapshot, synthetic success/failure conditions, scoring boundaries/determinism, corrupt/unavailable browser storage, runtime restart/isolation, and real unpowered Saturn ring, Enceladus plume, Mars atmospheric capture, Earth-return entry/chute touchdown and Jupiter→Saturn rails flights. Briefing screenshot: `docs/screenshots/scenarios-briefing.png`. Software WebGL Saturn flight screenshots timed out after the cinematic camera adjustment; the earlier flight capture was removed rather than presented as final evidence.
- Shared-machine validation: the first full suite completed 748 tests and timed out only the existing Real Moon case at 265 s, after its intact Earth splashdown. Its wall-clock allowance was raised to 360 s with all assertions unchanged; the final merge retains main’s independently increased 600 s budget.
- Limits: the procedural Copernicus vicinity is labeled a survey target rather than mapped crater geometry. Render-only ring chunks and plume sampling do not impart forces or damage. Full Titan/return/rendezvous/Grand Tour player playthroughs and medal balancing remain external validation; mission setups and deterministic goal tests pass without changing craft/part balance.

- Final validation after merging main `e07f035`: `npm run lint`, `npx tsc --noEmit`, `npx vitest run --maxWorkers=2` (**57 files / 771 tests passed, 162.84 s**) and `npm run build` all pass. The scenario suite includes 51 tests. Build retains the existing large-chunk advisory.
- Integration retained main’s interface/flight audio, named save slots, photography, surface liquids and discoveries. Mission save isolation also guards Save as; photography hides mission overlays and returning from it preserves a completed run’s pause. Grand Tour starts 30 km above Titan’s atmospheric cutoff; the Earth-return corridor reaches approximately 19 km Standard Earth periapsis and its stock dual chutes earn achievable touchdown medals.

## Offline sharing, save slots, and photography (cx/sharing)

- Editor: Copy share code (versioned JSON, deflate when supported, base64url), .craft.json export, preview-first import from codes/files/drop/URL fragments. Validation lists unknown catalogue parts and rejects invalid topology/transforms or oversized inputs.
- Craft library uses IndexedDB with retry-safe localStorage migration; includes whole-craft thumbnails, folders, tags, search, rename, duplicate and delete.
- Continue opens a save manager with timestamps, simulation date, mode and scale, file import/export (.wsp-save.json), and multiple program-specific manual saves. Save as is available in flight pause and the hub; the latest three autosaves are retained per program. Existing quicksave/autosave entry points remain compatible.
- P or the flight pause/hub button enters photo mode: local simulation freezes, HUD hides, constrained free camera, FOV/exposure/focus blur/vignette/grain/letterbox controls, 1×/2× PNG capture. Sun and clock are untouched; photo mode is unavailable in shared-clock multiplayer.
- Added 14 tests covering compressed/plain/fallback share round trips, import validation, mock-repository IndexedDB migration/retry behavior, save rotation, and save file validation.
## Distinctive surfaces (2026-10-04, cx/surface)

- Added Sable/Lantern northern Titan seas and a smaller lake, using the shared liquid level for physics, chunk geometry, autopilot clearance, scatter exclusion and Hydrocarbon Seas science classification. Dark liquid shading adds restrained methane rain ripples; 550 kg/m³ buoyancy produces greater draft than Earth water.
- Added three named lunar impact basins with central peaks, layered Martian caps, original terrain-anchored procedural landmarks, pulsing Io lava fissures, and intermittent Martian dust devils. Preserved existing Europa chaos terrain, Enceladus physical trenches, and Mercury scarps. Earth gains a sinuous inland river/lagoon; launch plateau blending remains unchanged. Two original airfields are visual landmarks.
- Twelve discoveries are registered within 2 km in full 3D body-fixed distance, emit World `anomalyDiscovered`, award 25 science once in Science/Career, persist through saves and network world replacement, and appear on their body's Spacepedia page. Old saves default to no discoveries. Decorative meshes do not provide collision.
- New tests cover real Titan sea buoyancy and analytic draft, Earth/Titan density comparison, liquid mesh datum, biome alignment, centimetre terrain anchoring at all scales, discovery events/rewards/save migration, and deterministic feature bounds. Focused surface/terrain/contact/persistence run: 23 tests pass.
- Initial full suite: 697 passed, 2 failed from wall-clock timeouts (real Moon 180 s budget, Titan 120 s budget) during concurrent agents' test runs; Moon mission logged successful Earth splashdown. Lint, TypeScript and production build passed. Final validation and browser evidence recorded below.
- Final focused validation: 23/23 tests across surface features, terrain, contact and persistence pass. The two long mission retries again hit their fixed wall-clock limits (283.59 s combined), with no assertion failures; five other worktrees were concurrently running Vitest. A discovery broad phase now skips distant terrain queries. Lint, TypeScript, production build and diff whitespace checks pass; the build retains the existing large-chunk advisory.
- Browser review: T3 navigation worked through the environment network address, but snapshot capture repeatedly failed and the host then explicitly reported unavailable. Used repository-compatible headless Playwright/SwiftShader after that failure. Reproduction: run port 5197, then `node scripts/surface-shots.mjs` (optional single capture name). Evidence: `docs/screenshots/surface/titan-sea.png`, `io-night-lava.png`, `mars-arch.png`, all 960×600 at Low quality after terrain readiness. Fixed deep Titan haze going black when direct-light transmittance underflows by approximating diffuse higher-order scattering; hydrocarbon reflections use a bounded amber sky approximation. No browser script or shader errors were observed; the preview favicon returns 404. Captures are visual evidence, not hardware performance measurements.
- Integrated main with `git merge main`: already up to date at `31fdfba`. All work is committed on `cx/surface`. Remaining model limits: decorative landmarks/remote airfields have no collision, lava has no heat hazard, and distant Titan seas retain baked dark albedo rather than resolved reflection.

## Procedural audio upgrade (2026-10-04, cx/audio2)

- Added turbine whine and spool response, afterburner/SRB crackle, nuclear hum/hiss, distinct aerospike and ion timbres, size/count coloration, camera-distance attenuation and bounded Doppler. Vacuum filtering preserves structure-borne rumble. All sound remains synthesized offline with no asset files.
- World events drive staging/pyro, docking clunk/latch and chute deployment. Per-frame flight state drives gear/leg/bay/drill motors, pressure-driven parachute flutter, contact wheel noise, regolith footsteps, jetpack hiss, drill grinding, touchdown and distinct repeating low-fuel/heat/g/terrain/no-signal tones. Added editor placement snaps and consistent React button hover/focus/click sounds through one hook.
- Shared scene audio plays hub, Earth-orbit, Moon, cruise, Titan and tense themes. Saturn's slow majestic pads and high shimmering notes accompany the main menu, Saturn and its moons. Three-second crossfades and flight-theme dwell avoid abrupt/chattering changes; danger pulse intensity follows heat/g/terrain proximity. Master/music/SFX settings update live. Leaving/pausing flight clears continuous effects; hidden tabs suspend the context and scheduler.
- Added pure distance/Doppler/theme/crossfade tests plus engine/mechanical/adaptive lifecycle, transient cleanup, hidden-tab and 234-node-cap regressions. Focused audio tests pass (14 tests). Collaborative preview opened but snapshot/evaluation failed; no browser listening assessment was possible.
- Final validation: `npm run lint`, `npx tsc --noEmit`, `npm run build` and `git diff --check` pass; focused audio suite passes 14/14. Required `npx vitest run --maxWorkers=2` passes 53 files / 698 tests and fails only the existing Real Moon mission's 180,000 ms timeout (248 s case, 317 s suite). Its isolated retry also times out (271 s), with both mission logs reaching intact Earth splashdown. Shared-machine contention is the likely cause; no simulation/test timeout changes were made. Build retains its existing large-chunk advisory. `git merge main` reports already up to date.

## Non-blocking transfer planning (2026-10-04, cx/planner)

- Added a headless planning contract and snapshot adapter, typed request IDs/results/errors/progress/cancellation, and dedicated module workers for transfer, interplanetary, course-correction and porkchop jobs. Autopilot keeps its synchronous exports and numerical algorithms. Worker code imports no World implementation, React or three.js; its production bundle is 72.19 kB.
- ManeuverPanel and TransferWindow now await worker requests, show progress and Cancel, and cancel on supersession/unmount. Porkchop rows paint progressively. Failed/cancelled searches retain existing nodes; successful plans get fresh World node IDs after validating the live vessel, trajectory, time and node list. No-Worker hosts use the same async protocol in-process (transfer refinement there remains blocking).
- Added 11 protocol/equivalence/cancellation/error/stale-result tests, including exact Moon and Saturn physical results, ordered grid rows, isolated request IDs, AbortSignal support and ordinary orbital coasting. Browser checks against the actual HUD components verified cancellation during Moon refinement, partial Saturn rendering (nine columns retained after cancelling the tenth row), node preservation and a subsequent successful 3,127 m/s Moon transfer.
- Recorded three-trial browser and production-worker Node benchmarks in `docs/PERFORMANCE.md` with raw JSON and reproduction harnesses. Browser median main-thread Moon call time: Standard 643 ms → 0.10 ms; Real 1,021 ms → 0.10 ms. The 36×36 Saturn grid was already ~7 ms on that browser; worker startup increases elapsed time while providing progressive rows/cancellation. Preview timer/rAF throttling prevents any FPS/Long Task claim. Node heartbeat measurements independently show Standard/Real Moon event-loop gaps dropping from 2,687/4,481 ms to 13/21 ms.
- Merged main's audio update (`05a58d9`); the sole conflict was appended DECISIONS entries, both retained. Lint, TypeScript and production build pass after merging. Initial full runs had only shared-host timeout failures (biome sampling at 5 s and the existing Real Moon mission at 180 s); no simulation assertions failed and no test timeouts/assertions were relaxed. Final full-suite result follows below.

### Sharing validation and integration

- Post-merge `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` pass. Sharing + merged audio tests pass 28/28 (including all 14 sharing tests).
- Required full `npx vitest run --maxWorkers=2`: 54 files / 705 tests pass, with the existing real Moon mission exceeding its 180-second timeout (248 seconds). Isolated retry likewise times out at 250 seconds; both logs reach Earth splashdown. This matches the merged audio branch's documented contention timeout. No physics or existing timeout settings were changed.
- Collaborative browser checks: share-code generation, editor toolbar fitting 1280 px, hub/flight photo entry/exit and flight UT freeze, compiled depth blur, PNG output at 1920×1200 and 3840×2400. Snapshot automation failed, so no screenshot evidence or visual-quality claim. Port 5196 belongs to the planner worktree; this worktree's review server uses 5199.
- Merged main's audio upgrade, preserving interface audio and silencing flight effects during photo mode. Preserved both branches' progress and decisions.
- Final main merge incorporated `05a58d9` (procedural audio); only append-only DECISIONS/PROGRESS entries conflicted, and both branches’ entries were retained. Surface implementation files merged without conflicts.
- Post-merge checks: lint, TypeScript and build pass; all 37 focused audio/surface/terrain/contact/persistence tests pass. Kept the empty Spacepedia discovery snapshot stable for React external-store subscriptions.

### Planner final integration validation

- Merged main through `981e915`, including sharing/photo mode and the existing Real Moon test's shared-host timeout adjustment (`0c82a16`, 180 → 600 seconds). Retained both sides of appended DECISIONS/PROGRESS conflicts; source merged without conflicts. The planner branch makes no additional timeout or physics-assertion changes.
- Final post-merge `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` pass. Required `npx vitest run --maxWorkers=2` passes **56 files / 724 tests in 300.21 seconds**, including all 11 planner tests and the complete Real Moon mission. Build retains the existing large-chunk advisory. The planning worker's 72.19 kB bundle hash is unchanged by the main merges.


## Flight records and achievements (2026-10-04, cx/flightlog)

- Added adaptive per-vessel circular telemetry, bounded event timelines, lifetime maxima/thrust Δv, surface-relative distance/downrange, landing speed/biome, SOI/orbit/launch/staging/docking/EVA/flags/part-loss/recovery events and save round trips. Staged vessels inherit mission provenance; merged/boarded vessels remain in history. Older saves begin recording when observed.
- Added Flight log in Space Center and Tracking Station, canvas report charts (altitude/time, velocity/time, ascent profile, g-load), statistics and selectable share text. Recovery and Space Center departure show reports; vessel loss opens a report over the loss menu. In-progress checkpoint reports do not end flights.
- Added original achievements with all catalog planet/moon SOI firsts, Moon landing/return, rings, Titan, docking/EVA/flags, careful touchdown, SSTO, shieldless entry recovery, flyby and exploratory/fun feats. Awards use existing in-flight toast messages and a persistent profile independent of program saves. The Achievements panel lists definitions and earned status.
- Added recorder/achievement/persistence tests and assertions in the existing stock-orbiter autopilot regression. Validation and browser evidence recorded after main integration below.

### Flight log validation and main integration

- Stable integrated source at `9f74c3c`: `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npx vitest run --maxWorkers=2` all pass; **58 files / 736 tests**, 164.23 seconds, including the complete Real Moon mission with its existing 180-second limit unchanged. Earlier shared-load retries completed the mission but timed out; throttling expensive staging projections to 1 Hz and using a consistent checkout resolved the final run. A mixed-version test run during a main merge was discarded and rerun on a stable tree.
- Subsequently merged main's planner (`85e2499`), retaining both branches' documentation. Post-merge lint, TypeScript and build pass; focused planner/recorder/stock-orbit/docking/EVA checks pass **5 files / 35 tests**, 14.30 seconds. Main's audio, sharing/photo, surface and visual-effect integrations are also included. Import/documentation conflicts and the pause/photo/report-overlay conflict were resolved with both features retained.
- Recorder tests cover adaptive circular retention, report/history bounds, touchdown details, real World orbit/SOI/recovery states, unattended/prelaunch sampling, packed-thrust rejection, sampled ring-plane crossing, parent-frame flyby conditions, achievement uniqueness/triggers, independent profile persistence/merge and legacy/current save round trips. Existing orbit and docking flows assert recording and achievement output.
- Browser review server uses port 5195. Collaborative preview navigation/snapshot calls failed despite the server returning HTTP 200, so no screenshot or browser visual-review claim. Build retains the existing large-chunk advisory. Retention: 1,024 live samples, 128 retained archive samples, 256 events per vessel and 40 completed reports, alongside all live records. Δv spent integrates physics thrust; remaining Δv is an estimate between 1 Hz projections. Distance/downrange use sampled surface-relative trapezoidal integration; ring crossings and flyby feats use sampled geometry/parent-frame speed rather than a continuous encounter solver.
- Final structural-load integration: merged main `131289f`, logged `structuralFailure` as a part loss, and guarded inherited histories for fragments already destroyed before fleet insertion. Added a World-driven weak-attachment breakup regression. Post-merge lint, TypeScript, build and **8 focused files / 49 tests** pass (12.59 seconds), covering planner, flight recorder, stock orbit, docking, EVA, structure, replication and stress views. The full 58-file/736-test pass above predates this final structural merge; subsequent changes were checked with the focused integration suite.

## Small bodies (2026-10-04, cx/smallbodies)

- Added Vesta, Pallas, Hygiea, Bennu, Ryugu, Itokawa, Eros, Psyche, 1P/Halley and 67P with JPL J2000 elements, physical-source snapshots, Spacepedia descriptions and Surface biomes. Added deterministic irregular terrain shared by contact, close terrain, far silhouettes and map meshes.
- Flight/map coma, blue ion tail, warm dust tail and close sunward jets scale with heliocentric distance. Added 208 deterministic field points, selection orbits and lazy full-body activation on targeting/proximity, including saves/planner restoration.
- Added Pebblecatcher sample-return hardware, robotic sample collector and `setupSmallBodyApproach()` scenario helper. Existing EVA jetpack exceeds small-body escape requirements.
- Bennu testing exposed missing translating-frame acceleration in rigid-vessel integration. Small-body integration now follows the reference ephemeris; microgravity legs use inelastic contacts. A ten-minute standard-scale Pebblecatcher touchdown regression verifies stable late contact, low surface-relative speed and sample collection.
- Focused checks cover periods, high-eccentricity energy/repetition, shape scaling/bounds, SOI floor and low-speed escape patches, actual renderer tail orientation, deterministic activation/save restoration, stock assembly and contacts. Full integration validation follows below.
- Collaborative browser open succeeded, but navigation/snapshot automation repeatedly failed or timed out. No browser visual-quality claim. Local review server used port 5208; preview pages accept small-body IDs and map `ut`.

### Small-body final integration validation

- Merged main through `f787707` (Real Ringrunner structural interstages); source merged cleanly. Final source is `3ed0ce2`, including immediate rails-prediction refresh when targeting a newly activated asteroid and fading tapered comet tails with texture disposal.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` pass. Required clean `npx vitest run --maxWorkers=2`: **66 files / 834 tests pass**, 350.02 seconds, with no exclusions; Saturn also passes after main integration. All eight small-body regressions pass.
- An earlier run saw a newly added assertion against Vite's cached pre-edit World module (833 passing, one activation assertion failure). The fresh focused run passed all eight tests, followed by the complete clean run above with source frozen. No existing tests or timeouts were relaxed.
- Visual limitation: collaborative browser automation failed, so rendering has structural/direction tests and build coverage but no screenshot review. Shapes are radial approximations and comet emission is visual only; see DECISIONS and `docs/data/SMALL_BODIES.md` for source/model limits.

## Functional struts and fuel lines (2026-10-04, cx/struts)

- Added two-click raycast surface anchors for Tension Strut and the original Cascade Fuel Line, five-metre span validation, a green/red rubber-band preview, radial/mirror endpoint copies, transactional undo/redo and deletion when either host is removed or picked up. Link mounts can be selected by clicking their cable and replaced with new anchors.
- Added an axial stiffness load-sharing solve across crossed attachment-tree cuts, brace overload fatigue and `linkBroken` events, directed donor-first crossfeed across otherwise separate flow stacks, and staged separation that disables crossing links while preserving internal links. Host-local anchor coordinates survive rerooting/docking; explicit endpoint UID remaps avoid aliasing broken anchors to incoming hardware. Corrected clone isolation so delta-v/staging projections cannot break live links.
- Shared validated version-1 link data survives craft JSON, offline share codes, world saves, full multiplayer snapshots and JSON deltas, including broken state and link fatigue. Existing craft/save/protocol versions remain compatible with absent link data. Per-frame reusable tube meshes render craft-local endpoints and broken stubs outside static part batches.
- Added 20 regressions covering max-Q brace support below joint failure, overload events, perpendicular/multiple braces, asymmetric staged donor priorities, symmetric drain/cycles, separation, docking rotation/UID remaps, editor two-click placement/history/cleanup/symmetry, serialization/sharing/network validation and rendered endpoints/breaks. New link tests pass 20/20; the first focused existing editor/resource/structure/multiplayer/sharing/mesh suite passes 232/232. Full validation and main integration results follow below.
- Collaborative browser review reached the actual app via the workspace Tailscale address. The editor dev hook and synthetic pointer moves exercised the real view raycasts/placement path: first anchor on part 1, a visible green rubber-band preview to part 2, stored local anchors/normals, one rendered cable, undo to the pending first anchor and redo to the completed link. A second pass placed a fuel line from donor part 2 to receiver part 1, with two cable meshes and WebGL error 0. Native automated clicks and screenshots were unreliable, so no screenshot or visual-quality claim. Renderer tests independently cover endpoint following and broken stubs.

### Struts validation and main integration

- Initial required full `npx vitest run --maxWorkers=2`: 66 files / 839 tests passed; only the explicitly known `world-saturn-real.test.ts` failed at the old weak upper attachment. Merged main `f787707` (Real Ringrunner structural interstages) with both catalog/research additions preserved and no conflicts.
- Added runtime launch validation, explicit clone-isolation/unsupported-part coverage and symmetry deletion/rollback coverage. Post-integration `npm run lint`, `npx tsc --noEmit`, `npm run build` and `git diff --check` pass. The complete required suite passes **67 files / 845 tests in 366.02 seconds**, including all 20 link tests and the fixed Real Saturn mission. Build retains its existing large-chunk advisory. Final map-rendering integration checks follow below.

## Map presentation (2026-10-04, cx/mapviz)

- Map bodies now use the shared flight far-LOD renderer: procedural baked surfaces, banded giants, Saturn ring shadows, atmospheric limbs and a solar glow. Surface bake promises/textures are reference-counted across simultaneous renderers; map lighting does not replace flight's live uniforms.
- Family-coloured antialiased orbit lines fade with distance and retain faint silhouettes behind resolved bodies. Future vessel patches are dashed, and the active trajectory brightens near the vessel. Pointer hover highlights body orbits, shows name/period/apsides and a faint SOI sphere. Body labels and icons avoid collisions; moon visibility follows parent proximity. Focus changes smoothly animate target/distance, with ancestry in map and clickable Tracking Station breadcrumbs.
- Body icons render in a single instanced draw; billboard attributes remain in projected coordinates for solar-system precision. Stable body/fleet/vessel conics retain geometry, including phase/epoch/parabolic-state checks. Scratch vectors, collision boxes, marker pools, line buffers and maneuver directions are reused. Simulation ephemeris/Kepler return-value allocation remains outside the renderer; no zero-allocation physics claim.
- Initial validation: lint, TypeScript and build pass. Required full suite: 64 files/819 tests pass, only the explicitly excluded world-saturn-real.test.ts stock-attachment assertion fails (181.53 s). Four new focused map tests pass. Real WebGL browser regression verifies stable geometry, dashed patches, body picking, maneuver handle dragging (10 → 71.87 m/s), approach markers, resource/comms overlays and Tracking Station, with no browser errors. Screenshot evidence and final post-merge checks follow.
- Port 5199 was occupied by an existing sharing-worktree Vite process, so this worktree uses 5209 without disturbing it. T3 preview navigation/snapshot timed out; used the user-requested scripts/shot.mjs and a repository browser regression harness. Screenshots are software-WebGL evidence, not a hardware frame-rate measurement.

### Map final integration and validation

- Merged main through f787707 (Real scale stock fixes) into cx/mapviz. The final full `npx vitest run --maxWorkers=2` passes **66 files / 828 tests**, 376.49 s, including the updated Saturn Real test. A preceding foreground rerun received external SIGTERM/143; the detached retry completed normally. Final map/planet focused checks pass 11 tests, including simultaneous texture sharing, independent flight uniforms, texture disposal ownership and animation between two vessels sharing one reference body.
- Final `npm run lint`, `npx tsc --noEmit`, `npm run build` and whitespace checks pass. Browser regression passes with zero shader/page errors: 53 stable conics, dashed future patches, hover details, node handle dragging, resource/comms/approach overlays, animated camera distance and Tracking Station entry. Build retains the existing large-chunk advisory.
- Direct map rendering now applies the output colour transform that flight normally gets from its HDR compositor, with premultiplied-alpha handling for rings/atmospheres. Orbit edge/dash coverage is shader-smoothed without requiring MSAA or a postprocess pass. Map bake resolution follows the flight graphics preset; vessel focus identity is separate from its breadcrumb ancestry.
- Final screenshots: `docs/screenshots/map-saturn.png` (`/map-preview.html?focus=saturn&dist=3e8`) and `docs/screenshots/map-solar-system.png` (`?focus=sun&dist=6e11`), both 1280×800, port 5209, via the requested screenshot script. A close-up was also inspected for surface bands/rings, but is not presented as a separate deliverable. Software-WebGL evidence does not establish laptop performance.

- Final main merge incorporated `157f86a` (map presentation/shared rendering). Retained both branches' appended DECISIONS/PROGRESS entries; implementation files merged without conflicts. Post-merge lint, TypeScript, production build, whitespace checks and **10 focused files / 92 tests** pass, including links, editor, resources, structure/stress views, JSON replication, sharing, multiplayer and map presentation. The complete 67-file / 845-test pass above predates this final render-only main merge; no link simulation/editor source changed during it. Review server uses port 5206.

## Integration QA (2026-10-04, cx/qa3)

- Reviewed merged persistence, practice/scenario records, achievements, photo/pause/network lifecycle, structural breakup/docking/audio/VFX, worker authority, legacy craft migration, defaults and input bindings. Fixed program save isolation/deletion/migration, missing replica records, fatigue ownership on docking reroot, missing breakup VFX dispatch, pause audio reactivation, hard-coded photo input and false soft-landing achievements on pad settling.
- Added focused regressions, including before/after failures for paused audio, docking fatigue and the actual Meridian launch recorder. Existing combined-save tests now include discoveries, flight logs/report identity and fatigue; practice and legacy-settings tests cover the merged features together.
- Browser scripts and evidence live in `docs/qa/qa3`; see `docs/qa/README.md` for reproducible commands, measured flights, validation and remaining limits. All edits/commits belong to qa3. Main integration through `f787707` also brings the separately owned Ringrunner Real repair.

- Final qa3 validation at merged source `8cd6d69`: lint, TypeScript and build pass; full `npx vitest run --maxWorkers=2` passes **70 files / 836 tests in 237.62 seconds**, including the upstream Ringrunner Real repair. All **18 Playwright checks** pass with **zero console errors**. Remaining evidence limits include pre-gesture AudioContext warnings, a dark Low-quality Titan sea view and software-rendered/accelerated mission coverage.
### Small-body final main refresh

- The requested final `git merge main` brought in `9851de8` (functional links and map presentation). Resolved appended documentation conflicts by retaining both sides. Combined MapView's graphics-quality argument with the asteroid-field source, retained comet effects and irregular silhouettes with main's PlanetRenderer map path, and used the animated floating origin for field points/tails. Tracking selection now activates a field asteroid before focusing it.
- Post-merge lint, TypeScript, production build and whitespace checks pass. **10 affected files / 88 tests pass** (27.44 s), including all eight small-body tests plus map presentation, functional links/editor links, contact, body data, stock craft, persistence, planning and rails. The final Tracking Station adjustment was followed by another lint/type/build pass and **2 files / 8 map/rails tests**. The full 66-file / 834-test pass above predates this last main refresh; no broader full-suite claim is made for the final merge.

## Opt-in precise gravity (2026-10-04, cx/nbody)

- Added per-save, default-off precise gravity and Lagrange visibility settings with old-save compatibility. Fixed physics receives all registered body perturbations in the translating frame; precise rails uses adaptive RK45 with tight tolerances, ephemeris caching, encounter guards, accepted fleet steps, an 8 ms integration budget and lower-warp fallback.
- Added incremental numerical map polylines, impulsive maneuver splitting/interpolation, refined distance-minimum encounters, visible partial/truncated-path status, and L1–L5 markers for four requested pairs. Added original Spacepedia text and explicit patched-conic planner/autopilot warnings. No CSS changes. Numerical rails state is included in replica deltas.
- Sixteen focused tests pass: bit-exact OFF trace from unmodified `92c21203`; save isolation/load, physics/rails agreement, replica preservation; two-body energy and CR3BP Jacobi conservation; perturbed L4/L5 stability over 50 circular lunar periods; L1 drift; full-catalog L4/L5 libration over ten periods; independent analytic-Moon RK4 reference; impulsive nodes/minima; fleet performance and lunar terrain entry guard.
- Full-catalog benchmark: solar cruise achieves ~992,000× at 60 Hz (0.70 ms median / 4.87 ms p95 World ticks); high Earth orbit falls back (~77,500×, 9.15 ms median / 29.62 ms p95 under repeated maximum requests). Integration time budgets are cooperative, not hard deadlines. Detailed model limits, sources and reproduction commands are in `docs/physics/PRECISE_GRAVITY.md`. Required full-suite/build and final main merge results follow.
## Environmental hazards (2026-10-04, cx/hazards)

- Added category pressure ratings, pressure-overload failure and a scaled equipment heat reserve alongside existing skin/reentry heating. Gas-giant dives use a below-datum pressure/temperature profile instead of the World radius-fraction cutoff. Added Kiln Venus core/shell and Bastion shielded avionics with explicit research tiers and existing meshes.
- Added Earth/Jupiter/Saturn radiation belts, per-part accumulated dose, degradation/failure of probe control and instruments, connected-vessel shielding and roster-owned crew dose warnings. Physics, EVA, landed/prelaunch and orbital rails integrate exposure; parent radiation remains active inside moon SOIs. Saves, clones, staging/docking ownership and compact network deltas retain hazard fields.
- Added shared geometric eclipses for physics thermal sunlight, panel charging and rails solar power. Flight data includes ambient conditions/ratings, equipment soak, dose rate/accumulated dose, crew dose and sun/shadow. Body articles carry hazard notes. No CSS or React component changes.
- Focused initial tests: 12/12 pass, covering ordinary Venus pressure and independent heat failure, finite hardened reserve at Standard/Real, full thermal survival, physics pressure destruction, radiation control failure/shielding, mild LEO/Saturn dose, parent belts inside moon SOIs, orbital/landed warp, real panel eclipse charging and save/clone/delta/instrument behavior. Full validation results follow after completion.

### Hazards validation and main integration

- Required `npx vitest run --maxWorkers=2` passes **75 files / 894 tests**, 540.00 seconds, including Standard/Challenging/Real Moon, Saturn, Real Ringrunner, Titan and real reentry. All 14 hazard regressions pass. No existing tests, mission assertions, part performance or timeouts were relaxed.
- `npm run lint`, `npx tsc --noEmit`, `npm run build` and `git diff --check` pass. Build retains the existing large-chunk advisory. The final compact rails battery/dose replication correction also passes **4 focused files / 27 tests**, including hazards, structural replication and both multiplayer suites.
- The first broad run exposed premature battery depletion in the stock lunar return capsule from newly introduced rails command consumption; that run was stopped. Retained the existing background hibernation behavior while keeping eclipse-aware solar charging and continuous radiation/heat exposure. The corrected full run above completes Earth touchdowns at Real and Challenging scales.
- `git merge main` reports already up to date with `92c2120` (small-body integration). UI changes are confined to the Flight data adapter and Spacepedia data; no CSS or React components were edited. Model approximations, original calibration and physical-source links are documented in `docs/physics/HAZARDS.md`.

### Precise gravity integration and browser verification

- Merged main `74be53b6` (environmental hazards), preserving both sets of imports, protocol extensions, and documentation. Precise rails now samples hazards on Hermite-interpolated accepted numerical steps; spawned hazard fragments join the next fleet step. The combined gravity/hazards/rails/multiplayer suite passed 44 tests.
- Fixed a browser-discovered incremental prediction refresh issue: unfinished coast work is allowed to finish, and the completed path stays visible while a replacement computes. Added cache-lifecycle and merged radiation regressions; **18 precise-gravity tests** and five map-presentation tests pass.
- T3 preview returned an explicit “No preview automation host” error. Used the permitted local headless Chromium fallback, exercising real Gameplay checkboxes and the live flight map. Result: 152 numerical samples, 20 Lagrange markers, two rendered lines, WebGL error 0 and no page errors. Inspected `docs/screenshots/nbody-map.png` with the help overlay dismissed; Earth–Moon L4/L5 labels, numerical path and maneuver handles are visible. Software WebGL is not a hardware FPS benchmark.
- Post-merge benchmark including hazards: solar cruise ~996,000×, 5.84 ms median / 9.44 ms p95; high Earth orbit ~85,000×, 8.82 ms median / 20.58 ms p95 under repeated 1e6× requests. Numerical prediction finished in 26/46 budgeted updates (Earth/solar). Lint, TypeScript, production build and whitespace checks pass after the map-cache fix. Build retains the existing large-chunk advisory.
## Cohesive UI polish (2026-10-04, cx/uipolish)

- Added Observatory design tokens and shared native React controls, original SVG icons, unified screen surfaces/type/spacing/focus states, responsive editor/research layouts and reduced-motion transitions. Polished menu, hub, editor, HUD/map, tracking, progression, reference screens, reports and dialogs without changing gameplay or removing tutorial hooks.
- Fixed the live menu background's hidden canvas, Titan's excessively dark Low-quality daylight sea reflection, and eager AudioContext construction before user activation. Audio regressions cover lazy construction and pending music restoration.
- Merged main in `9da5736b`. Full merged suite: **74 files / 875 tests passed**; lint, TypeScript and build pass. Before/after review comprises 72 screenshots (18 views × two sizes × two phases), with reproduction and browser evidence in `docs/screenshots/ui-polish/README.md`.
- Final main refresh merged `8a4afdf4` (UI polish), retaining the shared upstream controls/style and both per-save toggles. The required full suite was restarted after this merge; the earlier run was intentionally terminated. The post-merge real-browser check again passes with 152 numerical samples, 20 markers and no page/WebGL errors; the screenshot now reflects the merged UI.
- Numerical line geometry now subtracts a Float64 local anchor before GPU buffer conversion; a solar-distance regression preserves a 25 cm separation at 10¹² m. The combined focused suite passes **2 files / 24 tests** (18 precise gravity + six map presentation), and lint/type/build/whitespace checks pass after this final rendering adjustment.

### Precise gravity final validation

- Final source `04b1817f`, including both main merges and the Float64 trajectory-localization fix: **`npx vitest run --maxWorkers=2` passes 76 files / 914 tests in 319.84 seconds**, exit 0, with no exclusions or relaxed existing assertions/timeouts. The run was detached after an interrupted foreground attempt so it could complete reliably.
- Required `npm run lint`, `npx tsc --noEmit`, `npm run build` and `git diff --check` all pass. Browser verification, physical conservation/stability tests, original OFF trace and performance evidence are recorded above and in `docs/physics/PRECISE_GRAVITY.md`. The production build retains only the existing bundle-size advisory.
- Main `8a4afdf4` is merged, including environmental hazards and the concurrent UI polish. Implementation stayed in `/home/nedcut/.t3/projects/wsp-wt/nbody`; no changes were made in the main checkout or other worktrees.

## Flight graphics fidelity (2026-10-06, op/gfx)

- **Green tint on Macs fixed (owner report).** The sun-glare ghosts used `smoothstep(r, r·soft, d)` (edge0 > edge1, undefined in GLSL). Apple's Metal backend extrapolates it, so a mint-green ghost covered the screen and the vessel. All reversed smoothsteps and `pow(x, 2.0)` squares of possibly negative values in the render shaders were replaced, and a static test now rejects both patterns. The fault was reproduced on the RTX 3060 Ti by emulating Metal's behaviour. Lens ghosts and the halo ring are also much subtler.
- **Ocean holes fixed.** Seen from a descending capsule, a jagged brown hole showed where the sea should be. Quadtree culling used seabed bounds, so near chunks whose seabed lay outside the view also lost their water. The shallow shoreline now follows world-space noise instead of triangle edges. Adds the `?scenario=sea` dev placement over the ocean.
- **Retina sharpness:** Medium renders at device resolution with SMAA and adaptive resolution, so the old half-resolution blur is gone (see the before/after crops in `docs/PERFORMANCE.md`). Apple M-series GPUs are classed mid or strong and start on Medium.
- **Speed at DPR 2 (RTX 3060 Ti, GPU timer):** pad 17 → 7 ms and low orbit 32 → 7.7 ms on Medium. The gains come from GPU-baked cloud field and Milky Way cube maps, early rejection of the aurora volume, and per-vertex aerial perspective and ocean sky reflection.
- **Looks:** the cloud field is band-limited with per-pixel detail. It adds fair-weather cumulus fields, forward-scattering silver linings, grey bases from below and cloud shadows on land and sea. The Milky Way is more detailed. Vessel shadows are soft, acne-free and no longer clipped in low sun.
- Validation: lint, `tsc`, full Vitest (88 files / 1013 tests) and the build all pass. Determinism is untouched (no `src/sim` changes).
