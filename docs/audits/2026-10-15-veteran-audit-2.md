> Veteran audit, round two (2026-10-15, audit2 subagent). Report only, no game code changed. Screenshots are
> outside the repo in `C:\wsp-tools\shots\audit2\` (WSL: `/mnt/c/wsp-tools/shots/audit2/`), and run logs are in
> `~/.t3/projects/wsp-traces/audit2/`. All paths below are relative to those folders.

# Veteran audit 2: what still feels worse than the genre classic

## How I tested
- **Build:** today's `main` (b6396abc), a production build served on port 5831.
- **Hardware:** real GPU (RTX 3060 Ti), CDP Chrome at 1600×900, Medium quality, sound muted. Firefox spot check
  via puppeteer.
- **Career first hour:**
  - New career, then accepted all three offers.
  - Built a rocket by mouse in the Integration Hall from the starting parts: Lantern I, Bloom chute, Snap Ring 1,
    Silo 1, Sirocco, plus a surface thermometer.
  - Ran science on the pad, launched, staged, and descended under the chute. Recovered, then read the debrief.
  - Flew five times: without a heat shield (SAS prograde, SAS retrograde, SAS off), and with a shield (SAS off,
    SAS retrograde).
- **Moon round trip (sandbox, stock Selene):** Launch-to-orbit assist, then the maneuver planner (Transfer → Moon),
  both the ★ window and "Go now". Execute-node assist, then warp-to the sphere-of-influence (SOI) change, then
  Circularize at Pe. Then Land here, EVA, flag and board, then Launch to orbit. Then Transfer → Earth, Execute
  node, warp-to Atmosphere, staging, entry, chute, recovery. Quicksave/Continue between steps.
- **Other vehicles:**
  - Swift jet: runway takeoff, climb and bank.
  - Trekker rover: drive and turn.
  - Rendezvous Race challenge (docking).
- **Code check:** every sub-claim of the 2026-10-07 audit, by a read-only subagent (file:line evidence below).
- **Headless repro:** the parachute failure, in a scratch Vitest using `scripts/career/flights.ts` (not committed).

**Caveats:**
- **Shared machine.** Other agents shared the GPU queue, so there are no fps claims for Chrome.
- **Docking.** My scripted docking approach failed (drifted to 250 m). I have not verified docking hands-on.
- **Sound.** I didn't listen. Audio findings come from code only.
- **Moon return.** The planner and assists flew most of it. I flew the first hour and the re-entry by hand (by script).

## The verdict in one paragraph
The 10-07 audit's list is mostly closed, and it shows:
- Staging punches, smoke columns, debris and the 3.5 s loss replay.
- A navball that switches to ORBIT, and quiet, correct cautions on the Moon.
- An editor with symmetric pick-up, Alt-copy, gizmos, a body picker and sane autostaging.
- A planner that offers "Go now", and an execute assist that stages and leads the burn. My trans-lunar injection
  (TLI) was 0.1 m/s off plan, and the whole Moon round trip worked end to end.

What remains is a different class of problem: **traps the game sets for a veteran and doesn't explain.**
- The KSP-standard first rocket (pod, chute, tank, engine) kills its pilot, because the chute never opens without
  a heat shield, and nothing says why.
- The planner's ★ recommendation parks you for 7 days at a warp cap of 100×.
- "Land here" happily lands on the lunar night side, where the screen is black from 3 km down to the flag.

Each of these is cheap to fix. Each one is exactly what an outside playtester will hit in their first session.

---

## 1. The 2026-10-07 items, re-checked

Status key: **Fixed**, **Partly**, **Not fixed**. Code evidence is from today's `main`. Screenshots are from this run.

| # | 10-07 item | Status | Evidence |
|---|---|---|---|
| 1.1 | Staging sound starts with a UI click | Fixed | `src/audio/index.ts:391,400-417` (`pyro('stage')`, decoupler/solid/fairing variants). Not heard (muted). |
| 1.2 | Camera shake ≈0.1° | Fixed | `src/flight/camera.ts:401-408`, `render/fx/eventDesign.ts:5-10`; test "gives a rated separation more than one degree of punch". Visible separation puff: `career-shield-retro/20-decouple-120ms.png`. |
| 1.3 | Explosion is one puff, no debris | Fixed | `render/fx/DebrisPool.ts:22`; test "spawns at least five template fragments". |
| 1.4 | Crash report pre-empts the crash | Fixed | `flight/lossPresentation.ts:2` (3.5 s replay), "Flight ended · Revert / Recover / Report" bar: `career/23-down.png`. No slow motion. |
| 1.5 | Landing result card covers the lander | Fixed | `scenarios/scenarios.css:18` (docked right). |
| 2.1 | Boosters autostage wrong | Fixed | `editor/core/staging.ts:72`; test "lights core and four radial boosters in one ignition stage". My hand build staged correctly: engine 2, decoupler 1, chute 0 (`career/11-built.png`). |
| 2.2 | Edits erase manual staging; no stage drag | Fixed | `editor.ts:165` (`insertIntoStaging`), `StagingPanel.tsx:115-117`. |
| 2.3 | Picking up one booster breaks symmetry | Fixed | `session.ts:491`, `editor.ts:182`; test "picks up one of four boosters as the whole set". |
| 2.4 | No Alt-copy, subassemblies, merge | Fixed | `session.ts:559`, `editor/subassemblies.ts`, `Palette.tsx:153`. Key bar shows "Alt+Click copy" (`career/11-built.png`). |
| 2.5 | No gizmos or re-root | Fixed | `editor/scene/gizmo.ts`, `session.ts:661`; keys 2/3/4. |
| 2.6 | Δv/TWR only against Earth | Fixed | `session.ts:123,204`; body picker visible ("READOUTS AT Earth"). |
| 2.7 | Del deletes instantly; no pan; preflight nags; no thumbnails | Fixed | Undo toast `session.ts:629-637`; Shift+Drag pan; preflight hidden until an engine exists; thumbnails `LoadDialog.tsx:159`. |
| 3 | Navball never switches to Orbit | Fixed | `flight/speedMode.ts:7-38`. Seen live: "SURFACE AUTO" → "ORBIT AUTO" at ~65 km and back on descent (`career-fly2.log`). |
| 4.1 | No recorded audio | Not fixed | `public/` has no audio files; all synthesized (deliberate). |
| 4.2 | Loudness relative, not absolute | Fixed | `audio/design.ts:25-27` (thrust / 3.3 MN); test "limits a lone 9 kN engine amplitude". |
| 4.3 | You hear your own sonic boom | Fixed | Boom removed from `src/audio`. |
| 5.1 | Smoke is a dotted line | Fixed | Continuous column on the Selene ascent: `moon/a05-asc-2.png`. Liquid-only first rocket still shows sparse glowing dots (`career-shield-retro/16-10s.png`). |
| 5.2 | Fixed FOV; one cloud shell; weak Mach effect | Partly | FOV now q-driven. Still one cloud layer (`render/planet/materials.ts:60`). Mach cone still 0.16 opacity at Mach 1.02 (`CondensationFx.ts:40-42`). |
| 5.3 | Vacuum plumes hard to see | Fixed (code) | `render/parts/plume.ts:64`. |
| 6.1 | Pad is a black void | Fixed | Clamps, arms, grating, trench: `career/13-pad.png`. |
| 6.2 | Stair-stepped coastlines | Partly | Imagery mask replaced. Coast looks clean at 3–7 km and in orbit (`moon/a05-asc-2.png`, `career-shield-retro/16-10s.png`). No distance field. |
| 6.3 | Flat Moon descent | Partly, and worse in practice | Crater micro-relief only on High/Ultra (`render/core/quality.ts:110,135,158`). My landing was on the night side: nothing visible at all (`moon/d02-alt-300.png`, `d03-landed.png`). See new item 2. |
| 6.4 | Backlit vessels go black | Fixed | `render/core/skyEnv.ts:106-107`; Selene in lunar orbit readable (`moon/c07-llo-flight.png`). |
| 7.1–7.4 | Gimbal snap, sluggish coast, forgiving aero, tap flips rocket | Fixed | `sim/vessel/engines.ts:36,209` (25°/s); `structure.ts:17-45`; `flight/input.ts:19-20`; tests named in the code check. A 0.35 s D tap at 88 m/s barely moved the rocket. |
| 8.1 | 36-row key wall on first flight | Fixed | Four-row "First flight" card, non-modal: `career/13-pad.png`. |
| 8.2 | Hints centred over the rocket | Fixed | Left column (`Hud.tsx:355`). |
| 8.3 | Hints ignore the body | Fixed | No Earth-orbit hint in lunar orbit (`moonC.log`: hints []). |
| 8.4 | TERRAIN ignores thrust | Fixed | Zero cautions on the whole Land-here descent (`moonD.log`: cautions []). New false caution under parachutes: new item 6. |
| 8.5 | Contradictory liftoff messages | Fixed | Liftoff shows "Liftoff!" and one achievement (`career/15-liftoff-2s.png`). |
| 8.6 | Total Δv 0.0 with pre-ignited engines | Fixed | Test "shows nonzero Δv for pre-ignited engines". |
| 9.1–9.3 | Map centred on craft; asteroid clutter; own orbit vanishes during TLI | Fixed | Earth centred, no Bennu label (`moon/a07-map.png`). Transfer *destination list* still lists Bennu, Ryugu, Itokawa, Eros, 67P and Halley from low Earth orbit (LEO) (`moonB.log`). |
| 9.4 | "T−T" typo | Fixed | `hud/plannerFormat.ts:26-28`. |
| 10.1 | No window list or "go now" | Fixed, but the ★ default is wrong | Four departures listed (`moon/b02-departures.png`). ★ picks a 7d16h wait to save 36 m/s: new item 3. |
| 10.2 | Execute assist doesn't stage | Fixed | `game/autopilot.ts:714`; staged through Selene's stack. |
| 10.3 | Execute assist doesn't lead the burn | Fixed | TLI "Done · 0.1 m/s off the plan" (`moon/go-b06-after-tli-map.png`). |
| 11.1 | One multi-way coupler, no engine plates | Partly | 6 couplers (`data/parts/couplers.ts:27-31`); still no engine plates. |
| 11.2 | No 1.875 m size, no procedural tanks | Not fixed | `data/parts/builders.ts:24` (0.625/1.25/2.5/3.75/5 m). |
| 11.3 | Fairings cosmetic | Fixed | `sim/vessel/fairing.ts`; tests "shield it from drag (≤ 5%)", "protects the payload from ascent heating". |
| 12.1 | No pad or cinematic camera | Partly | `tower` mode and liftoff dolly (`camera.ts:24-26,235`); no free cinematic camera. |
| 12.2 | HUD covers the plume | Fixed | Lens shift; plume clear in `career/15-liftoff-2s.png`. |
| 12.3 | Map opens on a random zoom | Fixed | `FlightMap.ts:144`; map-zoom tests. |
| 13.1 | IVA greyed out on show | Partly | Hidden, not built. |
| 13.2 | Scale-blind land assist / scenario | Partly | Land assist picks the landing stage (`autopilot.ts:983-1076`): it dropped Selene's transfer stage and landed at 1.5 m/s. The `?scenario=` dev path is unchanged. |
| 13.3 | Black screen at 2,955 m on Moon descent | Explained, not fixed | Reproduced as lunar night: the descent below ~3 km is black except the lit lander (`moon/d02-alt-300.png`). Most likely the same thing. New item 2. |
| 14.1–14.3 | Generated tech tree; 4 contract kinds; small science | Not fixed | `data/technology.ts:15-22,47-53`; `sim/science/progression.ts:5,59,74`. |
| 14.4 | No facility upgrades, crew XP, strategies | Partly | Facility upgrades exist (`sim/science/facilities.ts:11`, hub panel `first/04-hub.png`); no crew XP, no strategies. |
| 15 | Gravity-turn hint late; Sandbox opens on a key wall | Fixed | `hints.ts:75-89`; first-flight card. |

**Section 2 table ("missing or half-done"):**
- **Fixed:** Δv readouts (strip opt-in), maneuver nodes, transfer planner, Trajectories-style landing prediction
  (`LandingPredictionDriver.ts`; test "predicts a seeded 120 km reentry splashdown within 5 km"), alarm clock
  (`AlarmPanel.tsx`), MechJeb-style assists, flight results.
- **Partly:** visible structural flex (creak and shudder only), planets up close (6.2, 6.3), career (facilities
  only).
- **Stale text:** `FlightDataPanel.tsx:27` still says "Impact: unpowered, no drag" next to the new drag-aware
  predictor.
- **Player-visible stale part text:** `data/parts/expansion.ts:62`, the ladder says "astronauts do not yet climb it".

**Score:** about 75 of 90 sub-claims are fixed, about 10 partly fixed, and about 8 not fixed. Nearly all of the
not-fixed ones are career content and part breadth.

---

## 2. New top 15: why it still feels worse than the genre classic

Ranked by impact on a veteran's first hour, then the first Moon trip. Fix size: S = under a day, M = a few days,
L = a week or more. ⚠ = would embarrass us in front of outside playtesters.

### 1. ⚠ The classic first rocket kills its pilot, silently (M)
- **What I did.** I built the craft every KSP veteran builds first: capsule, chute, tank, engine, no heat shield.
  I flew it straight up to 104 km, then flew three descents: SAS prograde, SAS retrograde and SAS off.
- **What happened.** The crew was lost every time.
  - The chute armed at 25 km and stayed "armed" to the ground.
  - The capsule hit at 255–300 m/s (`career-fly2.log`, `career-noshield-sasoff.log`; `career/22-chute.png`).
- **Root cause.**
  - The chute only opens below its rated 25 kPa (`data/parts/utility.ts:23`, `sim/vessel/aero.ts:307`). That is
    about 204 m/s at sea level.
  - A bare pod falls at 260–300 m/s, because blunt-body trim exists only with a heat shield. DECISIONS
    (op/career) lists "bare-pod aerodynamic trim" as "not changed (owner's call)".
- **Headless repro:** shielded variants landed in 6/6 runs; bare-pod variants were lost in 2/2.
- **No warning anywhere:**
  - The editor's pre-flight says "ready".
  - In flight, the staging stack disappears after the last stage, so there is no chute indicator.
  - No message says "chute waiting: too fast".
- **For contrast:** with the shield and SAS retrograde, the capsule splashed down at 6 m/s and the debrief
  paid +22,000 cr (`career-shield-retro/22c-full.png`, `25-debrief.png`).
- **Fix:**
  - (a) Pre-flight warning: "Capsule without heat shield: parachute can't open above ~200 m/s; this craft falls
    at ~280."
  - (b) An in-flight chute state on the HUD: "CHUTE ARMED · too fast (48 / 25 kPa)".
  - (c) Reconsider giving bare pods a mild blunt trim, or a chute that semi-deploys at 1.5× and only cuts
    above 2×.

### 2. ⚠ "Land here" lands in the dark, and the landing is a black screen (M)
- **What happened.** The Land-here assist landed perfectly (1.5 m/s, no cautions). But the site was on the lunar
  night side, so from 3 km to touchdown, EVA and flag, the screen is black apart from the lit lander and a
  silhouette (`moon/d02-alt-300.png`, `d03-landed.png`, `d06-flag.png`).
- **Why it matters.**
  - This is the climax of the game, and a first-time player sees nothing.
  - This is almost certainly the 10-07 "black screen at 2,955 m" (13.3).
  - Night vision (F7) exists, but nothing suggests it.
- **Fix:**
  - (a) The land assist and planner show day/night at the touchdown point and offer "wait for daylight" (S).
  - (b) Earthshine on the lunar near side and a stronger night ambient on airless bodies (M).
  - (c) Auto-suggest F7 or lights below 3 km in darkness (S).

### 3. ⚠ The planner's ★ recommendation costs an hour of real time (S)
- **What the planner offers.** From an 82 km parking orbit, Transfer → Moon lists:
  - "Go now with a plane change" (wait 25 min, 1,239 m/s).
  - ★ "Transfer window (lowest Δv)" (wait 7d 16h, 1,203 m/s): **36 m/s cheaper**.
- **What happens if you trust the ★.** The Execute-node assist warps at 50–100×, because the rails warp limit
  at 82 km is index 3–4 (`game/timewarp.ts:27`, `RAILS_CLEARANCE`; 12.7 km clearance above the atmosphere is
  needed for 100×). That orbit is the one the game's own Launch-to-orbit assist delivers.
  - Eight real minutes covered 8 game hours (`moonB.log`).
  - The whole wait would take about 1.5 hours real time.
- **Fix:**
  - (a) Star the cheapest option *within ~5% Δv of the soonest* (S).
  - (b) Let warp-to-node and the assist use the exact rails warp up to the node regardless of altitude
    clearance (rails propagation is exact; the clearance only matters near atmosphere and terrain) (S–M).

### 4. Parachute state is invisible (S)
- **Problem.** Once the last stage fires, the staging stack is empty (`career/22-chute.png`). There's no armed,
  semi or full indicator and no "unsafe speed" readout.
- **KSP comparison.** KSP colours the chute icon. Here a veteran can't tell "armed and waiting" from "broken".
- **Fix:** keep fired chutes in the stack with a coloured state, or show a CHUTE badge next to the gear and
  brakes lamps.

### 5. ⚠ Editor layout bugs in the first screen you build in (S)
- **Clipped Δv.** The top-bar Δv is clipped by the LAUNCH button ("1,8" for 1,811 m/s, "0 m/" when empty) at
  1600 px (`career/11-built.png`, `first/07-editor.png`).
- **Overlap.** The bottom-right "TOTAL ΔV" footer is overlapped by the key-hint bar ("…ACE").
- **Narrower screens.** The owner's 1470-px Mac window will be worse.

### 6. False alarms (S)
- **SINK RATE under a reefed chute.** `flight/alerts.ts:72-75` ignores chute drag, so every normal chute descent
  shows "SINK RATE · 15 s to ground", through to a full canopy at 8 m/s (`career-shield-retro/22c-full.png`,
  `moonF.log` at 1.6 km).
- **Red G-LOAD for most of the first ascent.** The hand-built first rocket (TWR 9.2 at burnout, shown in the
  editor without comment) shows red "G-LOAD 9.7 g" for most of the burn, with no hint about throttling down.
- **Fix:** treat deployed chutes as braking. Warn in the editor when a crewed stage exceeds ~6 g.

### 7. The Moon-return plan says you can't afford it (S)
- **Problem.** Transfer → Earth from lunar orbit shows "short 555 m/s · have 691". It adds a 991 m/s Earth
  capture burn that a capsule never flies, because it aerobrakes (`moonE.log`, `moon/e02-return-planned.png`).
  A veteran with plenty of fuel is told they will be stranded.
- **Fix:** no capture Δv for a destination with an atmosphere when the plan's perigee is inside it. Label it
  "direct entry".

### 8. Career has nothing to want after the Moon (L)
- **Unchanged since 10-07** (code check):
  - The tech tree is still 25 nodes binned by cost (`data/technology.ts`).
  - There are 4 contract kinds with 20-year deadlines (`sim/science/progression.ts`) and 8 experiments.
  - There is no crew XP or strategies.
- **The first hour is fine:** clear "Next goal" card, sensible offers, +22k cr for a test hop.
- **What's missing is depth.** Facility upgrades are the only new sink.

### 9. Small wrong details a veteran notices (S)
- **Rovers and EVA have no mission clock.** MET reads "T+ 00:00:00 (pre-launch)" on a rover driving at 18 m/s
  and on an EVA kerbal on the Moon (`misc/r02-driving.png`, `moon/d06-flag.png`).
- **The Test flight objective fires too early.** "Surface objective achieved: Test flight… Recover" appears at
  899 m under the chute, before touchdown (`career-shield-retro/22c-full.png`).
- **The debrief's altitude is really a distance.** "Max altitude 37.49 Mm" on a Moon trip is the distance from
  Earth, not an altitude.
- **The map's prediction label is odd in a stable orbit.** It says "Landing: hold attitude" (`moon/a07-map.png`).

### 10. Planner panel is cramped and cluttered (S)
- **Transfer list clutter.** From LEO, Transfer lists five asteroids and two comets next to Mars and Venus.
- **Cramped panel.** The departure list scrolls inside a short panel, and the label is cut off ("DEPARTURES ·
  MO…").
- **The planned transfer runs off-screen.** After planning, the map stays on Earth and the transfer runs off the
  top edge (`moon/b03-planned.png`); you need "Show whole transfer".
- **Fix.** Group the destinations into planets and small bodies, open the whole-transfer view once after
  planning, and give the departure list more height.

### 11. ⚠ Firefox: launch picker and frame rate (S to investigate)
- **Enter didn't fly the vessel.** In Firefox (puppeteer, Windows), Enter on the focused Launch Pad row ("ENTER
  FLIES THE HIGHLIGHTED VEHICLE") left the scene on the hub. A click flew immediately (`ff/99-error.png`, run log).
  It works in Chrome. Possibly a driver artefact; needs a manual check.
- **Steady 33–35 fps.** Firefox held 33–35 fps everywhere, including the static hub. That looks like a capture or
  automation cap, not GPU load. Verify on the owner's Zen before playtesters use Firefox.

### 12. Sound is synthesized only (M–L, not heard this run)
- **Not checked by ear.** I didn't listen this run. The code shows no recorded samples anywhere.
- **Why it matters.** Synthesized roar and pyro are now scaled correctly, but a launch still won't sound like
  the real thing. Playtesters judge feel heavily on sound.
- **Next step.** Record a 30 s launch and staging clip on the owner's machine before the playtest.

### 13. Part breadth for veterans' builds (M)
- **Still missing:** a 1.875 m size, engine plates and procedural tanks.
- **Added since 10-07:** six couplers and real fairings.
- **Who notices:** veterans who cluster engines notice the gap in the first hour.

### 14. Ascent atmosphere is still thin (M)
- **What's left:** one cloud layer, and a Mach effect of 0.16 opacity.
- **What works now:** the smoke column, but only on the stock launchers.
- **Liquid first rocket:** its exhaust still leaves sparse glowing dots behind it (`career-shield-retro/16-10s.png`).

### 15. Docking and IVA unproven for a public test (M)
- **Docking.** The Rendezvous Race starts nicely: target set, docking HUD with range, lateral offset and
  alignment. My scripted approach drifted away instead of closing (`misc/k04-end.png`), so I can't vouch for the
  hands-on feel. Have the owner do one docking before the playtest.
- **IVA.** IVA is hidden, not built.

**Also seen, minor:**
- Lunar orbit on the night side is a lit vessel against pure black (`moon/c07-llo-flight.png`).
- The heat shield's glowing face reads as a hollow tube during entry (`moon/f03-entry-35000.png`).
- Ladder text still says astronauts can't climb it.

### What a playtester will hit first, in order
1. Item 1, if they build their own first rocket, which veterans will.
2. Item 5 in the first editor minute.
3. Item 6 on the first flight.
4. Item 3 on the first Moon attempt, if they trust the ★.
5. Item 2 at the Moon.

Fixing 1, 2, 3, 5 and 6 is about 3–5 days of work and removes every "this is broken" moment I found.

---

## 3. What is now clearly better than the classic
- **One-click Moon round trip that actually works.**
  - Orbit with the launch assist.
  - Planner-made TLI, 0.1 m/s off plan.
  - Encounter, capture, landing at 1.5 m/s and ascent.
  - Transfer → Earth and splashdown, with the assists teaching each step.
  - The weak points are the defaults, not the machinery.
- **The first-flight card**, Next-goal card and debrief make the first hour readable.
- **The pad, smoke column, Earth from orbit, and re-entry plasma** look good (`career/13-pad.png`,
  `moon/a05-asc-2.png`, `moon/f03-entry-35000.png`).
- **Editor:** symmetric pick-up, Alt-copy, gizmos, a body picker and correct autostaging out of the box.
