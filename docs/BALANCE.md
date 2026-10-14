# Career and launch balance — 2026-10-07

Reproduce the tables with `npx tsx scripts/balance-analysis.ts`. Flight regressions live in
`tests/balance-aero.test.ts` and `tests/balance-career.test.ts`; run with
`npx vitest run --maxWorkers=2`. No physics parameters, resource densities, engine ratings,
or deterministic trace fixtures were changed.

## Flown career playthrough — 2026-10-13 (op/career)

`npx tsx scripts/career/playthrough.ts standard|challenging|real` plays a new career through the real `World`:
contract desk (accept what can be flown, decline the rest), stock craft, autopilot building blocks for the
flying, the Science app's experiments in every situation, recovery and research. It is a diligent player who
never crashes; each flight is minutes of CPU. `tests/career-playthrough.test.ts` keeps the key steps green.

Standard, after this pass (all flights succeed; science column is banked after the research bought):

| # | Flight | Cost cr | Science earned | Science banked | Funds after | Game day | Research bought |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | Kestrel hop, straight up (314 km apex) | 5,848 | 112 | 92 | 91,994 | 0 | propulsion-0, energy-0 |
| 2 | Kestrel hop again | 5,848 | 56 | 138 | 118,988 | 0 | discovery-0 |
| 3 | Firstlight orbit (starting parts) and return | 7,636 | 88 | 226 | 166,048 | 0 | — |
| 4 | Meridian free-return Moon flyby, entry trim 0.7 m/s | 11,050 | 133 | 269 | 278,667 | 3.0 | propulsion-1, structures-0/1, guidance-0 |
| 5 | Selene crewed Moon landing and return | 31,157 | 235 | 504 | 335,175 | 6.8 | — |

Before this pass, the same route failed on flight 1: the Kestrel flown straight up lost its crew (also with the
engines cut at 100 or 150 km apoapsis; only arcs tipped ≥ 30° survived), and the planner's Moon transfer
(30 km periapsis) flung a Meridian into solar orbit — it cannot capture and return.
**With facility upgrades (op/facilities, same route).** The playthrough now buys the upgrade a launch needs right
before it and invests surplus in the Research Lab, then Mission Control, keeping 40 k × the credit multiplier in reserve.

| # | Flight | Funds after (was) | Science banked (was) | Game day | Upgrades bought |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | Kestrel hop | 51,994 (91,994) | 92 (92) | 0 | Mission Control 2 (40 k) |
| 2 | Kestrel hop again | 78,988 (118,988) | 138 (138) | 0 | — |
| 3 | Firstlight orbit | 79,048 (166,048) | 226 (226) | 0 | Research Lab 2 (60 k) |
| 4 | Meridian Moon flyby | 54,667 (278,667) | 284 (269) | 3.0 | Mission Control 3 (150 k) |
| 5 | Selene Moon landing | 77,175 (335,175) | 546 (504) | 6.8 | Launch Pad 2 (40 k, needed for the 53 t Selene) |

Challenging: same flights and timeline (orbit flight 4, free-return flyby flight 5, day 14); Mission Control 2
(410 k) and Research Lab 2 (614 k) bought; 1.05 M left (was 2.06 M). Real: same timeline (orbiter flight 4; the Meridian
Real still cannot reach the Moon); Research Lab 2 (6 M) bought; 5.8 M left (was 11.8 M). Neither larger-scale route
reaches a lander in the playthrough, which would need a level-2 pad and hall (666 k / 6.5 M).

A Mars window from a Standard parking orbit (day 12): next in 66 days, 1,164 m/s, 84-day flight (Venus: 31 days,
1,129 m/s); a Meridian upper stage has 1,448 m/s left in orbit, and probe cores (Precision Attitude, 135 science
cumulative) are affordable right after the Moon landing. Planned, not flown.

Challenging / Real (route: Kestrel hops at 0°, 30°, 60°, then the scale's stock orbiter, then a free-return
flyby with it):

| Scale | Hops to the orbiter's 280 science | Orbit flight | Moon flyby | Science banked / spent | Expedition needs | Funds after |
| --- | ---: | --- | --- | --- | ---: | ---: |
| Challenging | 3 | flight 4 | flight 5 (Meridian Challenging, free return) | 128 / 290 | 595 | 2.06 M (from 614 k) |
| Real | 3 | flight 4 | not possible: Meridian Real has no Δv for TLI | 84 / 290 | 775 | 11.8 M (from 6 M) |

