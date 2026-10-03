# Progress Report

_Last updated: 2026-10-03_

## How to run
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation test suite
```
Dev shortcuts:
- `/?flight=stock-selene&scenario=moon` — start in low lunar orbit (`scenario=orbit`, `scenario=reentry` too)
- `/?flight=stock-meridian` — jump straight onto the launch pad (`stock-kestrel`, `stock-meridian`, `stock-selene`)
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
| Esc | pause menu |
| Mouse drag / wheel | orbit camera / zoom |

## Status (milestone 1: build → launch → orbit → Moon)
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
| Launch complex scenery + 3D Space Center hub | 🚧 in progress |
| Tracking Station | 🚧 in progress |

See DECISIONS.md for choices made autonomously.

## Tracking Station implementation
- Added lazy-loaded tracking scene, fleet situation groups and focus/fly/recover/confirmed termination controls, body tree and scaled body information, and warp controls through 1,000,000× with world/time persistence on exit.
- Added `World.advanceRailsTo(ut)` for unattended propagation and additive `MapView.setExtraOrbits` / `pick` APIs; existing flight map API preserved. Tracking owns render resources and cleans up on scene exit.
- Verified TypeScript, existing 271 Vitest tests plus two tracking propagation tests, and SwiftShader screenshot `/tmp/ts.png`. Space Center tile change limited to enabling navigation (other agents own its background).
