# Progress Report

_Last updated: 2026-10-15_

## Start here

- **Play now:** <https://web-space-program.pages.dev> — every push to `main` that passes CI deploys there ([setup](docs/DEPLOY.md)).
- **Play locally:** Node 24.14.1 (`nvm use`), `npm ci`, then `npm run play`.
  This builds and opens the production game. For development: `npm run dev`.
- Start with **Training**, a quick-start mission, or **New Program → Sandbox**.
  Science adds research; Career adds funds, commissions and facility upgrades.
  Use the stock craft picker’s groups, Features and Try this tips. F1 opens controls.
- **Current catalog:** 44 stock picker entries (32 Standard, 5 Challenging, 7 Real),
  173 parts and 61 celestial bodies, counted from the exported catalogs on this branch.
  The same design may have separate entries for different scales.
- **What works:** build rockets, aircraft and rovers; fly, stage, land, recover,
  dock and EVA; explore the solar system with maneuver nodes, transfer windows,
  flight assist and warp. Saves, craft sharing, photography, flight records,
  science, research, communications, mining and optional precise gravity exist.
  Earth uses measured geography, imagery and biomes; Saturn has rings and moons.
- **Checks:** 2,001 tests across 214 files (2,000 passed, one skipped locally). Lint, TypeScript, the full
  headless suite and production build run on
  every push and pull request. CI evidence and hosting checks: [shipping report](docs/SHIPPING.md).
- **Known limits:** multiplayer needs its separate
  experimental LAN server. Career progression is proven through the Moon; longer
  career validation is a separate shipping-wave task. The hosted Ultra preset uses
  8k Earth imagery because the optional 16k pack is not in git. Close city streets
  are illustrative, not surveyed. Firefox shader warm-up can make loading slow.
  Automated Windows/RTX checks do not establish Mac/Zen, Safari or sustained 120 Hz
  performance. See [balance evidence](docs/BALANCE.md) and [performance notes](docs/PERFORMANCE.md).

## Recent changes

### 2026-10-15 — Career past the Moon

- The career now continues to Venus and Mars on every scale. A new **Petrel Planetary Probe** reaches both, the hub
  counts down to launch seasons, first arrivals and landings pay milestones, and planet contracts appear.
- Fixed: Execute next node cut plane-change departures short; the planner's "Go now" cost more than listed; the
  Venus lander had no antenna. Still open: Real Mars orbit, and the Venus lander landing out of Earth's view.

### 2026-10-15 — Veteran audit 2 and playtest kit

- The 2026-10-07 gap list is about 85% closed; a Moon round trip with the stock Selene, the planner and the
  assists now works end to end on the real GPU. [Audit](docs/audits/2026-10-15-veteran-audit-2.md).
- Before outside players: warn about chutes on capsules without a heat shield, fix the planner's 7-day ★ default
  and the low-orbit time-warp cap, avoid black night-side Moon landings, fix the clipped editor Δv, and silence
  SINK RATE under parachutes. Playtest guide for outside players: [PLAYTEST.md](docs/PLAYTEST.md).

### 2026-10-15 — Shipping pipeline

- GitHub Actions checks Node 24.14.1 builds and retains the main build artifact.
  Main deploys that artifact to Cloudflare Pages after owner setup; missing secrets
  skip deployment. No production changes are made by this branch.
- Hosting has isolation/cache headers, a real 404 page and a build-size guard.
  Ultra imagery selects packaged levels without missing-16k requests.
- This report is now a current entry point. Every previous long report is preserved
  verbatim in the [October archive](docs/progress/2026-10-archive.md).

### 2026-10-15 — Stock fleet and worker recovery

- Six playful designs plus seven launchers/spacecraft expand the stock fleet:
  ion exploration, Venus landing, lunar hopping, a Mars orbiter and more. Picker
  groups and research names explain what each design does. Cached library entries
  reduce repeat opens. Ion drives pause in shadow and resume with power.
- Worker load failures recover with bounded respawns/fallbacks. Terrain chunks no
  longer queue behind long far-planet bakes, reducing measured flight load time.
- Earth science biomes now use MODIS cover plus Florida NLCD wetlands and lakes;
  legacy science identifiers remain valid. Night cities exclude water and close
  streets fade into mapped Black Marble light networks.
- Details: DECISIONS.md, [city evidence](docs/performance/nightcity.md).

### 2026-10-13–15 — Earth, night flight and map

- Regional Earth imagery, coherent clouds, terrain materials and water/night-light
  fixes improve flight views. Night vision makes the vessel and pad readable.
- Map launch framing follows the climb. Zoom stays anchored under the cursor and
  body/vessel focus survives closing and reopening the map within a flight.
- Measured GPU evidence is platform-specific; remaining geography/detail limits
  are documented in the archived wave reports and DECISIONS.md.

### 2026-10-13 — Career, lunar returns and facilities

- Headless careers cover sounding flights, orbit, lunar science and Moon landing
  across all three scales. The first rocket returns safely; free-return planning
  and Entry trim help crewed lunar returns. Real scale gains a lunar probe.
- Hub Next goal names the craft/research still needed. Four facilities have three
  upgrade levels; old saves retain their previous launch limits.
- Probe nodes uploaded while connected can execute outside ground contact.
  [Balance and playthrough evidence](docs/BALANCE.md) records the limits.

### 2026-10-09 — EVA and rendering reliability

- EVA movement/boarding, camera behaviour and surface interactions receive a second
  pass. Vessel colour variants batch correctly, including context restoration.
- Chrome/Firefox rendering checks and performance reports remain in the archive.

### 2026-10-08 — Flight planning, handling and builder

- Truthful HUD readouts, mission alarms, background landing prediction, transfer
  window lists and staged burn timing improve planning without render-loop searches.
- Builder placement/editing, part panels and flight handling gain focused polish.
  Ground appearance, effects and loss feedback are expanded with pooled effects.

### 2026-10-06–07 — Performance and flight presentation

- CPU/GPU, memory and loading passes reduce repeated work; Retina resolution,
  terrain batching and shader warm-up receive explicit measurement tooling.
- HUD/map layout, Earth imagery/clouds, part art, coastal scenery and audio improve.
  Browser compatibility, lunar transfer and owner-playtest fixes land alongside them.
- [Performance notes](docs/PERFORMANCE.md) distinguish measured results from targets.

### 2026-10-04–05 — Core feature waves

- Science/career, EVA, aircraft, communications, LAN co-op, expedition parts,
  surface mining, training, Spacepedia and the stock showcase fleet are integrated.
- Quick-start missions, craft/save sharing, photo mode, flight records, struts/fuel
  lines, optional precise gravity and environmental hazards extend the sandbox.
- Flight effects, parts/hangar art, controls/settings and integration QA follow.
  Full reports, controls and original evidence are in the [archive](docs/progress/2026-10-archive.md).