On Real the next ~400 science must come from Earth biomes and orbital situations before any lunar hardware.
Before this pass hop 1 alone paid ~300 k (Challenging) / ~3 M (Real) from scale-multiplied Earth contracts.

What a diligent Standard player meets: Moon landing on flight 5, everything researched for it by flight 3; funds
never constrain (335 k unspent after the landing). Not retuned here: see the owner recommendations in PROGRESS.md.

## Findings and scope

Selene's old launch warning was misleading as an assessment of its normal controlled ascent.
The fully fuelled craft really has a destabilizing aerodynamic moment; it is not passively stable.
Fuel burn moves its CoM forward, and the powered ascent has sufficient gimbal/control authority.
A normal Standard ascent measured maximum AoA **8.66° above 1 kPa dynamic pressure**, without
flipping or structural loss. The regression bounds this at 12°. A symmetric two-axis estimator
now samples launch-stage fuel draw at 0–80% burn and Mach 0.3/0.8/1.1/1.5/2.5, uses the actual
occluded drag/lift/control force model, and includes engine gimbal torque with a 50% reserve.
Dynamic pressure is bounded by sea-level density and a conservative 25 kPa envelope. Reaction
wheels receive no credit. Negative remaining restoring/control margin warns. This is a powered,
SAS-assisted ascent advisory; an unpowered/reentry assessment needs another flight envelope.
Forward fixed fins and an uncontrolled heavy-tail/no-fin rocket still warn in tests.

All 27 stock crafts were checked using the same first-stage stats as the editor.
Remaining warnings include **missing parachutes** on Swift,
Daybreak, Hearthlight, Longreach and Alembic. Inspection confirms these crewed vehicles have
no parachute modules: runway, powered landing or orbital crew transfer is required. The audit
checks presence of the warning against actual hardware. **Earth launch TWR below 1** is
also correctly reported for Pebblecatcher, Moonmoth Delivery Lander, Bedrock, Longreach,
Emberleaf and Hazewalker: these are destination/orbital designs, not standalone Earth launchers.
Their first-stage Earth TWR is listed below. A clear preflight does not certify that
an orbital tug, rover or destination lander can launch from Earth.

The old first batch offered a Moon surface-return mission immediately, first propulsion research
lacked the obvious orbital vacuum engine/tank, and there was no financial recovery path.
The revised program starts with Earth orbit, Earth recovery and Earth field science. Lunar flyby
commissions require Earth orbit and first propulsion research; lunar orbit follows demonstrated
Moon arrival plus propulsion tier 1; lunar landing/return and lunar surface surveys also require
structures tier 1. Far-body offers require Moon landing, propulsion tier 3 and energy tier 2.
No contract specifies a particular instrument: the starting thermal sensor can satisfy biome
surveys on the surface. Existing accepted commissions retain their original terms.

## What changed

- Firstlight is an original foundation-only orbital stock craft. Its headless career flight (with
  a starting thermal sensor attached) reaches a periapsis above the Standard atmosphere.
- Propulsion 0 (10 science) unlocks Zephyr and the long 1.25 m tank. Propulsion 1 (35 more)
  unlocks Chinook, Doldrum and the 2.5 m tank family. Adapter 1–2 moves to structures 0;
  landing legs move to structures 1. Three-metre tanks, Tempest and Foehn move to propulsion 2 for larger-scale orbit;
  all other catalogue assignments remain unchanged.
- Earth orbit pays a 5,000-credit advance and 18,000-credit completion; the first-orbit milestone
  adds 15,000 credits and 20 science. Moon flyby pays 20,000 advance and 40,000 completion;
  first Moon arrival adds 40,000 credits and 35 science. Rewards/advances scale with the existing
  credit multiplier; research prices and experiment yields do not.
- Offered commissions can be declined without penalty, allowing stale/unwanted offers to be
  cleared. Existing active commissions retain their penalties and three-slot limit.
- Mission Control provides repeatable emergency funding: funds below 8,000 scaled credits are
  restored to that amount at a cost of 5 reputation. This works with all slots occupied, negative
  funds, exhausted science subjects and any research state. No reputation minimum blocks it.
  The stipend funds Firstlight (7,456 cr) or an instrumented Kestrel; advanced missions still
  require earning more. The rule deliberately permits recovery after arbitrary failures.

