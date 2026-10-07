> Read-only veteran gap audit (2026-10-07, Opus subagent). Evidence screenshots referenced as `gpu/…`/`shots/…` live outside the repo in `/home/nedcut/.t3/projects/wsp-audit/`.

# Why "Web Space Program" feels like a worse KSP, and how to fix it

## How I tested
- **Docs and code.** I read PROGRESS, DECISIONS and ARCHITECTURE. I audited the code for editor, flight and physics, map and planning, career, HUD and audio.
- **Editor.** I built a craft by hand in the editor (headless SwiftShader).
- **Real GPU.** I played on the RTX 3060 Ti (Windows Chrome over CDP, 1600×900, port 5330) through five runs:
  - Pad, ascent, staging and a crash (Meridian).
  - LEO to "Plan transfer → Moon", then the Execute-node assist (Selene, `scenario=orbit`).
  - Low lunar orbit, a land-assist descent and the map (Selene, `scenario=moon`).
  - A full powered landing (`?mission=suicide-burn`).
- **Screenshots.** Real-GPU shots are in `/tmp/gapaudit/gpu/`. Headless shots are in `/tmp/gapaudit/shots/`. Repo shots are under `docs/screenshots/…`.

**Caveats:**
- Other agents were benchmarking on the same machine and GPU. Ignore fps numbers, and treat screenshot timing as approximate (±1 s).
- I did not get through EVA, docking or a crewed return in this session.

## The diagnosis in one paragraph
The game ships KSP's whole feature list and a strong, well-tested simulation underneath. Real solar system, Lambert planner, 1,300 tests, render interpolation, no kraken. But almost everything the player actually touches is a careful first pass at the KSP equivalent:
- It is correct, but it has no weight.
- The project was tuned for what agents can measure: tests, ms budgets, triangle counts. PROGRESS.md is 150 KB of agent reports.
- "Feel" was tuned to be timid. Staging shake is about 0.12°, the staging sound starts with a UI click, and the crash report lands before the explosion has finished.

On top of that are a handful of bugs a KSP veteran notices within ten minutes:
- The navball never switches to Orbit mode.
- Autostaging gets booster rockets wrong and erases manual staging.
- A TERRAIN alarm fires during a normal braking burn.
- The node-execution assist forgets to stage.
- The map is framed on the craft, so the planet sits under the navball.

That combination of timid feedback, fiddly editor and small wrong details is exactly what reads as "shitty Kerbal". Nothing here needs new breadth. It needs depth and polish on build → launch → orbit → Moon.

---

## 1. Top 15 reasons it feels like "worse KSP" (ranked by impact on the first hour and on a Moon mission)

### 1. Big moments have no weight: staging, explosions and crashes
- **Staging sound starts with a menu click.** It is `uiClick()` plus a 0.2 s filtered noise burst (`src/audio/index.ts:352-354`). Separation sounds like UI, not pyrotechnics.
- **Camera shake is barely there.**
  - It is rotation-only, amplitude `0.006 × shake` rad (`src/flight/camera.ts:318`). Launch rumble peaks at 0.8, so about 0.27°, and it fades by about 700 m above ground.
  - The staging kick is about 0.12°, decaying over 0.22 s (`controller.ts:316`).
  - The decouple flash moves the camera about 2 cm (`FlightFx.ts:218`).
- **Explosions are a single puff.** They are 40 billboards at a fixed size whatever the part's mass or fuel (`FX_BUDGET`, `src/render/fx/FlightFx.ts:13`), and destroyed parts simply vanish with no debris (`integrator.ts:289`). In `docs/screenshots/vfx/after-explosion.png` an orange puff sits over a rocket that is still intact.
- **Crashes have no payoff.** `onActiveLost` immediately opens a full-screen blurred stats modal (`src/flight/FlightScene.tsx:137-139`).
  - Measured: impact at 689 m/s, and the next frame about 1.8 s later is already the "LOST · 87 SECONDS" chart dashboard (`gpu/s04-stage.png` → `gpu/s05-stage.png`). You never see your rocket die.
  - Landings are the same: the mission result card sits in the centre of the screen, covering the lander at touchdown (`gpu/b-landed.png`).
