# Progress Report

_Last updated: 2026-10-03_

## How to run
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation test suite
```
Dev shortcuts:
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
| Vehicle Assembly editor UI | 🚧 in progress |
| Planet renderer: LOD terrain, atmospheric scattering, Saturn rings | 🚧 in progress (flight uses plain spheres until integrated) |
| Full Moon mission verified in sim | 🚧 in progress |

See DECISIONS.md for choices made autonomously.