## Progression and science assumptions

The scripted ledger below pays full craft prices, equips only unlocked sensors and gives **zero
salvage refunds**. Science is calculated with the actual experiment availability, subject keys,
body multipliers and 50% repeat decay. It assumes successful recovery of stored data, crew
observations, EVA surface samples at landed field sites, and deliberately selected new biomes.
Every vehicle purchase is checked against the actual unlock/funds validator. Orbital missions
carry only the thermal sensor, avoiding irrelevant atmospheric/surface instruments.

Flight tests separately verify starting-only orbit and a 20-science Meridian orbit-to-Moon-SOI
sequence; the entire 12-mission ledger is not an autopilot campaign. Biome targeting, EVA,
science recovery and pilot success rates remain player skills. A skilled player can orbit/fly by
earlier; the missions 4/11 schedule is a plausible learning route, not an enforced grind.
Landing hardware costs only 110 cumulative science across the selected propulsion, structures,
guidance and energy path, and is available by mission 7 in this ledger; landing is scheduled
later than the first flyby for flight practice. The existing Selene mission tests verify landing
and return propulsion independently.

| Research path | Cumulative science | Demonstrated capability |
| --- | ---: | --- |
| Foundation | 0 | Standard orbit: Firstlight, no locked parts |
| Propulsion 0 + energy 0 | 20 | Standard Meridian orbit and Moon flyby (headless flight) |
| Propulsion 1 + structures 1 + guidance 0 + energy 0 | 110 | Standard Selene landing/return hardware |
| Propulsion 2 + structures 2 + energy 0 | 280 | Challenging/Real Meridian stock orbital hardware |
| Propulsion 2 + structures 3 + guidance 2 + energy 0 | 595 | Challenging Selene expedition hardware |
| Propulsion 3 + structures 3 + guidance 2 + energy 0 | 775 | Real Selene expedition hardware |

## Scale and tier interpretation

There is no finite maximum Δv for a tier with unlimited stages. The unlock-envelope table gives
**achievable reference designs**, not an optimizer's bound. Identical parts have identical ideal
Δv at every scale; gravity/drag losses and required orbital speed change. The table repeats
smaller designs on larger worlds to make the shortfall visible. Higher tiers retain earlier parts.
Jet Δv in the stock table includes intake-air propulsion and is not a vacuum launch budget.

Standard meets the requested orbit by missions 4–6 and Moon flyby by 10–14 on the scripted
route. Challenging/Real foundation hardware falls short of a comfortable orbital budget: those
scales intentionally require more staging/research. Four deliberate field/hop science missions can provide 326 science before orbit: 46 from the
initial crew/thermal/EVA survey, 100 from a fresh surface site plus low-atmosphere observations
with pressure/seismic instruments, then 90 each at two fresh sites after adding magnetometry.
Discovery 0/1 costs 45, leaving 281 for the 280-science stock-orbiter path. This supports larger-scale
orbit around missions 5–6. Orbital milestones, new situations and more field work can then fund
the 595/775-science expedition paths for Moon flyby around missions 10–14, followed by landing
practice. These larger-scale mission counts are analytical estimates, not newly flown career
campaigns; existing tests fly the Challenging/Real expedition vehicles through orbit and lunar landing.

| Scale | Initial funds | Recovery floor | Stock orbital cost | Stock lunar expedition cost |
| --- | ---: | ---: | ---: | ---: |
| Standard | 60,000 | 8,000 | 10,870 (or 7,456 foundation) | 30,977 |
| Challenging | 614,400 | 81,920 | 42,925 | 157,177 |
| Real | 6,000,000 | 800,000 | 84,332 | 1,393,197 |

Existing credit scaling is generous and covers the heavy launchers; science, not vehicle price,
is the larger-scale constraint. Retain it for this pass rather than add an untested harsher economy.
Repeated orbit contracts provide renewable income; repeated science subjects have finite yield,
so new situations/biomes/instruments are required for research. Emergency funding protects
against bankruptcy even if all active contracts are impractical. Offers that outstrip a player's
current craft can be declined; no specific locked part is required by an early commission.

## Generated reference tables