- **KSP comparison:** KSP's explosions are cheesy, but they linger, scatter parts and let you watch. Here every dramatic moment is undersold or hidden.

### 2. The editor fights a veteran on every build
- **Autostaging is wrong for booster designs.** Core plus radial boosters stages as SRBs → decouplers → core, so the core engine doesn't light at launch (`src/editor/core/staging.ts:474-475`).
- **Autostaging also erases manual staging.** Every attach re-runs `autoStage`, and this is intended (`editor.ts:50`, with calls at `:115,166,301,318`). Fix the order by hand, add a nose cone, and it's gone. Stages can't be dragged as a whole.
- **Picking up one booster breaks the symmetric set.** `detachSubtree` takes only that part's subtree and clears its symmetry group (`editor.ts:256-275`), and a held assembly is never re-placed with symmetry (`session.ts:445-453`).
- **No Alt-click copy, no subassemblies, no merge.** Nothing matches those names in `src`, and Alt only disables surface attach (`EditorView.ts:436`).
- **No offset or rotate gizmos and no re-root tool.** Parts can only be rotated while held (WASDQE). `reRoot` and `moveHeld` exist in the core but nothing in the UI calls them (`editor.ts:278,341`).
- **Δv and TWR are always computed against Earth** (`src/editor/session.ts:162`). The flagship Selene's lunar descent stage shows "TWR 0.67 ASL / 0.93 vac" (`docs/screenshots/hangar/after-selene-wide.png`). That answers nothing about whether it can land on the Moon.
- **Smaller irritations:**
  - Del instantly deletes whatever part is under the cursor.
  - The camera has no horizontal pan.
  - The preflight panel nags about a 2-part work in progress, with its message cut off mid-sentence (`shots/10-after-tank.png`).
  - Stock crafts in the load dialog have no thumbnails.

### 3. The navball and speed readout never switch to Orbit mode
- `speedMode` defaults to `'surface'` and only changes when you click the readout (`src/flight/controller.ts:128`, `:374`).
- In a 150 km orbit the HUD reads "SURFACE 2090.6 m/s" (`gpu/m00-orbit.png`); `docs/screenshots/realearth/highorbit.png` shows the same thing at 1,593 km.
- SAS Prograde and Retrograde, and the navball markers, therefore stay surface-relative in orbit (`controller.ts:804`). The error is small at 1/10 scale, but several degrees at Real scale.
- **KSP comparison:** KSP switches at the top of the atmosphere. A veteran's muscle memory ("circularise on prograde") is quietly wrong here.

### 4. Sound is thin and engine loudness ignores engine size
- **No recorded audio at all.** Everything is synthesized from oscillators and noise; there are no audio files in `public/`.
- **Loudness is relative, not absolute.** It is each engine type's share of the vessel's *installed* vacuum thrust, including stages that haven't fired, with loudness ∝ √share (`src/flight/controller/audio.ts:53-66`, `audio/index.ts:51`). A 9 kN lander engine firing alone is as loud as a 3.3 MN booster.
- **You can hear your own sonic boom** (`audio/index.ts:330`).
- The layering itself (roar, rumble, crackle, wind by dynamic pressure, creaks) is reasonable. But without samples and absolute scaling, launch doesn't rattle the desk.

### 5. Little sense of speed or atmosphere on ascent
- **Exhaust smoke is a dotted line.** It emits at most 40 puffs/s per engine, at most 3 per frame, from a pool of 512. Liquid-engine smoke stops above 6 km (`FlightFx.ts:105-145`). There is no smoke column back to the pad (`gpu/a04-10s.png`, `gpu/a06-maxq.png`).
- **No cues for speed.** FOV is fixed at 60°. Earth has one 2D cloud shell at 6 km or below. The Mach effect is one cone at opacity 0.16, peaking at Mach 1.02.
- **Vacuum plumes are hard to see.** During a 73% lunar braking burn the plume is a small orange smudge (`gpu/b-1500.png`).
- Result: from 0 to 45 km the picture is basically static while the numbers change.

