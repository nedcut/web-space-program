# Progress Report

_Last updated: 2026-10-08_

## Start here (for Ned)
**Run it:** `npm install && npm run play` (optimised production build, opens http://localhost:4173). `npm run dev` is for development only: it serves unbundled modules with React's debug build and is much slower to load and run. Pick **New Game → Sandbox → Standard** for the easiest start;
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

## A sense of place at the pad and on the Moon (2026-10-08, op/wp5)
- **Launch pad:** hold-down clamp arms now reach in to your rocket's aft skirt (fitted to each craft) and fall back over
  their pedestals the moment the clamps release; the tower's swing arms stand at the vehicle with umbilical hoods and swing
  clear at ignition. Deluge steam boils out of the flame trench and rolls off its exit while the engines fire over the pad.
  The trench and hole are now scorched concrete and steel instead of a black void; buildings have ribbed cladding,
  window façades with sills and grime, textured roofs and darker bases.
- **Cheaper, not dearer:** the whole complex now draws with one layered material (site draws per frame 22 + 11 shadow →
  5 + 3, equipment included). GPU A/B vs main (RTX 3060 Ti, Medium, DPR 2) is in `docs/PERFORMANCE.md`.
- **Moon close-up:** small craters at three scales appear below ~3 km, so 3 km, 500 m and 50 m finally look different;
  rocks sit in the regolith with contact/cast shadows; your lander's shadow falls on the ground (also on Mars etc.); a
  radial dust sheet races out under the engine below ~100 m.
- **Backlit vessels** keep their shape in space (fill + sun-rim lighting): about 2× brighter on the shadow side.
- **Moon night side (round 4):** earthshine now lights it faintly — crater rims are readable from 3 km and from lunar
  orbit under a near-full Earth (it was pitch black: the Earth's light was computed from its green land colour).
- **Small craters are now a High/Ultra feature:** on Medium they cost ~0.25 ms of GPU close to the Moon (+15 % of the
  frame there); High and Ultra keep all three scales.
- **Please look at:** the pad at liftoff (Meridian), and a Moon landing. Note the Suicide Burn mission lands with the Sun
  ~88° high, so the lander's shadow is straight underneath you; a lower Sun there would look far better (scenario change,
  not made). Screenshots: `docs/screenshots/wp5/`.

## CPU pass 2 (2026-10-07, cx/perfcpu2)

Targeted CPU work is committed, with production before/after traces on Windows Chrome at 4×
CPU throttle. **The requested 4 ms CPU frame budget and no tasks over 50 ms are not achieved.**
This is not yet validated on an Apple M-series MacBook or a 120 Hz display.

- Staging reuses the detached hardware's existing visuals/soot. The identified separation task
  fell from 208 to 129 ms; accelerated liftoff physics and recurring render submission remain costly.
- Map toggles retain flight render targets and avoid resetting an unchanged canvas. Warm map
  open/close maxima fell from 85/100 to 65/85 ms. Retaining the targets consumes memory in map view.
- Earth decoding/cropping and bitmap cleanup move to a worker; transfers and uploads are smaller.
  High's unthrottled streaming peak fell from 4.7 to 2.2 ms in the trace-free pair. The final 4×
  capture still has a 57.5 ms cumulative native-step outlier and needs 31.6 seconds of additional
  traced streaming wait. The prior claim that imagery always streams without hitches is not supported.
- The HUD skips unused multi-body impact paths for safe orbits/flybys. The isolated Moon crossing
  maximum fell from 156 to 106 ms. Required impact and warp-target queries remain synchronous.
- Bitmap cleanup no longer runs on the main thread; the worst final ascent task is 208 → 165 ms.
  Autosaves still add 56–68 ms of synchronous persistence work, and settled Medium flight CPU
  remains 19.1 ms/frame at 4× (High: 28.6 ms), well above target.
- Graphics dropdowns now display Low, Medium, High, Ultra, Off, FXAA, SMAA and Unlimited.

All final checks pass: lint, TypeScript, 131 test files (1397 passed, one skipped), production build,
and two trace-parser tests. The full measurements, limitations and remaining work are in
[CPU pass 2](docs/PERFORMANCE.md#cpu-pass-2-2026-10-07-cxperfcpu2), with revision-indexed evidence in
[the capture directory](docs/performance/perfcpu2/README.md). No simulation code changed.

## Real Earth from orbit (2026-10-07, op/earthgfx)

Earth now wears real NASA imagery: monthly Blue Marble colour with sea ice, Black Marble city lights on the night
side, real cloud systems, shallow banks in their true turquoise, and a sun glint whose width follows the wind. It
lines up with the real ETOPO terrain and hands over smoothly to the close-up ground colours as you descend.
Settings → Graphics → Advanced → *Earth texture quality*: Low 2k / Medium 4k (bundled, offline), High 8k (downloads
once, ~25 MB), Ultra 16k (needs `npm run earth:imagery -- --ultra` once, then hosted with the app; ~0.7 GB GPU
memory). Medium costs the same as before on the test GPU (and less on the night side); High/Ultra add bicubic
detail, cloud-top relief and richer water. Imagery streams in the background without hitches. Before/after shots
and numbers: `docs/screenshots/earthgfx/README.md`.

## Smoother on a Retina Mac: ~40 % less GPU time per frame (2026-10-07, op/perfgpu)
You said the game feels slow. On a Retina MacBook the 3D view was drawn at the full 2940×1840 device pixels; an
M1/M2's GPU is 4–6× slower than my test card, so Medium ran at ~25–35 fps on the pad. Changes (no new settings
needed; details and measurements in `docs/PERFORMANCE.md`, "GPU frame cost for Retina Macs"):
- **Sharp upscaling instead of 4× the pixels.** On Retina screens Medium now draws the 3D scene at 70 % resolution
  (about half the pixels) and rebuilds full resolution with an edge-aware upscaler plus sharpening. The HUD and all
  text stay native. In side-by-side screenshots at normal size I could not tell them apart; at 1:1 pixel zoom the
  finest decal text is a touch softer. Settings → Graphics → Advanced → **Retina resolution / upscaling** has
  Native / Quality 85 % / Balanced 70 % (Medium default) / Performance 58 %.
- **Trees around the launch site** were drawn in full detail out to 1.5 km and twice (once for shadows): ~1.4 million
  triangles for trees a few pixels tall. They now switch to a simpler model beyond ~350 m (not visible).
- Low is unchanged by default (it keeps its cheap half-resolution stretch); the upscaler is opt-in there.
- **Cheaper post-processing** (8-bit buffers after tone mapping, bloom merged into tone mapping) and a cheaper sun glare.
- **Adaptive resolution** now uses the same upscaler, so when it has to drop resolution to hold the frame rate it is
  much less visible; Apple GPUs (incl. Safari's "Apple GPU") start on Medium with this enabled.

**Measured on my test GPU at Retina resolution (GPU time per frame, Medium):** pad 4.5 → 2.8 ms, ascent 3.6 → 2.0,
orbit 3.9 → 2.3, Moon surface 1.7 → 1.6, map and editor unchanged (already cheap). High: pad 11.9 → 8.7, orbit
8.1 → 5.6. **Estimate for an M1/M2 MacBook:** the pad goes from ~40–55 fps to ~60, ascent and orbit from ~45–65 to
~80–110 fps, the Moon, map and editor already ran fast. Screenshots: `docs/screenshots/perfgpu/`.

**Please check on the Mac:** play on the pad, during an ascent and in orbit with F8 open; if it still isn't smooth,
use **Copy report** and send it. If anything looks soft, try Advanced → Retina resolution → Quality 85 %.

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
## Performance: CPU, memory and loading on a real GPU (2026-10-06, op/cpuperf)
- New real-GPU benchmark suite (`scripts/bench/gpu-bench.sh`, interleaved `gpu-ab.sh`, `gpu-profile.sh`, `gpu-leaks.sh`): 12 scenarios from pad to Saturn, editor and Tracking Station; frame pacing, CPU per section, long tasks, GC, heap/DOM/listeners, React commits, load timeline, 3-minute soak and a scene-cycle leak test. Results and method: `docs/PERFORMANCE.md` (pass 3).
- Fixed a real memory leak: every flight/editor/Space Center/navball renderer (with its scene and WebGL context) stayed alive after leaving the scene (+1,167 DOM nodes and +560 listeners per menu→flight→editor cycle; 17 live renderers after 3 cycles → 2).
- Simulation 40–74 % cheaper per tick with bit-identical results (rails 1e6× 5.1 → 1.3 ms, Selene landed on the Moon 3.0 → 1.2 ms, vacuum/atmosphere −40 %); in the browser GC time dropped 2–5× (ascent 14 → 5 ms/s, 100 000× warp 14 → 3 ms/s) and the ascent's 15 hitches per 10 s went to 0.
- The remaining frame cost is render-side (three.js submission ~2.5 ms of a ~3.5 ms CPU frame, per-draw program re-resolution, GPU back-pressure, cold-load texture generation); handed to the graphics agent with numbers.

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

## Coherent Earth clouds (2026-10-06, cx/clouds)

- Replaced the scattered runtime cumulus dots with a single coherent weather bake: mid-latitude frontal curls, ITCZ, subtropical clear areas and terrain-aligned west-coast marine decks. Fine noise only textures existing cover; bake and runtime octaves are footprint-filtered. Global solid-angle-weighted coverage is 65.19% at density > 0.1.
- Retained the mipmapped cube resolutions, switched RG8 to R8 (half the logical texture storage), and kept shared cloud shadows, silver linings and grey bases. A single shell pass now writes the actual ray-hit depth, including across the cloud-layer/proxy-mesh gap. The baked weather stays body-fixed to keep coastal decks over water.
- Verified on Windows Chrome / RTX 3060 Ti at 2940×1840, adaptive off, using this worktree on owner-approved port 5318. Medium 150 km orbit cloud cost is **2.35 → 1.10 ms**; full scene is **7.72 → 6.90–6.94 ms**. High globe cloud cost is 0.23 ms. Readback and final screenshots show no WebGL/shader errors. Inspected pad sky, 20 km, 150 km, distant globe, polar, grey-base and shell-crossing views. Evidence and reproducible drivers are linked in docs/PERFORMANCE.md.
- `npm run lint`, `npx tsc --noEmit`, `npx vitest run --maxWorkers=3` (89 files / 1,015 tests, 307.36 s), `npm run build`, and whitespace checks pass. Final shader edits additionally passed focused geography/GLSL checks and lint/type/build. `git merge main` reports already up to date. Changes are confined to the clouds worktree.

## Moon transfers from LEO (2026-10-06, op/moonxfer)

Owner report: zooming out to see the encounter was hard, other handles blocked the node, and "Plan transfer" kept changing every couple of seconds.

- **Root cause of the jitter: physics frame.** At 1×, the vessel is unpacked into rigid-body physics. That integration was heliocentric with only Earth's gravity, so it lacked Earth's own solar acceleration (5.8 mm/s²). The orbit therefore drifted 0.115 m/s per 20 s. The map recomputes its prediction every 2 s, and the Moon periapsis moved 30 → 210 → 580 → 1,050 → 2,130 km over 20 s; the encounter was gone within minutes. Vessels now integrate in the dominant body's translating frame, the patched-conic frame. The same plan now holds at 30.0 km for every sample, through warp to the burn (Node test plus 8 in-browser samples over 14 s).
- **Planner:** it used the best departure in a whole lunar month, so burns were up to 8 days away in Standard and 24 days in Real. It now refines the first good window, with the best window as a fallback. From a 28.5° pad orbit, waits are at most about half a lunar period because the Moon must cross your orbital plane. The message explains this and gives the Δv, the burn and encounter times, and the encounter periapsis. The map then zooms out to frame the Moon's orbit.
- **Zoom:** the wheel and trackpad pinch always zoom. Previously, a scroll over a handle changed the burn by 0.1 m/s per event. Alt/Option+wheel over a handle now steps Δv. The zoom rate is normalised for delta modes, and pinch is boosted. Two trackpad swipes now zoom out ×121 (LEO to beyond the Moon's orbit).
- **Gizmo:** the node centre always wins hit-testing. Handles sit at a constant 60 px, stretched when foreshortened and hidden when pointing at the camera, so none covers the centre. Previously they shrank to 24 px when zoomed out and normal handles could sit on the centre. Dragging the centre works with LEO only a few pixels wide.
- **Encounter readouts:** the encounter caption reads "Moon encounter · Pe 30.0 km", and the node menu shows "Encounter Moon · Pe 30.0 km". Tab-focusing an encountered body frames its SOI and draws the flyby around it with its Pe marker.
- Evidence (RTX 3060 Ti, DPR 2, 1470×920, `?flight=stock-selene&scenario=orbit`, driver `C:\wsp-tools\drv\moonxfer.mjs`): `C:\wsp-tools\shots\mx3-3-planned.png` (framed plan), `mx3-6-node-menu.png`, `mx3-7-focus-moon.png` (flyby around the Moon), `mx2-2-zoomed-out.png`, `mx2-5-drag-node.png` (centre drag at far zoom).
- Tests: new `tests/moon-transfer.test.ts` covers the physics-vs-conic agreement and Moon plans from pad-inclined LEO. It checks 6 Standard and 3 Real epochs for encounter Pe within 5 km, wait under 0.55 lunar periods, and stability under 1× coasting and warp-to-node. `tests/map-maneuver.test.ts` adds zoom/stretch helpers and centre-wins picking at three view angles. The OFF-mode golden trace hash was regenerated for the intentional frame change. Lint, typecheck, full Vitest (90 files / 1,020 tests) and build pass; `git merge main` is up to date.

## Flight effects polish — 2026-10-06 (cx/vfx)

Replaced capped point sprites with pooled GPU billboards; added growing launch steam, pressure/density-gated trails, ballistic airless regolith, throttle-weighted engine light, RCS puffs, cold separation/chute puffs, splashdown spray and cooling explosion embers. Corrected the crossed re-entry sheath and added a thin transonic condensation cone. Changes stay in render effects plus their controller hooks. Real-GPU verification and paired screenshots are in [docs/screenshots/vfx/README.md](docs/screenshots/vfx/README.md). RTX 3060 Ti, DPR 2 Medium: fixed liftoff plumes + particles **0.109 ms** (live chase **0.066 ms**) against the 1.5 ms target. Main merged; lint, typecheck, all **93 files / 1,036 tests** (163.57 s) and build pass. The seven-scene post-merge GPU sweep had no page/shader errors; port 5331 was stopped. Remaining: screen-space heat refraction, scene-depth soft particles, optional wingtip vortices and tumbling mesh debris.

## Sound polish (2026-10-06, cx/sound)

- Extended the existing offline synthesis with engine start/stop and flameout transients, shared launch/camera rumble, transonic boom, planet-colored airflow, fairing pyros, stress creaks/alarms, pre-contact-speed touchdown and splash sounds. Added SAS/RCS/warp/node cues and a program-contract completion stinger. Existing distinct engine, chute, docking and mechanical layers remain.
- Added four pooled nearby-vessel stereo voices, distance/air attenuation for explosions, a distinct editor ambient theme, intensity-driven music ducking, separate Interface & alarms volume, master compression plus a soft safety ceiling. Pausing/hidden tabs suspend audio; scene exits silence flight pools and retire effects/music tails. The 20 Hz flight adapter reuses aggregate/snapshot objects. No new media downloads, assets or dependencies.
- Tests cover mappings, reserved voice capacity, live bus volumes, pause/visibility, touchdown speed, warp cues and repeated scene lifecycle/disposal. `scripts/audio-probe.mjs` runs in the supplied Windows Node/Chrome environment against port 5330 and checks actual scene changes plus eleven OfflineAudioContext renders at maximum sliders.
- Remaining: human headphone/speaker listening and artistic balancing; nearby engines use a shared distant roar rather than per-engine timbres; scenario-debrief stingers are suppressed by the intentional full pause. Persistent silent pools are deliberately retained across scenes, then fully released on app disposal.
- Verification: `git merge main` was already up to date; lint, typecheck, full Vitest (**93 files / 1,033 tests**, 213.80 s), build and whitespace checks pass. The existing numerical-rails radiation test needed bounded retry frames for its 8 ms integrator budget; physics was unchanged. Windows Chrome/CDP: no console errors; live scene transitions peaked at **210 nodes**, settled to **134 nodes / 39 sources / zero transients**, and resumed after pause. Eleven maximum-volume offline renders had no NaN/Infinity/clipping; worst peak **0.940515**, and every disposed graph had zero nodes/sources. Vite's existing large-chunk/dynamic-import warnings remain. The probe uses the running app's debug handles to avoid duplicate Vite modules after HMR. Port 5330 was stopped after verification.

## Snappier rendering at Retina resolution (2026-10-06, op/snappy)

- **Launch pad at DPR 2 / Medium (RTX 3060 Ti, adaptive off): 47.6 → 56 fps, frames over 25 ms 120 → 37 per 10 s, GPU 6.9 → 4.45 ms, CPU 5.3 → 3.9 ms.** Orbit 45.7 → 52.7 fps. The whole frame's GPU cost fell 38 % (6.24 → 3.87 ms fenced). With adaptive resolution on (the default) a Mac now settles at a higher, sharper resolution.
- Where it came from: night-light noise computed in daylight, the sky march running under terrain, over-fine site haze integration, terrain LOD doubling at Retina (888 → 621 draws), and part/site materials re-resolving their shader programs every frame (14 → 0).
- Adaptive resolution reacts to a steady 45–55 fps (ProMotion displays, no GPU timer) and undoes reductions that don't help instead of blurring for nothing.
- Map: 59 → ~9 layouts per second (labels move with transforms). Loading: the flight scene is ready ~1.5–2 s sooner, shader warm-up no longer freezes the loading screen, and the first frames don't stall on uploads.
- Visuals unchanged: before/after at DPR 2 in `docs/screenshots/snappy/`. Details, method and what's left: `docs/PERFORMANCE.md`.

## Coastal ground art — cx/groundart

Added original branched coastal vegetation with wind and fading LOD, warmer detailed façades/roof plant/signage, dusk windows and pad work lighting, worker-evaluated coastal colour, stronger surface grain and night settlements. Terrain receives the existing widened solar shadow map. Real RTX 3060 Ti DPR-2 Medium: original pair 4.85 → 5.06 ms; two repeat pairs average 4.96 → 5.52 ms (+0.56 ms). Contended per-pass scene/shadow delta +0.83 ms. See [performance evidence](docs/PERFORMANCE.md) and [six-view review](docs/screenshots/groundart/README.md) for limits. Merged main including flight handling; lint, typecheck, 98 files / 1,099 tests and build passed. Heights/hydrology and the existing atmospheric integration are retained; vegetation remains stylized and the wider shadow map softens fine shadows.
## In-the-moment UX cues (2026-10-06, cx/cues)

- Added staging/throttle/warp/control explanations; a bounded, deduplicated accessible flight-message stack; orbit, landing, communications and SOI notices; per-save dismissible map/node/orbit/SOI/landing/EVA tips; clearer unavailable part actions and HUD tooltips.
- Editor preflight review covers first-stage engines, launch TWR, command source, crew parachutes, fuel paths, separator order and estimated aero instability, with “Show me” part highlighting.
- Unified error recovery for React, frame/promise and terrain-worker errors: copy report, return to Space Center, reload existing quicksave. No recovery write overwrites saved progress.
- Real Windows Chrome / RTX 3060 Ti at DPR 2: staging refusal, map tip dismissal, quicksave→worker-error→reload, dismissal persistence, and editor highlighting passed without browser errors. Inspected screenshots in `docs/screenshots/cues/`; messages/tips clear the navball and staging. Repro: Windows Node runs `scripts/cues-browser.mjs` against Vite port 5335.
- Limits: aerodynamic check is a small-angle static estimate; authority warning detects zero aggregate torque rather than marginal per-axis performance. Human screen-reader/listening and extended interplanetary playthrough remain useful follow-up QA.
- Verification: `git merge main` up to date; lint, typecheck, full Vitest **96 files / 1,052 tests** (286.82 s), production build and whitespace checks passed. Existing large-chunk/mixed-import build warnings remain. Port 5335 stopped after browser checks.

## Flight feel, pass 2 (2026-10-06, op/feel)

- **Pad:** staging now lights the engines with the rocket held down; it lets go once thrust beats weight ("Liftoff!", ~1 s on the Meridian), with no sag or hop at release and no movement while held. Rockets at rest on the pad: under 0.1 mm movement and no rotation; in the real browser the camera moved under 0.2 mm per frame on the pad.
- **Runway:** planes used to drop 15–30 cm onto their gear at 0.8–1.1 m/s and slide 15–32 cm when the flight loaded; they now start at rest on compressed gear (≤ 0.01 m/s, 1–2 cm). The Daybreak's main gear was bottomed out on its stops and is stiffer now.
- **Staging:** stronger decoupler kicks and spent engines cut at once, so debris drifts clear (0.3–3 m after 1 s, 5–16 m after 3 s on stock rockets). The camera and the drawn rocket stay put when the centre of mass jumps, and the reframe onto the smaller stage now glides over about 1.5 s instead of a snap zoom (browser, Kestrel: largest camera step 1.18 m → 0.30 m per frame).
- **Landing legs/wheels** absorb a firm touchdown instead of bouncing it back (1–2 m/s drops on the Moon: one small rebound ≤ 0.2 m/s, settled in 1.1–1.6 s). Hard landings kick the camera; camera shake has a slider (Settings → Accessibility).
- **Controls:** Alt + W/S/A/D/Q/E trims (Alt+X clears; TRIM readout by the SAS buttons), fine control also slows the throttle. SAS settles every standard stock craft without overshoot or wobble (small craft 30° in 1.3–2 s; big upper stages 13–25 s for 90° on reaction wheels).
- **Time warp** says why it did not go faster, including the altitude the next rate needs.
- **Smoothness:** render interpolation measured at 60/120/144 Hz, with uneven 6–22 ms frames and in 4× physics warp (judder ≤ 0.5 %); in the browser 0.1–1.5 % during liftoff and physics warp.
- Tests: `tests/flight-handling.test.ts` (hold-down, pad rest, runway spawn, separation clearance, warp refusals), SAS on every standard stock craft, staging reframe glide, interpolation cases.
- **Needs your hands:** whether the 1 s hold-down feels right or should release on staging like the genre classic; trim key choice (Alt is also hold-for-fine); plane handling after releasing rudder/roll (the Daybreak yaws back ~0.1 rad/s from weathervaning — realistic, but could be damped harder); camera shake strength at 1.0; the strength of the new decoupler kick.


## Rocket part surfaces (2026-10-06, cx/partsart)

- Refined original procedural PBR paint, metal, foam, ablator and crinkled foil; softened oversized seams/wear, corrected nozzle temper UVs and contour, bevelled small RCS/leg hardware, strengthened hangar fill and added a lit planet disc to the low-resolution PMREM. Existing hardware detail and batching remain; no downloaded assets or new runtime dependencies/passes.
- Fixed invisible part heat after vessel material restoration. A compact shared radiance texture preserves independent skin and burn-history glow through static merging, instancing and stress overlays, without per-part shader variants or draw-time program churn.
- Captured 28 DPR-2 real RTX 3060 Ti screenshots and critically inspected close-ups: three stock editor crafts, pad/orbit close-ups, engine bell, controlled long-burn glow, actual simulated 1101 K shield heating. Comparisons, reproducible drivers, raw timings and limits: `docs/screenshots/partsart/README.md`.
- Thirty-part Medium / DPR-2 acceptance: **+0.285 ms median adjacent-pair GPU delta** (240 pairs; budget +0.5 ms), **248 vessel draw groups unchanged**, **zero program re-resolutions**, **+2,400 vertices / +768 triangles**. All-30-parts hot/changing stress also uses the compact lookup; the rejected attribute-streaming experiment and earlier timing variation are recorded in the evidence.
- Current main merged; lint, typecheck, **99 files / 1,102 tests**, build and whitespace checks pass. Remaining: directional skin glow, accumulated charring/erosion, and reflections of nearby geometry; the current cheap environment is a sky/planet approximation. Screenshots stay out of the runtime bundle.

## Vessel art, pass 2 (2026-10-07, op/partsart2)

- Rockets no longer read as plain white cylinders. Tanks now have:
  - A new 2 m painted skin: panel-by-panel tone and gloss, 8 mm seams with rivets, hatches and stencils.
  - Bright stepped metal end rings with bolt flanges, raised weld lands, and a cable raceway plus pressurisation line with clamps.
  - Stringers on black adapters and a ribbed intertank band on long foam tanks.
  - A big "WEB SPACE PROGRAM" wordmark and an original program flag.
  - Soot, stains and per-part paint tone baked into vertex colour.
- Engines gained chunkier gimbal actuators with hoses and banded bells, and the bell tone step is fixed. Foam has spray bands and mottling.
- Every part gets baked ambient occlusion: crevices, under rings, inside trusses and bays. It goes through `vertexColors` on all part materials, so there are no new shader variants.
- Hangar lighting now shows form: stronger key, less fill, stronger rim, plus a new cool kicker.
- Real RTX 3060 Ti at DPR 2: 14 before/after shots plus side-by-side crops in `docs/screenshots/partsart2/` (see its README). 30-part paired GPU delta is **+0.19 to +0.30 ms** (budget +1.0), with 1,043 → 1,057 draws, 0 program re-resolutions and 91 programs unchanged. Selene goes from 67.7k to 83.3k triangles; every part stays within the 8.5k-triangle part budget, and the new fine geometry is High-detail only.
- Left: soot is not tied to the actual engine position or burn history; there is no AO between neighbouring parts; pods, legs and panels only gained AO and lighting.

## Hangar presentation — 2026-10-07 (`cx/hangar`)

- Added a visible service gantry, lifting blocks and low work bays; darkened matte wall/door cladding, softened fixtures, introduced nearer blue depth fog, and restrained floor reflections so the craft remains the focal point. Stronger editor-only charcoal/colour accents and engine tones retain shared flight materials unchanged.
- Fixed the contact-shadow alpha fade. Hollow, dark-edged attach rings stay readable while zooming; selection and snapped attachment screenshots are included. The browser smoke test successfully snaps, places and undoes a tank. Shadow maps are reused while the craft is stationary and invalidated by assembly/held-part changes; coplanar decals no longer add redundant alpha-tested shadow draws.
- Evidence and reproducible hardware benchmark: `docs/screenshots/hangar/README.md` (Selene/Meridian close and wide, selection/free-node/snap; RTX 3060 Ti, Chrome CDP 9333, 2940×1840). Steady frames improve; forced-shadow-refresh acceptance is recorded alongside the raw paired samples. No new flight shader features; the material-isolation regression passes.
- Validation: merged main `94e5930e`, preserving both branches’ appended decision/progress notes. Final post-integration full Vitest passes **106 files / 1,126 tests**, including the material/decal regression. Lint, `npx tsc --noEmit` and production build pass. Both sides of the screenshots were refreshed with the integrated toolbar/preflight UI; the hardware benchmark was repeated. Existing bundle-size/mixed-import build advisories remain. Only the hangar worktree and port 5322 were used.
- Limits: soft elliptical contact footprint and static hall-only reflection probe, no live craft mirror/SSAO; GPU measurements cover these fixtures at Medium/DPR 2 and exclude compositor/startup time. Other presets, arbitrary custom craft and laptop hardware were not benchmarked.
- Final forced-refresh repeat: worst case Selene wide **0.963 → 1.284 ms (+0.322 ms)**; median adjacent-pair delta +0.302 ms, within the +0.5 ms budget. This deliberately rebuilds the shadow every frame. The two final raw runs are retained as `dirty-metrics.json` / `dirty-repeat-metrics.json`; normal cached-shadow renders are faster than main.

## QA bugfixes, pass 5 (2026-10-07, op/bugfix5)

- **Load restores the right craft:** each program now keeps its own editor draft. Loading program A brings back A's craft (or an empty editor), never the one you were building in program B. Saves and exported save files carry their draft.
- **Controls overlay:** while it is open, throttle, staging and steering do nothing. Opened from the Pause menu, it keeps the game paused and closes back to the Pause menu.
- **Alt+L (staging lock)** no longer nudges the craft sideways with RCS. Trim chords (Alt + W/S/A/D/Q/E, Alt+X) only trim.
- **Editor toolbar fits small windows:** Launch and Exit stay visible down to 760 px wide. File, sharing and centre-of-mass/thrust/lift tools move into a "⋯" menu below 1200 px. Screenshots are in `docs/screenshots/bugfix5/` (`*-before.png` shows the old overflow).
- **Full storage no longer crashes the game:** leaving the Tracking Station (Back/Fly), autosaves, hub saves, settings and editor saves now keep going and show "Couldn't save — storage is full" with a hint.
- Tests: `tests/program-draft.test.ts`, `tests/flight-modals.test.ts`, the Alt-chord case in `tests/input.test.ts`, `tests/editor-toolbar.test.ts` and `tests/storage-full.test.ts`. Browser checks: `node scripts/bugfix5-browser.mjs toolbar|draft|controls|quota` (Vite on port 5321).
- **Needs your hands:** whether the Controls overlay should also pause the simulation when opened in flight (it currently only blocks input).
- cx/balance Task A: Selene normal ascent checked headlessly (max loaded-air AoA 8.66°); estimator now samples fuel travel/Mach and control authority. Stable stock launches pass; forward fixed fins and uncontrolled heavy-tail regressions warn. All stock advisories audited: remaining parachute warnings correctly identify crewed vehicles without parachutes (powered/runway/orbital recovery is intentional). No physics changes.
- cx/balance Task B implementation: starting-only Firstlight reaches orbit in a real career World; Meridian reaches the Moon SOI with only 20 science of research. Contract target gates, Moon flyby milestone, earlier essential unlocks, and repeatable recovery funding are implemented with regression tests. Finishing the reproducible balance tables and full integration checks next.
- cx/balance Task B analysis: docs/BALANCE.md plus reproducible scripts cover all stock costs/Δv/research/advisories, tier envelopes at three scales, science/credit flow and a tested 12-mission Standard ledger (orbit 4; Moon flyby 11; no salvage needed). Larger-scale orbital research reduced to 280 science by moving three-metre hardware into tier 2. Recovery funding remains available after repeated bankruptcies even with full contract slots. Focused flight/progression tests pass. Full integration initially found old reward and stock-index assumptions; those are corrected, preserving existing stock order.
- cx/balance review: route emergency funding through World’s progression adapter and message flow, so the Mission Control UI requests the operation without settling finances itself; cover career-only access and refusal in sandbox.
- cx/balance stock-audit completion: include the editor’s actual first-stage stats in every stock preflight. Six destination/orbital designs correctly warn for Earth launch TWR < 1 (Pebblecatcher, Moonmoth Delivery, Bedrock, Longreach, Emberleaf, Hazewalker); the original parachute advisories also remain valid. docs/BALANCE.md now lists measured Earth TWR alongside costs/Δv. Selene has no warning.
- cx/balance pre-merge verification: lint/layering, `npx tsc --noEmit`, production build and full `npx vitest run --maxWorkers=2` pass (101 files, 1,115 tests). Existing deterministic golden trace is unchanged. No physics parameters or trace fixtures changed. All code and analysis work committed before merging main.
- cx/balance final verification: `git merge main` reports already up to date (main f4784124). Post-merge lint/layering, `npx tsc --noEmit`, `npm run build`, and full `npx vitest run --maxWorkers=2` pass again: 101 files / 1,115 tests. The original deterministic golden trace still passes without regeneration. No dev server was needed. Tasks A/B, analysis, and notes are committed; worktree clean.

## Vessel art, pass 3 (2026-10-07, op/partsart3)

- The rest of the rocket now matches the tanks and engines from pass 2:
  - **Capsules**: framed, bolted windows; hatch hardware; charred heat shields on a bolted carrier ring with compression pads; recessed RCS ports with plume staining; shingle straps or blanket tapes.
  - **Landing legs**: a pinned clevis, a hydraulic strut and gusseted pads, plus telescoping braces that stay attached through the deploy animation.
  - **Solar arrays**: framed honeycomb panels with cells on one face, busbars, a back truss, hinges and an array drive.
  - **Decouplers**: a clamp band with pyro bolt cutters, explosive-bolt bumps and a firing harness.
  - **Wings**: leading-edge strips, spar/rib lines, hinge-gap seals and brackets.
  - **Wheels**: split-rim hubs, brakes, and torque links that follow the suspension.
  - **Small parts**: chutes, RCS blocks, nose cones and shields got smaller touches.
- **Soot now follows the engines.** It is baked per craft around each nozzle and in the plume path onto the stage below, scaled by engine size. Parts away from engines stay clean (editor and flight).
- Real RTX 3060 Ti, pad, DPR 2: the paired GPU delta vs main is **+0.20 ms** over 600 pairs (+0.33/+0.35 ms in shorter runs; budget +0.4 ms). The material set is unchanged at 51, with 0 program re-resolutions and no new programs. Selene goes from 84k to 112k triangles; every part stays under the 8.5k High budget, and Low is now tested too.
- Before/after (including a Selene lander on the Moon) are in `docs/screenshots/partsart3/` (see its README for crops, numbers and known limits).
- Current main merged; lint, typecheck, **107 files / 1,296 tests** and the production build pass.


## Adjustable graphics — cx/gfxsettings (2026-10-07)

Implemented Ultra and visible Custom overrides, all requested advanced controls with cost explanations/tooltips,
persistence and graphics-profile-2 migration. Earth knob coordination commit: `a54b3df2`
(`GFXSETTINGS-KNOBS-READY`); Ultra values are included in `8d1a1c21`. GPU auto-detection remains conservative.
Live pipeline controls and snapshot-preserving flight rebuilds are differentiated in the UI. 30/60/120/unlimited
caps cover flight, Space Center, editor and tracking; adaptive resolution respects deliberate caps.

Verified UI at 1024×768 and 800×768 (scrollable body, no horizontal overflow, every select accessible),
Custom selection and stored overrides. Screenshots: `docs/screenshots/gfxsettings/`.
Real RTX 3060 Ti / Windows Chrome CDP check passed 15 advanced changes plus four cap settings without
browser or GL errors: `docs/performance/gfxsettings/live-controls.json`. Preset measurements and limits
are documented in `docs/PERFORMANCE.md`. Ultra's larger bake exposed the old far-sphere threshold removing
close-up terrain; the threshold is bounded and a regression test covers pad/orbit activation.

Post-merge verification: `git merge main` reports already up to date (`main` at `0b3f8cb2`);
`npm run lint`, `npx tsc --noEmit`, `npm run build` and full
`npx vitest run --maxWorkers=2` pass (**108 files / 1,317 tests**, 441.19 s).
## Real Earth geography — terrain integration ready (cx/realearth)

- CC0 ETOPO pipeline and committed 16 MiB real elevation/bathymetry, exact imagery alignment contract in `public/earth/manifest.json`.
- Main/worker/Node loading, deterministic sampler, real coast cloud mask through shared height function, scaled relief, bounded sub-grid detail, geographic ground colours and science classes.
- Existing launch plateau/runway geometry and legacy biome IDs retained. Targeted terrain/science/nbody suite: 41 tests pass; production build passes and precaches Earth data.
- Graphics agent can merge the `REALEARTH-TERRAIN-READY` commit. Earth imagery/effects remain owned by op/earthgfx. Remaining: worker/seam/data regressions, performance, full checks, main integration and screenshots.

### Real Earth validation follow-up

- Exact worker/main heights and chunk arrays, source/output SHA-256, known features, antimeridian/poles/internal grid seams, pad/runway, all scales, real station/airfield land, cover regions, legacy science archive/contract preservation and cloud-mask orientation are covered by tests.
- Baseline/current 20-second ascent hashes are identical. No golden trace updates. Three paired chunk cases improve from 3.8–4.5 ms to 0.7–1.2 ms (shared-host CPU results; see docs/PERFORMANCE.md).
- Real-GPU orbit and launch screenshots committed under `docs/screenshots/realearth/`. Lint/layering, typecheck and production build pass. `git merge main` reports already up to date at `0b3f8cb2`.
- Node benchmark entry points now bootstrap the data; the browser planning benchmark awaits browser loading. Planning workers receive the initialized buffer directly, avoiding a redundant fetch per request and keeping the production worker usable in Node's worker bridge.

### Real Earth complete — final verification (2026-10-07)

- `git merge main`: already up to date with `0b3f8cb2`.
- Final post-integration `npm run lint`, `npx tsc --noEmit`, `npm run build`: pass (existing bundle-size advisory only).
- Final `npx vitest run --maxWorkers=2`: **108 files / 1,306 tests pass**, 411.54 s. Earlier full run: 108 / 1,305 pass; the added internal-grid seam regression accounts for the count change.
- Pipeline regenerated identical bytes/hash. Production PWA cache verified at 16,777,216 Earth bytes; after stopping the server the orbit flight still loads, with a sampled height exactly equal to Node. Evidence in `docs/screenshots/realearth/offline-check.json`.
- Servers stopped and automation tabs closed; temporary service-worker registration removed. Only `cx/realearth` worktree changed. Terrain-ready integration anchor is `5990a805`; merge the branch tip to include subsequent parity, loading and verification fixes.
- **Zen startup fix (2026-10-07):** Reproduced New Game → Start leaving a blank page in the live Zen tab. The scene music switch threw because `AudioParam.cancelAndHoldAtTime` is unavailable. Added feature detection and a current-gain fallback using `cancelScheduledValues`/`setValueAtTime`. All 26 focused audio tests and typecheck pass; live Zen now opens Space Center and renders Vehicle Assembly.

Integrated the newly landed real Earth geography from `main` at `8e91a05d` (merge `e5aaf9af`), resolving
only documentation append conflicts and preserving both teams' notes. Re-ran lint/typecheck/build and the
full suite: **109 files / 1,327 tests**, 407.78 s. Re-measured all four presets in pad and orbit on the merged
production build; final raw data is `docs/performance/gfxsettings/gfxsettings-merged-*-dpr2.json`.
Earlier GPU runs are labelled and archived separately so their revisions cannot be confused.

Final Ultra pad capture uses the requested Windows `cdp2.mjs` driver; after preparation it confirms the
exact Ultra Earth grades, 48-quad terrain / 0.75 m spacing, hardware RTX rendering and GL error 0.
All work is committed on `cx/gfxsettings`; the port-5327 dev/preview server is stopped on completion.

## Loading and main-thread CPU (2026-10-07, cx/perfcpu)

Implementation and repeatable production probes are committed incrementally in the assigned worktree. The editor profile attributes over four seconds to eagerly preparing the entire thumbnail catalogue; preparation now yields between parts and pauses on scene exit. Earth/application downloads overlap, distant flights omit hidden launch scenery, site transforms avoid a duplicate subtree traversal, map warm-up is sliced, and cosmetic scatter no longer blocks flight readiness. Thermal/link bookkeeping skips exact redundant work. Production before/after results and validation are recorded in docs/PERFORMANCE.md; hardware CPU throttling is unreliable on this shared Chrome, so synthetic WSL 4× diagnostics are kept distinct from RTX runs.

Completed paired production measurements and retained page-scoped Chrome traces plus repeatable transition/flight drivers in `scripts/bench/`. Warm editor entry 4.664 → 0.804 s; launch 7.530 → 3.249 s; quickload 6.441 → 2.741 s; revert 6.399 → 2.722 s. A bounded 16 MiB immutable surface-pixel cache removes repeated worker bakes while keeping GPU disposal intact. Hardware steady-flight CPU is mostly unchanged; the full ascent trace still has two >50 ms tasks. Moon terminal descent has none in its ten-second trace. Hardware 2×/4× throttling stalls; WSL 4× no-raster diagnostics are explicitly separate, and no M-series/120 Hz or ≤4 ms-at-4× claim is made. All targets/limits and raw evidence are in `docs/PERFORMANCE.md` and `docs/performance/perfcpu/`.

Final main merge was already up to date at `7bd6e4f9`; post-merge lint, TypeScript, all **112 files / 1,334 tests** (216.99 s), and production build pass. Ten determinism hashes match byte-for-byte; `src/sim` is unchanged. Dedicated preview port 5334 is stopped, and benchmark browser contexts are closed. Work stayed entirely in the assigned `cx/perfcpu` worktree and each implementation/evidence step was committed.
### UI responsiveness — implementation (2026-10-07, cx/perfui)

- Work isolated to `wsp-wt/perfui`. Read project architecture/decisions/performance guidance and merged main before measuring.
- Production WSL Chromium, 4× CDP CPU throttle, 1470×920 CSS / DPR 2 baseline: catalogue search p75 1543 ms, hover 1334 ms, symmetry 1297 ms, pick/cancel 4600 ms; cold/warm first 18 thumbnails 25.6/15.1 s after editor entry. Software GPU, overlapping cold thumbnail work: these are diagnostic costs, not Apple frame-rate estimates.
- Committed repeatable catalogue/large-craft/flight probes, opt-in production profiling, demand-driven persistent thumbnails, unchanged-craft/readout/attach-node reuse, cheaper panel compositing and ref/rAF HUD dragging. Editor cache invalidation tests and 38 focused editor tests pass. Final measurements/integration checks follow below.

### UI responsiveness — measured follow-up

- Found and removed two additional interaction stalls: 934 ms synchronous whole-craft soot on attach (now ~34 ms handler, exact cosmetic bake in idle batches), and 14 seconds serializing procedural texture canvases when cloning tinted symmetry ghosts (weak-map material bookkeeping fixes the clone path).
- Preflight advisories now run in a worker; final browser probe shows completed checks and no page errors. Batched soot matches synchronous float32 colors exactly, retains clean templates and handles hall recentering. Lamp/tint and idle cancellation/serialization regression tests pass.
- Final palette production capture p75: search 35 ms, hover 42 ms, scroll 57 ms, symmetry 84 ms, pick/cancel 74 ms. Timestamp-inclusive values: 36/56/63/99/85 ms. Warm first 18 thumbnails 15.1 s → 225 ms; cold 25.6 s → 14.3 s on software Chromium.
- 100-part CPU-isolated held motion ~59 fps after removing the serialization stall, attach/undo correctness passes; HUD drag persists only on release and finishes as a floating panel at the expected location. Scene GPU drawing is suppressed in this diagnostic, so actual Apple/120 Hz FPS remains unverified.
- Flight profiling after maxima vary 4.2–10.1 ms; not every strict target is established. Full-render software flight remains GPU-bound; cold backdrop/menu and input-queue outliers, unmeasured maneuver/tracking flows, and the failed shared-GPU attempt are explicitly documented in docs/PERFORMANCE.md.
- Each implementation step is committed. Final lint (including architecture layering), TypeScript check and normal production build pass. Full Vitest: 113 files / 1,332 tests pass before the final `git merge main` and again afterward; merge was already up to date. Production preview stopped at completion.
## Firefox, Zen and Safari compatibility (op/firefox, 2026-10-07)

- **Cause of "doesn't work in Firefox":** after the first click, the menu → Space Center music switch called `AudioParam.cancelAndHoldAtTime`, which Firefox lacks. The audio hook sits above the scene error boundary, so the whole app unmounted to a black page. I reproduced it on real Windows Firefox 143. Your PR #1 fix was merged here, and the branch's equivalent copy was dropped.
- **Hardening, so the next browser gap cannot blank the game:**
  - Audio now fails safe: any Web Audio error silences sound instead of crashing.
  - A root error boundary shows a reload page instead of a black screen.
  - A browser without WebGL 2 gets a friendly fix-it screen and a main-menu warning, instead of a "Flight interrupted" crash.
  - With site data blocked (localStorage throws), the game runs on session memory and says so.
- **Privacy-hardened Firefox (resistFingerprinting):** part-heat shaders failed to link and editor buffers exceeded the reported size limits; both are fixed. Canvas read-back is randomised there, so the texture cache no longer stores it.
- **Verified:**
  - Real Windows Firefox 143 on the RTX 3060 Ti, production build: full flow with no console errors (menu → editor → launch → staging → orbit → map → quicksave/quickload → Tracking Station → Continue). Medium quality at 1600×915 runs ~59 fps with ~6 ms CPU/frame.
  - Playwright Firefox 155, WebKit 26.6 (Safari proxy) and Chromium pass `node scripts/browser-smoke.mjs`; Firefox also passes with resistFingerprinting at Medium.
  - Screenshots: `docs/screenshots/firefox/`. How to run it: `docs/BROWSERS.md`.
- **Not verified:** real Safari on a Mac, and Firefox on macOS (it uses Apple's OpenGL driver rather than ANGLE). WebKit on Linux is only a proxy.
- **Post-merge verification:** merged main (graphics settings/Ultra preset). Shadow maps are now also capped to the context limit; the Ultra preset's 4096-px planet bake remains a caveat on 2048-limited contexts. `npm run lint`, `npx tsc --noEmit` and `npm run build` pass, and the full vitest run passes (**111 files / 1,333 tests**). Re-tested the production build after the merge: the full real Windows Firefox 143 flow, and Playwright Firefox, WebKit and Firefox with resistFingerprinting at Medium, all with no errors.

## Owner play-test fixes (2026-10-07)
Fixes from the owner's first short career play-through on a MacBook (Medium):
- **Steering/SAS dead until toggling gimbal lock:** assists could hand back control while still in rails time warp (which ignores input). Every assist ending now returns to 1× with SAS holding; steering or throttling a live engine drops warp; HUD switches no longer swallow flight keys.
- **Burn-stop lag:** running liquid engines throttled down with their start-up spool time (thrust lingered ~4.6 s); they now respond in ~0.1 s. Pilot throttle cancels an assist. The map's current orbit is recomputed every frame during burns (later patched-conic branches hidden while burning, back within a frame of the cut).
- **Transfer planning / Execute node:** departure-window search from the actual orbit (plane changes, return from inclined lunar orbits, interplanetary from the real parking plane), with selectable options; matrix 104/135 → 135/135. The node assist stages, leads the burn by half its duration and lands within ±0.5 m/s of the plan.
- **First load of a new career:** the Space Center stays hidden until Earth's surface is ready and fades in once (no black → white ground → pop-in sequence).
- **Looks on Medium:** smooth beach colour (no stair-step coast blocks), crisp imagery coastlines, 8k Earth imagery on Medium, no per-vertex speckle on the Moon/Mars, no z-fighting in the flame trench. Medium GPU cost measured at parity with main.


## GPU pass 2 (2026-10-07–08, cx/perfgpu2)

- Production main versus candidate, RTX 3060 Ti / 1470×920 CSS / DPR 2, three interleaved pairs for five scenes and all four presets. Medium fenced medians: pad **2.795→2.512 ms**, ascent **2.331→2.153**, orbit **2.381→2.037**, map **0.333→0.329**, Moon **1.392→1.257**. The strict 2.5 ms pad budget remains narrowly unmet; useful headroom still needs another pass.
- Low remains near parity around 0.5 ms for flight. High/Ultra improve in every measured GPU-heavy scene; full tables and individual samples are in `docs/PERFORMANCE.md` and `docs/performance/perfgpu2/`. All 120 final runs are paused/error-free. Low/Medium/High terrain is idle; Ultra pad/orbit/map retain four in-flight terrain builds on both sides and are documented as streaming measurements. Ultra ascent has ~0.28% triangle variation.
- Adaptive daylight aerial integration, conservative hidden Earth sky rejection, reusable terrain/ocean multi-draw batches and zero-coverage Medium cloud detail skipping. Pad calls **708→238** at identical triangle count. Low and unsupported browsers keep ordinary meshes. Preset resolution, imagery, LOD and shadows are preserved. Wider shader-math changes were rejected after regression; equivalent fetch/phase expressions measured near parity and are not credited as GPU wins.
- Reviewed before/after Retina-size and device-pixel crops for all five Medium scenes, plus Low/High/Ultra pad. No visible detail loss found; small simulation/camera/animation differences remain in screenshots. Evidence: `docs/screenshots/perfgpu2/`. The pad’s smoothed live-loop GPU timer did not improve despite the fenced improvement, so no live-frame pacing or Mac frame-rate claim is made.
- Final lint/layering, TypeScript, **128 test files / 1,390 passed / one skipped**, and production build pass. Tests cover geometric sky bounds, floating-origin batch matrices, normalized attributes and slot growth/reuse. Final built output exactly matches the frozen benchmark candidate.
- Implementation and evidence are committed on `cx/perfgpu2`; no merge or push. Remaining: pad PBR/vegetation/post-processing headroom, real Apple/Safari/multi-draw and 120 Hz validation, Ultra cache/streaming behavior, and timing coverage beyond the five measured scenes.

## 2026-10-08 — WP3: Truthful HUD, quiet guidance (`cx/wp3`)

Implemented automatic Surface/Orbit/nearby-vessel Target reference with manual overrides; thrust/fuel/attitude-aware terrain cautions; quiet staging/throttle messages; pre-ignited-engine Δv; body-aware side hints at 50–100 m/s; non-modal six-key first flight; hidden IVA; optional engineering strip and a navball layout that clears the plume. No renderer, simulation, editor/parts or map/planning edits. Controller integration is isolated in `flight/speedMode.ts`; FlightScene edits only wire onboarding.

Validation: lint/typecheck/build passed; 60 focused tests passed. Full Vitest: 1,423 passed, one skipped, one existing Saturn full-burn timeout under shared load; that file passed on rerun (41 tests across Saturn/WP3/input). Assisted lunar descent lands below 3 m/s without terrain cautions; ballistic fall warns. Real Windows Chrome/RTX captures cover pad, ascent, 150 km orbit, lunar orbit and powered approach at DPR 1/2; browser assertions verify first-flight input, two-message liftoff, a 50.1 m/s turn hint and manual/Target mode behavior.

Completed paired HUD React means: DPR 1 **0.087 → 0.087 ms/frame**; DPR 2 pad/orbit **0.104 → 0.113** (optional strip: 0.084 / 0.117). Raw scene/fps variation, the higher powered-approach capture and the incomplete DPR 2 lunar benchmark tail are retained and explained in [WP3 evidence](docs/screenshots/wp3/README.md). Largest observed completed-case GPU increase +0.39 ms. Parent/owner still needs independent video review and M-series/120 Hz verification; no Apple performance claim. Implementation commit: `ade910df`.
## WP2: an editor that doesn't fight you (2026-10-08, op/wp2)

From the veteran gap audit (item 2 and 11). What changed in the Vehicle Assembly:
- **Staging that understands boosters.** Core + radial boosters now light together in the first stage; the side latches fire next; serial stacks stage exactly as before (engines → decoupler → next engines). Once you rearrange stages yourself, adding parts no longer wipes your order: new engines/decouplers slot in next to what they'd fire with (a "manual" badge shows; the wand resets to automatic). Whole stages can be dragged by their header.
- **Symmetric sets stay sets.** Clicking one of four boosters picks up all four (symmetry ×4 shown, X still changes it) and places them back as a set; your own symmetry setting returns afterwards. Hovering highlights the whole set. **Alt/Option-click copies** a part with everything attached. Ctrl/⌘+Z after placing undoes the whole pick-up-and-place.
- **Subassemblies:** a new drawer (last tab in the parts list). Drop a held assembly on it, or select a part and press Save; click an entry to pick it up again in any craft. **Merge** another vehicle from the load dialog. Stock vehicles there now show thumbnails.
- **Tools (keys 1–4):** place, **offset** (arrows, or drag the part itself), **rotate** (rings, pivoting on the attachment point), **re-root**. Symmetric counterparts follow (mirrored on planes); hold Alt/Option to move just one part. Snap 5 cm / 15° (C toggles, Shift for 1 cm / 5°). In offset/rotate, W/S/A/D/Q/E nudge or turn. One undo step per drag; during a drag only meshes move, the craft is committed on release.
- **Camera, trackpad and Mac:** horizontal pan (Shift+drag, middle drag, sideways two-finger swipe), smooth trackpad zoom and pinch-zoom, F reframes. On a Mac, Ctrl+click opens part details and the hints show ⌥/⌫.
- **Readouts:** "Readouts at" picker (any planet or moon with a surface): stage TWR at ignition → burnout and mass before → after each stage. Selene's lander stage reads TWR > 1 at the Moon (it read 0.67 against Earth). Launch checks still use Earth.
- **Quieter:** Delete on a hovered part shows an Undo toast; the pre-flight review stays hidden until there is an engine and its text wraps.
- **New parts:** five multi-way couplers (Wishbone twin, Trefoil tri, Crossbill quad; 1.25 m and 2.5 m) for engine clusters. **Fairings are now real:** their shell fits the payload automatically (or set height/radius in the part panel) and the simulation shields what's inside from drag and heating (payload drag inside ≤ 5 % of exposed). Jettisoning a fairing no longer throws the payload away with it.
- **Verified:** new Vitest suites (`editor-wp2*`): booster staging, manual order surviving a nose cone and new engines, set pick-up/re-place, Alt-copy, subassemblies, offsets/rotations incl. mirror pairs, re-root, fairing fit/shielding/heating/jettison, couplers feeding every engine, Selene Moon TWR, session undo/redo. Production build driven on the real GPU (Windows Chrome over CDP) and headless Chromium: scripted build (payload, fairing, two stages, four boosters), copy, set pick-up, both gizmos, Moon readouts, stage drag, subassembly save, delete-undo, pinch/pan, couplers. Screenshots archived outside git at `~/.t3/projects/wsp-traces/wp2/`.
- **Performance (RTX 3060 Ti, Windows Chrome, production builds, main vs this branch interleaved, 12 warm entries each, two sessions):** editor entry median 638 → 661 ms and 724 → 705 ms (parity, noise from a shared machine); orbiting the Selene stack 4.5 vs 4.4 ms editor CPU per frame, 330 draw calls in both. The gizmo is built on first use; drags move meshes only and commit once. Scripts: `scripts/wp2/`.
- **Left / caveats:** ~~no visual-only clamshell split~~ (done, see below); no fairing "draw your own" profile; no 1.875 m size or procedural tanks; no per-stage body picker; Firefox and real Mac trackpads not driven (pinch/pan verified with synthetic Ctrl+wheel/deltaX events).
- **Clamshell fairing jettison (op/fairingsplit):** jettisoning now splits the shell into two halves (three panels on shells ≥ 1.8 m radius, i.e. the 3.75 m / 5 m fairings) that hinge outward from the base, tumble away under gravity and air drag and vanish after 6 s. The base ring stays on the stage with the payload still seated on it (no gap), the shell's mass leaves, and shielding ends at once. Verified on the real GPU (production build): no errors, sim keeps one vessel, ring mass 36 kg / 108 kg, ~6 extra draw calls per two-panel fairing and ~17 per three-panel one, only while the panels fly.


## 2026-10-08 — WP4: Mission planning (`cx/wp4`)

Implemented body-centred active-orbit framing/filtering, persistent fleet custom/node/SOI alarms with warp stops,
and worker-based drag/heating/chute landing paths with map/flight impact markers. Preserved the existing worker
transfer-window search and staging/burn-leading executor, clarified its next-orbit option, restored limiters on
explicit cancellation, and extended frozen maneuver anchors to numerical maps. Powered assists continue at 1×
when an alarm fires; coast/warp-to drivers respect the stop. Controller integration stays small.

Lint/typecheck/build pass; final Vitest: **142 files / 1,446 passed / one skipped**. Seeded 120 km re-entry
misses actual splashdown by **0.9 m**; the three-phase stock-Selene executor acceptance tests pass. One million
steady alarm sync/check pairs average **0.000047 ms** with 200 alarms. Paired real Chrome DPR 1/2 maps and real
Firefox confirm local framing/filtering, alarm stops and worker markers, with zero page/console errors.
Largest paired map GPU increase: **+0.094 ms**; 12 fewer map calls. Chrome transition long tasks remain recorded;
M-series/120 Hz and independent video review remain unverified. Scope, assumptions and repeatable probes:
[WP4 validation](docs/audits/2026-10-08-wp4-validation.md). Implementation: `f3720503`, `c8f9a133`, `b081ebe4`.

## WP1 weight and payoff (2026-10-08, cx/wp1)

- Added impulse/energy-scaled camera translation and rotation, original pooled pyro/explosion audio, absolute-thrust engine loudness, larger mass/propellant-scaled fireballs, and 32 pooled template fragments. Reduce Motion / camera-shake settings remain authoritative; the pilot no longer hears a self sonic boom.
- Distance-based 90 s ascent smoke shares the existing Medium 512 slots (384 reserved for the column); vacuum plume brightness uses existing shaders. Dormant particle/debris pools skip work and draws; no new full-screen passes.
- Loss follows the debris for 3.5 s, then offers a non-blocking Revert / Recover / Report bar. Reports open on request; mission/landing results dock on the side and leave flight running.
- Implementation commits: `644bec0e`, `ddf91ea5`, `d859f105`, `680c71db`, `8cfa2540`, `eeaf3708`. Verification and remaining acceptance: `docs/performance/wp1-payoff.md`. No push or merge.
- Lint, TypeScript, build and final Vitest pass (137 files / 1,427 passed / one skipped). Medium DPR 2 fenced GPU pad/ascent/orbit remains near parity with main: +0.021 / +0.037 / −0.033 ms. Before/after staging/crash videos, 10 km smoke and successful landing evidence are captured. Strict 50 ms event tasks, ordinary-playback 2.5 ms GPU timing and real Mac/120 Hz acceptance remain open; details and capture provenance are in the verification note.

## WP6 handling with inertia (2026-10-08, cx/wp6)

- Implemented 25°/s gimbal slew, repeatable liquid ignition transients, finite solid tail-off, inertia-aware SAS tuning and bounded coasting-wheel calibration. Digital attitude keys ramp to full command in one second. Extreme dense-air crossflow uses existing joint fatigue and WP1 creak/camera/debris feedback; no separate effects system or artificial heating.
- All WP6 Vitest acceptance cases pass. Meridian's 90° coast turn improves **33.12 → 6.96 s**; stock Meridian has no RCS hardware, so its RCS-enabled test uses its installed wheel. Selene / Meridian Real turn 90° with wheels disabled on actual gimbal torque in **6.28 / 8.36 s**. Kestrel's powered 0.2 s tap improves **5.31 → 1.01°**; Meridian / Selene peak at **0.14 / 0.08°**. Sustained 30° / 65 kPa exposure fails in **1.20 s**; free sideways Mach 2 at 3 km fails in **0.10 s**, after warning.
- Lint, typecheck and build pass. Full Vitest: **148 files / 1,518 passed / one skipped**, including all stock SAS, ascent, autopilot and scripted orbital/lunar/Saturn/runway/return missions. Used two workers for shared-host render-test timeouts; isolated render reruns also pass without timeout changes. The final solid telemetry cleanup passed the focused engine/WP6 run.
- Paired `cpu-steady.sh` at 4× CPU throttle shows mean `__perf.sim` cost **0.755 → 0.723 ms/frame pad**, **2.317 → 2.226 ascent**, **1.445 → 1.438 orbit**, with matching draw counts and zero page/console errors. Treat this as roughly flat, not a proven speedup. Controlled Node ticks also stay flat. Six alternating Chrome fixed-tick pairs show powered ascent **−0.3%** and coast **+4.1%** paired medians (aggregate coast **0.3807 → 0.4174 ms/tick**); raw variability remains in the evidence. No exact zero-regression or cross-machine frame-budget claim. Additional steady-step work uses scalar math and topology caches; no new per-step allocations.
- Before/after real Chrome gravity-turn videos show gradual lean and settling; original frames, telemetry, scripts and raw timings are archived outside Git at `~/.t3/projects/wsp-traces/wp6/`. Independent human feel and structural-warning listening review remain. Scope, tuning caveats and measurement provenance: [WP6 evidence](docs/performance/wp6-handling.md). Implementation: `a7fef318`; no push or merge.

## Transfer-window list and staged burn readouts (2026-10-08, cx/windows)

- In the map planner, choose **Transfer windows to…**, compare departure UTC, wait, departure/capture Δv and
  flight time, then select a row to verify its encounter and create the maneuver node. **Go now (with plane
  change)** stays available within the next parking orbit. The same ranked list appears above the planetary
  porkchop grid. Listing leaves existing nodes intact; cancellation and stale-plan checks use the existing worker
  path. Values are estimates and capture is a readout, not an automatically added second node.
- Flight Data, the map node summary and navball share pure stage-aware burn timing with Execute node, including
  separator activations and the existing 1 s ignition/separation allowance. “Start burn in” now matches time to
  deliver half the Δv, which can differ from half the elapsed duration across a staging transition. The landing
  stage chooser and guided aim-point cutoff retain their behavior.
- Evidence: Node real-scale Earth→Mars launch minima 766.9 days apart; inclined Earth→Moon next-orbit and
  circular-capture estimates; independent rocket-equation staging/partial-stage tests; worker protocol tests prove
  listing does not mutate nodes. A 200,000-iteration warmed Node benchmark measured 0.29 µs for full + half-Δv
  timing together; the helper makes no array copies or sorts. Full suite: 157 files, 1,569 passed / 1 skipped;
  lint, TypeScript and production build pass. Final changed-area assist/planning regressions are recorded below.
- Final changed-area verification: all 10 assist/planning/window/burn test files pass (52 tests), including the
  recent landing-stage and guided-burn regressions. Chrome screenshot/list interaction remains unverified:
  the T3 automation host disconnected, then GPU-lock acquisition timed out behind other agents' browser QA
  after bounded 30 s and 180 s waits. The optional capture driver is `C:/wsp-tools/drv/windows-list.mjs`; no
  browser profile was created. No new render passes or GPU work were added; Apple M-series timing is unmeasured.
- Two additional delayed-selection integration cases pass for Moon and Mars: list a next-orbit row, advance the
  clock by 5 s, verify its encounter in the worker, then install exactly one live node bounded to the next orbit
  through `applyPlanningResult`. The complete planning protocol file passes all 16 tests.