Stock hardware and advisories (vacuum Δv is not a destination guarantee)
| Craft | Scale | Cost cr | Δv m/s | Earth launch TWR | Required research | Advisories |
| --- | --- | --- | --- | --- | --- | --- |
| Kestrel Sounding Rocket | standard | 5668 | 2536 | 3.26 | foundation | none |
| Meridian Orbiter | standard | 10870 | 4962 | 1.40 | propulsion-0, energy-0 | none |
| Selene Lunar Lander | standard | 30977 | 7162 | 1.81 | propulsion-0, propulsion-1, structures-0, structures-1, guidance-0, energy-0 | none |
| Swift Jet | standard | 11080 | 12416 | 1.36 | aviation-0, aviation-1, aviation-2, aviation-3, guidance-0 | chute |
| Ringrunner Saturn Probe | standard | 37275 | 10940 | 1.52 | propulsion-0, propulsion-1, propulsion-2, structures-0, structures-2, aviation-0, guidance-0, guidance-2, guidance-3, energy-0, energy-1 | none |
| Pebblecatcher | standard | 18844 | 2116 | 0.37 | propulsion-0, propulsion-1, structures-1, guidance-1, guidance-3, energy-0, energy-3, discovery-2 | twr |
| Wren Tender | standard | 9204 | 2706 | 1.24 | propulsion-0, propulsion-1, structures-2, guidance-1, guidance-3, energy-0 | none |
| Hearthlight Station | standard | 118784 | 9103 | 2.35 | propulsion-0, propulsion-1, propulsion-2, propulsion-3, structures-0, structures-2, structures-3, guidance-0, guidance-1, guidance-2, guidance-3, energy-1, energy-2 | chute |
| Homeward Crew Ferry | standard | 111129 | 8897 | 2.27 | propulsion-0, propulsion-1, propulsion-2, propulsion-3, structures-0, structures-2, structures-3, guidance-0, guidance-1, guidance-3, energy-0 | none |
| Moonmoth Rover | standard | 33024 | 660 | 0.10 | propulsion-0, propulsion-1, structures-1, structures-2, guidance-3, energy-3, discovery-1 | none |
| Moonmoth Delivery Lander | standard | 39878 | 2379 | 0.90 | propulsion-0, propulsion-1, structures-0, structures-1, structures-2, guidance-3, energy-3, discovery-1 | twr |
| Bedrock Prospector | standard | 37194 | 1208 | 0.57 | propulsion-0, propulsion-1, structures-3, guidance-3, energy-2, energy-3, discovery-1, discovery-2, discovery-3 | twr |
| Longreach Transfer Ship | standard | 53278 | 4656 | 0.08 | propulsion-0, propulsion-1, propulsion-3, structures-0, structures-2, guidance-1, guidance-2, guidance-3, energy-2 | twr, chute |
| Daybreak Spaceplane | standard | 22800 | 2793 | 1.45 | propulsion-0, propulsion-2, aviation-1, aviation-2, aviation-3, guidance-0 | chute |
| Emberleaf Mars Lander | standard | 40963 | 725 | 0.63 | propulsion-1, structures-0, structures-1, structures-2, structures-3, guidance-3, energy-1, energy-3 | twr |
| Hazewalker Titan Probe | standard | 40963 | 725 | 0.63 | propulsion-1, structures-0, structures-1, structures-2, structures-3, guidance-3, energy-1, energy-3 | twr |
| Frostwhisker Plume Sampler | standard | 43864 | 2549 | 1.19 | propulsion-1, structures-1, aviation-0, guidance-3, energy-3, discovery-3 | none |
| Gossamer Ring Observatory | standard | 74455 | 10219 | 1.51 | propulsion-0, propulsion-1, propulsion-2, structures-0, structures-2, aviation-0, guidance-0, guidance-2, guidance-3, energy-0, energy-1, energy-3 | none |
| Atlaswake Heavy Lifter | standard | 93991 | 11753 | 2.41 | propulsion-1, propulsion-2, propulsion-3, structures-0, structures-2, structures-3, aviation-0, guidance-0, guidance-3 | none |
| Beaconseed Relay Launcher | standard | 33621 | 10946 | 1.80 | propulsion-1, propulsion-2, structures-0, structures-2, aviation-0, guidance-0, guidance-3, energy-0, energy-1 | none |
| Alembic Laboratory | standard | 122384 | 8818 | 2.35 | propulsion-0, propulsion-1, propulsion-2, propulsion-3, structures-0, structures-2, structures-3, guidance-0, guidance-1, guidance-3, energy-1, energy-2, discovery-3 | chute |
| Kestrel Sounding Rocket | challenging | 5668 | 2536 | 3.26 | foundation | none |
| Kestrel Sounding Rocket | real | 5668 | 2536 | 3.26 | foundation | none |
| Meridian Challenging Orbiter | challenging | 42925 | 8135 | 3.97 | propulsion-0, propulsion-1, propulsion-2, structures-0, structures-2, energy-0 | none |
| Selene Challenging Expedition | challenging | 157177 | 15106 | 1.73 | propulsion-0, propulsion-1, propulsion-2, structures-0, structures-1, structures-2, structures-3, guidance-2, energy-0 | none |
| Ringrunner Real Saturn Probe | real | 1473660 | 18843 | 1.30 | propulsion-2, propulsion-3, structures-0, structures-2, structures-3, aviation-0, guidance-2, guidance-3, energy-2, energy-3 | none |
| Meridian Real Orbiter | real | 84332 | 10874 | 1.36 | propulsion-0, propulsion-1, propulsion-2, structures-0, structures-2, energy-0 | none |
| Selene Real Expedition | real | 1393197 | 20379 | 1.30 | propulsion-0, propulsion-1, propulsion-2, propulsion-3, structures-0, structures-1, structures-2, structures-3, guidance-2, energy-0 | none |
| Firstlight Orbiter | standard | 7456 | 4140 | 1.98 | foundation | none |