### 6. Visual flatness exactly where you look most
- **The pad.** The rocket hovers over a pure-black square void with no clamps, deflector or trench geometry. Buildings are untextured boxes (`docs/screenshots/cues/flight-cues.png`, `vfx/after-liftoff.png`).
- **Earth coastlines.** The land/sea mask has stair-stepped, pixel-block coastlines at 4.6 km (`gpu/a06-maxq.png`) and in the very first orbit view over the Caribbean (`gpu/m00-orbit.png`).
- **Moon descent.** The surface looks almost identical at 3.8 km, 1.5 km and 196 m: a soft grey blur with sparse low-poly "gem" rocks and no contact shadows (`gpu/b01-after-brief.png`, `b-1500.png`, `b-200.png`; `docs/screenshots/partsart3/after-moon.png`).
  - There are no cues to judge altitude by, and no lander shadow walking in.
  - Dust only appears within 35 m of the nozzle.
  - At touchdown the near ground is mush (`gpu/b-landed.png`).
- **Backlit vessels go nearly black.** There is no fill or rim light (`gpu/a10-end.png`, `gpu/m06-flight-after.png`, `gpu/b-*`).
- The large amount of work on part textures (passes 2 and 3) is mostly invisible at normal flight-camera distance.

### 7. Handling: twitchy under thrust, sluggish coasting, and forgiving aerodynamics
- **Gimbal snaps instantly**, with no slew rate (`src/sim/vessel/engines.ts:158`). Kestrel turns 90° in 1.56 s under thrust.
- **Big craft crawl when coasting.** Turning 90° on reaction wheels takes 21 s for the Meridian and 96 s or more for a 230 t stack.
- **Aerodynamics forgive far too much.**
  - Measured: a 0.4 s tap of D at 38 m/s plus SAS Prograde laid the Meridian flat into a dive at 3 km altitude and Mach 2, at 265 kPa dynamic pressure.
  - Over about 40 s it neither broke up nor overheated, then hit the sea showing 791 g (run log; `gpu/s00-flameout.png`, `gpu/s05-stage.png`). In KSP that rocket would have flipped or burned.
  - Structural joints use a generous rating (1.25 m stack 1.5 MN) on a single rigid body (`structure.ts:79-127`).
- Net effect: inputs feel toy-like, and bad flying isn't punished in a readable way.

### 8. Hints, cautions and help are noisy and blind to context
- **First flight opens a 36-row keybinding wall** that blocks input (`shots/23-climb.png`; Controls overlay).
- **Hints are large toasts in the centre of the screen, over the rocket** (`gpu/a06-maxq.png`, `gpu/a10-end.png`).
- **Hints ignore where you are.** "You are in orbit! … the Moon is a short hop away" appears while you are *in lunar orbit* (`src/flight/hints.ts:45,58`; `gpu/l00-llo.png`).
- **The TERRAIN caution ignores thrust.** "TERRAIN · 4.9 s" flashes red during a nominal burn: 19.7 m/s descent, 75% throttle (`gpu/b-200.png`). Earlier a "SINK RATE" caution showed at 1.4 km.
- **Liftoff messages contradict each other.** "Engines not staged — activate the engine stage first", "Stage 4 activated" and "Liftoff!" stack up together (`gpu/a02-liftoff.png`).
- **Total Δv reads 0.0 m/s** on a fuelled lander whose engines are pre-ignited (`gpu/b-*`, Suicide Burn).

### 9. The map view is framed and filtered wrongly
- **The map centres on the craft, not the body.** In LEO, during ascent and in lunar orbit, the planet sits in the lower half of the screen under the navball cluster and hint card (`gpu/a08-map.png`, `m01-map.png`, `l01-moonmap.png`).
- **Asteroid clutter.** Small-body orbits and a big "Bennu" label dominate even an Earth-LEO or lunar map.
- **Your own orbit vanishes during the transfer burn**, because the map stays framed on the Moon's orbit (`gpu/m05-after-tli.png`).
- **Node list typo.** A passed node reads "T−T-49.3s" (`src/flight/hud/ManeuverPanel.tsx:139` puts "T−" in front of an already signed duration).
- The node gizmo and markers are good (see section 2). The framing makes them feel worse than they are.

### 10. The Moon trip flow: long waits and an assist that executes badly
- **Long wait for the burn.** "Plan transfer → Moon" from a 28.5° LEO put the burn 3 d 6 h away (`gpu/m03-planned.png`). This is by design (the Moon's plane), but no cheaper "go now with a plane change" option or list of windows is offered.
- **The Execute-node assist doesn't stage.** It throttled to 100% with no active engine, showing "Engines not staged — activate the engine stage first" for about 25 s.
- **It doesn't lead the burn either.** It starts at the node instead of half the burn time early. At node time +49 s it still had 646 of 899 m/s left (`gpu/m05-after-tli.png`, run log), so the encounter drifts off-plan.
- **KSP comparison:** this is exactly the MechJeb-style convenience KSP players expect to be bulletproof.

### 11. Missing building blocks in the parts list
- 168 parts, but **only one multi-node coupler** (5 m → 3 × 2.5 m). There are no 2-, 3- or 4-way couplers or engine plates, so you can't cluster engines below 5 m.
- No 1.875 m size, and no procedural tanks.
- **Fairings are fixed-size cosmetic shells.** The simulation never reads them, so payloads take full drag and heat, and oversized payloads poke through (`src/data/parts/aero.ts:28,48`; `src/sim/vessel/aero.ts:66-88`).
- Veterans build with clustered engines and fairings in their first hour.

### 12. Camera without drama, and the HUD covers the rocket
- **Five modes, none cinematic.** Auto, free, orbital, chase and locked exist, but no pad or tower camera, no cinematic camera, and no camera that eases out at liftoff.
- **The navball cluster and speed box cover the engine and plume.** The rocket sits at screen centre, so the plume ends up behind the navball (`gpu/a04-10s.png`, `gpu/a06-maxq.png`).
- **The map view opens on a random-looking zoom** (`gpu/a08-map.png`).

### 13. Unfinished features are on display
- **IVA is unfinished.** The controls list "Interior view (not available yet)" and the IVA button is greyed on every crew portrait.
- **Scale-blind assist and scenarios.** The `scenario=moon` shortcut parks the whole 7-km/s launcher in lunar orbit, and Land assist tries to land all of it. A dev path, but it shows the assist ignores the craft.
- **Black screen during descent (unconfirmed).** In that same run the screen went black at 2,955 m above the Moon: no vessel, no surface, only stars (`gpu/l02-descent3km.png`). The next run was killed, so this is unconfirmed but worth a repro.

### 14. Career is a stub that copies KSP's weakest loop
- **The tech tree is auto-generated.** It has 25 nodes: 6 straight-line branches of 4 tiers plus a root. Parts are binned by cost quartile, with hand patches on top (`src/data/technology.ts:43-66`). There are no real choices.
- **Contracts are thin.** There are four kinds (orbit, flyby, surface expedition and return, field survey), three offered per batch, each with a 20-year deadline (`src/sim/science/progression.ts:26-49,62`).
- **Science is small.** Eight experiments × situations × biomes, with halving returns (`experiments.ts`).
- No facility upgrades, crew experience or strategies. There is nothing to want after the first Moon landing.

### 15. Ascent guidance and the first flight teach poorly
- The gravity-turn hint fires anywhere between 50 and 300 m/s and can linger. In one run it appeared at 4.7 km and 252 m/s (`gpu/a06-maxq.png`), by which time the turn is long overdue.
- Combined with how easily a small tap flattens the rocket (item 7), a new player's first ascent tends to end in the sea.
- The Training lessons are better (see section 2), but the default Sandbox first flight dumps you on the pad behind the keybinding wall.

**Root cause, as a process note.** Every work package so far was accepted on numbers: tests pass, GPU delta under 0.5 ms, zero shader re-resolutions. None was accepted on "does this moment feel good on video". The plan below adds before/after *video* (CDP screencast) acceptance to every package.

---

## 2. Where it can clearly beat KSP

| KSP pain / mod | What the game already has | Missing or half-done |
|---|---|---|
| **Noodle rockets, kraken, KJR** | One rigid body with a load model, breakup and an F4 stress overlay. No wobble, no kraken. A real win. | Make loads *readable*: creak or flex VFX near the limit, and breakup at extreme dynamic pressure × angle of attack (item 7). |
| **No Δv readouts (KER, stock 1.12)** | Per-stage Δv, sea-level/vacuum TWR and burn time in the editor. In flight: TWR, stage and total Δv, suicide-burn countdown, terminal velocity, angle of attack, phase angle (`src/game/flightData.ts:69-92`). | Body and atmosphere picker in the editor (item 2). Readouts live in a toolbar app, not on the HUD. Δv shows 0.0 when engines are pre-ignited. |
| **Fiddly maneuver nodes** | Ghost node on hover, drag handles, Alt+wheel 0.1 m/s steps, exact Δv fields, ±1 orbit, several nodes, encounter/closest-approach/AN-DN markers, burn countdown on the navball. Genuinely good. | Map framing and clutter (item 9). The assist doesn't stage or lead the burn (item 10). Burn time doesn't account for staging mid-burn. |
| **Transfer Window Planner** | Lambert solver and porkchop grid (`porkchopGrid`), Moon transfer planner, course corrections, worker-based and non-blocking. | Show a list of windows with wait vs Δv, including a "go now with plane change" option. Polish the porkchop as a first-class UI. |
| **Trajectories (aero impact prediction)** | Impact time and speed **without drag** (`flightData.ts:76-77`; the panel says "unpowered, no drag"). | Drag-integrated re-entry and landing prediction drawn on the map and surface. The deterministic sim plus the existing planner worker make this cheap. **Big win.** |
| **Kerbal Alarm Clock** | Warp-to next node, Ap, Pe or SOI change, stopping just before (top-left ⇥). | No alarm list, no alarms per vessel, no custom alarms, no auto-alarm on maneuver nodes. **Missing entirely.** |
| **MechJeb** | Launch to orbit, execute node, land, circularize. | Reliability: staging during burns, leading the burn, scaling to the craft's capability. Show the pilot what it is doing, as a teacher rather than a crutch. |
| **Docking Port Alignment Indicator** | Docking HUD, target and closest-approach readouts. | Not verified this session. |
| **Clunky VAB, procedural parts and fairings, subassemblies** | Snapping with glowing node markers, valid/invalid tint, ghosts of symmetry copies, radial symmetry up to ×8 plus mirror, at least 50 undo steps, a preflight review KSP doesn't have, share codes. | Everything in item 2 and item 11. This is where "improved KSP" is most visible. |
| **Loading screens** | Flight ready in about 4–5 s from a cold URL on the 3060 Ti (measured 4,071–5,017 ms). PWA offline. | Keep it that way. |
| **Ugly stock planets, RSS, Scatterer, EVE** | Real solar system with no mods, real Earth elevation (ETOPO), atmospheric scattering, Saturn's rings and hexagon, Titan haze, scale presets. | Coastline blockiness and flat Moon terrain up close (item 6). That's where players spend their time. |
| **Poor tutorials** | 8 interactive Training lessons with state-checked steps (`src/tutorial/lessons.ts`), plus scored Missions such as Suicide Burn with medals. Better than stock. | The default first flight still opens with a keybinding wall. Hints are blind to context (item 8). |
| **Terrible career pacing** | A balance analysis (`docs/BALANCE.md`) and recovery grants. | The tree and contracts are stubs (item 14). Defer until the core loop feels good. |
| **Flight results** | A post-flight report with charts, achievements and a flight log. | Don't let it pre-empt the moment (item 1). |

---

## 3. Plan: six parallel work packages to move from "shitty KSP" to "improved KSP"

**Rules for every package:**
- Acceptance needs before/after **video**: a CDP screencast on the RTX 3060 Ti at 1600×900 and at DPR 2, reviewed by a human or reviewer agent. Screenshots and tests are not enough on their own.
- Medium-preset GPU budget: +0.5 ms per package.
- No KSP names or assets.

**File ownership (to avoid merge conflicts):**

| Package | Owns |
|---|---|
| WP1 | `render/fx`, `audio`, camera shake, `FlightScene` loss flow |
| WP2 | `src/editor`, `data/parts` additions |
| WP3 | `flight/hud`, `hints`, `cues`, `telemetry`, speed mode in `controller.ts` |
| WP4 | `flight/map`, `render/map`, `game/planning`, `autopilot`, alarms |
| WP5 | `render/planet`, `render/site`, lighting |
| WP6 | `sim/vessel` (engines, SAS, aero, structure) |

WP3 and WP4 both touch `controller.ts`. Agree a small interface first, or merge WP3 first.

### WP1: Weight and payoff (staging, explosions, crashes, smoke, sound)
**Scope:**
- **Camera.** Event-scaled camera punch (translation plus rotation), sized by separation impulse, crash energy and touchdown speed. Defaults about 5–10× today's. Keep the Reduce-motion and camera-shake sliders.
- **Pyro sounds.** A separation sound (no UI click), plus decoupler, fairing and SRB-separation variants.
- **Engine loudness from absolute thrust**, with distance falloff. No self-heard sonic boom.
- **Explosions.** Fireball and smoke sized by part mass and propellant. Tumbling mesh debris taken from the destroyed parts' templates, with a short lifetime.
- **Exhaust smoke.** Emit per metre travelled, not per second, with long-lived puffs for a continuous ascent column. More legible vacuum plumes.
- **Loss flow.** On vessel loss, follow the debris for 3–4 s (optional slow motion), then show a non-blocking "Flight ended" bar with Revert / Recover / Report. Mission and landing result cards dock to the side, not the centre.

**Acceptance:**
- (a) Video of a Meridian staging shows a visible separation puff, an audible pyro sound and a camera punch of at least 1°.
- (b) An explosion video shows at least 5 debris pieces and a fireball at least 3× the vessel diameter.
- (c) Vitest: the report never opens sooner than 3 s after `onActiveLost`. The Suicide Burn result card does not overlap the vessel's screen bounds.
- (d) Audio test: a lone 9 kN engine's RMS is at most 0.35× that of a 3.3 MN booster.
- (e) A screenshot at 10 km shows a continuous smoke trail down to the ground.

### WP2: An editor that doesn't fight you (plus fairings and couplers)
**Scope:**
- **Symmetry.** Pick up and place symmetric sets as a set.
- **Copy and reuse.** Alt-click copies a subtree, with symmetry. A subassembly drawer to save and drop subtrees.
- **Staging.** Rewrite autostaging so boosters light with the core and each decoupler sits with its stage. Insert new parts into the existing manual staging instead of re-running autostaging. Drag-and-drop whole stages.
- **Gizmos and tools.** Offset and rotate gizmos for placed parts, symmetry-aware, with angle snap. A re-root tool. Horizontal pan.
- **Readouts.** Δv/TWR body and atmosphere picker, plus per-stage start/end mass and TWR.
- **Safer delete and quieter checks.** Delete-hovered asks for confirmation or shows an undo toast. The preflight review stays collapsed until the craft has an engine.
- **New parts.** 2-, 3- and 4-way couplers. Procedural fairings that wrap the payload, are read by the simulation and shield it from drag and heat.

**Acceptance (Vitest):**
- Core + 4 radial SRBs autostages to an ignition stage containing all five engines.
- A manual reorder survives adding a nose cone.
- Picking up 1 of 4 boosters moves all 4 and re-places them with symmetry.
- Alt-copy duplicates a subtree.
- Selene's lander stage reports a Moon TWR above 1 when "Moon" is selected.
- Payload drag inside a fairing is at most 5% of exposed drag.

**Acceptance (browser):** a scripted build from empty to a 2-stage rocket with 4 boosters and a fairing, with screenshots of each gizmo.

### WP3: Truthful HUD, quiet guidance
**Scope:**
- **Speed mode.** Automatic Surface → Orbit switch at the top of the atmosphere, or about 5× the reference altitude on airless bodies, with a manual override. SAS reference follows the mode.
- **Cautions.** TERRAIN and SINK RATE use time-to-impact that accounts for thrust (warn only if the current maximum deceleration can't stop the craft in time).
- **Messages.** Remove duplicate and contradictory messages: suppress "Engines not staged" in the same frame as staging. Fix Δv reading 0.0 with pre-ignited engines.
- **Hints.** Aware of body and situation. Docked to the side, never over the vessel. Fire the gravity-turn hint at 50–100 m/s.
- **First flight.** Replace the 36-row wall with a 6-key card; the full sheet stays on Shift+F1.
- **Readouts on the HUD.** An optional KER-style strip with stage Δv, TWR, suicide-burn countdown and time to impact.
- **Readout overlap.** Move readouts so the plume isn't hidden in the default chase framing.

**Acceptance:**
- Vitest for the speed-mode transitions on Earth and the Moon, and for the thrust-aware caution: no TERRAIN during a land-assist run that touches down below 3 m/s, while a ballistic fall still warns.
- A screenshot at 150 km shows "ORBIT".
- A "lunar orbit" screenshot shows no Earth-orbit hint.
- A liftoff screenshot shows at most 2 messages.

### WP4: Mission planning that beats the mods (map, alarms, Trajectories, a reliable assist)
**Scope:**
- **Map framing.** Centre on the vessel's body. Frame the active orbit on entry. Keep the active orbit visible during burns. Hide small-body orbits and labels unless they are targeted or the view is heliocentric.
- **Alarm clock.** A panel with alarms created automatically for nodes and SOI changes, custom alarms and alarms per vessel. Warp stops at each alarm. Persisted in saves.
- **Trajectory prediction.** A drag-integrated re-entry and landing line plus impact marker on the map and as a surface marker in flight, computed in the planner worker.
- **Transfer planner.** List the next N windows with wait and Δv, including "now + plane change". Fix the "T−T" typo.
- **Execute-node assist.** Stage automatically when the active stage is empty. Start the burn half the burn time early, accounting for staging. Hand over control cleanly.

**Acceptance:**
- Vitest: a TLI from the `stock-selene` orbit scenario run by the assist ends within ±3 m/s of the plan, with Moon encounter periapsis within 10 km.
- The re-entry prediction from 120 km lands within 5 km of the actual splashdown in a seeded test.
- An alarm stops warp within 1 s of game time.
- Screenshots of the map in LEO, low lunar orbit and mid-TLI: body centred, own orbit visible, no Bennu label.

### WP5: A sense of place where players actually look
**Scope:**
- **Pad.** Real trench and deflector geometry, clamps or umbilicals that fall away at release, a steam cloud along the deflector, textured buildings.
- **Earth coastline.** Fix the blocky land/sea mask: filter or sharpen the mask, and use a distance-field coastline.
- **Moon close-up.** Detail and normal maps plus crater micro-relief below 2 km, rocks grounded with contact shadows, the lander's shadow on the ground, and dust kicked up below about 100 m scaled by thrust and distance.
- **Lighting.** Planetshine and rim fill so backlit vessels keep their form.
- **Ascent atmosphere.** Multi-layer clouds you pass through, a subtle speed cue (FOV or clouds rushing by), and a Mach effect visible across Mach 0.9–1.2.

**Acceptance:**
- Fixed-viewpoint before/after set: pad, 5 km ascent, 150 km over the Caribbean (no visible stair-steps at 1600×900), and Moon descent at 3 km / 500 m / 50 m (lander shadow visible at 500 m and below, dust at 50 m).
- Backlit-vessel average luminance at least 2× today's.
- Within the GPU budget at Medium.

### WP6: Handling with inertia
**Scope:**
- **Engines.** Gimbal slew rate of 20–30°/s. Ignition transient and spool-up for liquid engines. Solid motor tail-off.
- **SAS and torque.** SAS gains scheduled by moment of inertia so big stacks turn 90° in under 10 s when using RCS or gimbal. Coasting reaction-wheel authority is a balance knob.
- **Readable aerodynamic failure.** Breakup and heating at extreme dynamic pressure × angle of attack, so flying sideways at Mach 2 at 3 km fails in under 3 s, with WP1's warning creaks first.
- **Keyboard taps.** Retune the keyboard ramp so a 0.2 s tap is a few degrees, not a flip.

**Acceptance (Vitest):**
- Meridian at angle of attack above 25° and dynamic pressure above 60 kPa breaks up or overheats within 3 s.
- A 0.2 s pitch tap at 40 m/s gives at most 5° of attitude change.
- Gimbal slew is at most 30°/s.
- Meridian coasting turns 90° in at most 10 s with RCS on.
- The existing SAS-on-every-stock-craft tests still pass.

**Acceptance (video):** a gravity turn where the rocket visibly leans and settles.

**Deferred until the core loop feels right:** career redesign (a hand-authored tech tree with real choices, contract types with objectives, facility upgrades), IVA, and new bodies or features.