Unlock envelopes: highest Δv Earth rocket fixture whose every part is available. These are lower bounds on achievable Δv; unlimited staging has no unique maximum.
| Cumulative branch tier | Science for propulsion branch | Standard fixture Δv | Challenging fixture Δv | Real fixture Δv |
| --- | --- | --- | --- | --- |
| foundation | 0 | 4140 | 4140 | 4140 |
| 0 (all branches) | 10 | 4962 | 4962 | 4962 |
| 1 (all branches) | 45 | 7162 | 4962 | 4962 |
| 2 (all branches) | 135 | 7162 | 8135 | 10874 |
| 3 (all branches) | 315 | 11753 | 15106 | 20379 |

Scale requirements (circular speed; launch allowances are planning assumptions)
| Scale | Low orbit altitude km | Circular speed m/s | Launch budget m/s | Moon departure from low orbit m/s |
| --- | --- | --- | --- | --- |
| standard | 90 | 2341 | 3741 | 939 |
| challenging | 119 | 4349 | 6149 | 1748 |
| real | 160 | 7812 | 9612 | 3143 |

Scripted Standard campaign: full vehicle cost lost each flight, full recovered science, no salvage credited. Surface/flight contexts are chosen deliberately; this is not a novice success-rate model.
| Mission | Objective | Cost cr | Science earned | Science bank | Funds after | Research purchased |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pad survey / short hop | 5848 | 46.0 | 36.0 | 84152 | discovery-0 |
| 2 | Low atmosphere / grassland hop | 6748 | 100.0 | 116.0 | 94404 | propulsion-0, energy-0 |
| 3 | High atmosphere / splashdown | 6098 | 52.0 | 168.0 | 105306 | — |
| 4 | First orbit | 7636 | 36.0 | 159.0 | 152670 | propulsion-1, structures-0 |
| 5 | Orbital repeat / technique | 7636 | 8.0 | 167.0 | 168034 | — |
| 6 | Higher orbit survey | 11050 | 16.0 | 183.0 | 179984 | — |
| 7 | New surface research | 6748 | 74.0 | 212.0 | 186236 | structures-1, guidance-0 |
| 8 | Orbit practice | 11050 | 0.0 | 212.0 | 198186 | — |
| 9 | New field site | 6748 | 74.0 | 286.0 | 191438 | — |
| 10 | Departure rehearsal | 11050 | 0.0 | 286.0 | 203388 | — |
| 11 | Moon flyby | 11050 | 83.0 | 369.0 | 315338 | — |
| 12 | Lunar science follow-up | 11050 | 48.0 | 417.0 | 327288 | — |
