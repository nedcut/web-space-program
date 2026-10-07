# Vessel art, pass 3 — real-GPU before/after

Windows Chrome on the RTX 3060 Ti over CDP 9333. Viewport 1470×920 CSS px, DPR 2 (2940×1840), Medium, render scale 1, adaptive resolution off, with shadows, bloom, clouds and scatter on. "Before" is `main` at `f4784124`, served from an exported copy of that tree; "after" is this branch. All art is original and procedural; nothing is downloaded. These PNGs are not shipped in the bundle.

## Quick look (side-by-side crops, before | after)

- [compare-moon-close.png](compare-moon-close.png): Selene lander stage at rest on the Moon, low sun.
- [compare-pad-upper.png](compare-pad-upper.png): Selene lander/transfer stages on the pad.
- [compare-editor-selene-close.png](compare-editor-selene-close.png): the same stages in the hangar.
- [compare-editor-swift-close.png](compare-editor-swift-close.png): Swift jet tail, wing and main gear.
- Studio close-ups (parts preview, deploy = 1):
  - [capsules](compare-capsules.png)
  - [legs](compare-legs.png), plus [mid-deploy](compare-legs-mid.png)
  - [solar](compare-solar.png)
  - [decouplers, separator, radial](compare-couplers.png)
  - [wings, fins, elevon](compare-aero.png)
  - [gear and wheels](compare-gear.png)
  - [small parts](compare-small.png)

The full frames are `before-*.png` / `after-*.png` for each of these:

- `preview-capsules`, `preview-legs`, `preview-legs-stowed`, `preview-legs-mid`, `preview-solar`, `preview-solar-back`, `preview-couplers`, `preview-aero`, `preview-gear`, `preview-small`
- `editor-selene`, `editor-swift`, each with a `-close` version
- `pad`, `pad-close`, `pad-upper`
- `moon`, `moon-close`

## What changed

- **Engine-aware soot** (`render/parts/soot.ts`): templates no longer carry generic soot. Each craft is baked from its actual nozzle exits (`exhaustAnchor`, exit radius):
  - Base recirculation is full strength along the engine bay. It decays above the bay and outside the nozzle radius, with a far-field fade so hardware well above a stage stays clean.
  - The plume cone plus a near-field wall jet scorch the decoupler and tank top of the stage below.
  - Streaks come from angular noise around the axis. An engine never soots its own part.
  - It is baked in flight (`VesselView.rebuild`, on PartHeat's per-part geometry copies) and in the editor on layout change (clones of the shared template, released with the part).
  - Sooted static parts leave instancing and batch from their own copy.
  - Tank aft ends next to engines end up 40–58 % darker; parts away from engines are untouched.
- **Capsules**:
  - Window reveals and bolt rings.
  - Hatch hinge pins, latch housing and equalisation valve.
  - Heat shields and ablator lips charred toward the rim, a bolted carrier ring with compression pads.
  - Recessed RCS port plates with bezels and three throats; RCS plume staining and rain streaks baked into the body.
  - Lantern: shingle hold-down straps. Harbor: blanket close-out tapes and grab rails.
- **Landing legs**:
  - A clevis with cheek plates and a nutted through-pin; a bolted rail.
  - A hydraulic primary strut with an eye, hex gland nut, wiper, reservoir and hose; a chrome piston into a rod-end fork.
  - A gusseted pad on a ball joint.
  - Two trunnion-mounted telescoping deploy braces. A new exact `aim` constraint in `setPartDeploy` keeps them attached to the strut collar through the whole swing; linear Euler interpolation drifted about 19° mid-deploy.
- **Solar arrays**:
  - Framed aluminium-honeycomb panels with cells on one face only (protected when stowed, facing forward when deployed).
  - Busbars at both ends and mid-panel, a darker back truss with X bays, piano-hinge knuckles and an edge harness.
  - An array drive drum, launch locks and bolts.
  - The fixed tile gains busbars, corner brackets and a junction box with its lead.
  - Still two draws per panel: truss and edge shading is a baked vertex-colour tint on the shared aluminium (new `tint()` helper).
- **Decouplers and separators**:
  - A V-section clamp band over the joint with a dark separation groove.
  - Tension-bolt blocks with studs and red pyro bolt cutters wired to a firing harness.
  - A ring of explosive-bolt bumps, stiffeners on the hazard rings and warning decals by each block.
  - The separator gains bolt rows either side of the frangible joint, the charge conduit, stringers and initiator connectors.
  - The radial decoupler gains domed initiators with leads and a red arming plug.
- **Wings, fins and control surfaces**:
  - A titanium leading-edge strip, spar and rib lines (tinted skin).
  - A dark seal in the hinge gap, hinge brackets across it, an actuator fairing, and rib lines on the moving surface.
- **Gear and wheels**:
  - Split-rim hubs with tie bolts, lightening holes and a valve stem.
  - A brake disc and a caliper on the fork (braked gear).
  - Torque links whose scissor angle follows suspension compression in `setGearPose`.
  - A gland nut and hydraulic line, rounder tyre shoulders with a rim-protector rib, and mount bolts.
- **Small parts**:
  - RCS quad: sooted throats, exhaust staining on the block, bolts and a feed line.
  - Parachute: cap vents, base bolts and a red arming tag.
  - Standalone heat shields: charring.
  - Nose cones: a fastener row and a panel seam.

## Cost

| Measure | main | pass 3 |
|---|---:|---:|
| Paired GPU delta on the pad, Selene, DPR 2 (median of adjacent pairs) | — | **+0.20 ms** (600 pairs, `long-paired-gpu-selene.json`); +0.33 / +0.35 ms in 240-pair runs (`first-`, `second-`) |
| Median frame GPU time in those runs | 5.12 ms | 5.39 ms |
| Compositor draws, paired scene (both views) | 993 | 1,039 (1,079 before the leg draw trim) |
| Program re-resolutions after warm-up | 0 | 0 |
| Scene programs (paired / pad) | 91 / 91 | 91 / 85 |
| Distinct part materials (all parts, High + Low) | 51 | 51 (none added) |
| Selene triangles (High / Low, 28 parts) | 84.1k / 44.2k | 112.0k / 52.1k |
| Meridian / Swift triangles (High) | 44.3k / 9.7k | 56.8k / 21.2k |
| Catalogue template triangles (High, all parts) | 445k | 514k |

The budget was +0.4 ms on the pad at DPR 2 vs main. Every part stays under the 8.5k-triangle High budget, and a new test pins Low at < 5k and ≤ High for every part. Fine hardware (bolts, harnesses, truss, straps, tapes, reveals) is High-only.

Per family (triangles):

| Part | High before → after | Low before → after |
|---|---:|---:|
| pod-lantern-1 | 4088 → 7032 | 1756 → 2836 |
| pod-harbor-3 | 4844 → 8064 | 2244 → 2932 |
| leg-strider | 2092 → 4164 | 956 → 1788 |
| solar-fold | 192 → 1944 | 168 → 544 |
| solar-grand-2 | 336 → 3924 | 312 → 1132 |
| solar-patch | 62 → 246 | 62 → 146 |
| dec-1 | 2864 → 5176 | 1880 → 2448 |
| dec-4 | 4304 → 7776 | 3320 → 3648 |
| sep-2 | 2248 → 6192 | 1160 → 2808 |
| dec-radial | 256 → 612 | 200 → 308 |
| wing-delta | 60 → 244 | 60 → 76 |
| fin-pivot | 120 → 564 | 120 → 172 |
| ctrl-elevon | 112 → 184 | 112 → 112 |
| gear-trundle | 1232 → 4140 | 644 → 1824 |
| rover-wheel-1 | 1208 → 4116 | 628 → 1808 |
| chute-main | 1920 → 2520 | 936 → 936 |
| rcs-nudge | 728 → 972 | 344 → 392 |
| nose-4 | 4304 → 5920 | 2136 → 2136 |
| shield-2 | 2152 → 2152 | 1448 → 1448 |
| tank-2-long | 8200 → 8392 | 3496 → 3496 |

## Reproduce

```sh
npx vite --port 5323 --strictPort --host
WIN_NODE=/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe
"$WIN_NODE" "$(wslpath -w "$PWD/scripts/bench/partsart3.mjs")" after preview,editor,pad,moon http://<wsl-ip>:5323
# baseline src = main copied to .tmp/partsart3-baseline/src
"$WIN_NODE" "$(wslpath -w "$PWD/scripts/bench/partsart3-paired.mjs")" long http://<wsl-ip>:5323 selene 600
npx tsx scripts/art/partBudget.ts [meshKind,...]   # High/Low triangles per part
```

## Left

- **Soot**:
  - It reflects the current engine layout, not burn history. A freshly built rocket on the pad already looks test-fired.
  - A stage that separates keeps only the soot of engines still on it.
  - There is no occlusion: soot reaches around parts by distance and facing only.
- **Legs**:
  - The stowed foot pad still hangs sole-down at the top of the leg.
  - The brace barrel's tail swings a few centimetres off the rail mid-deploy (it reads as a trunnion).
  - The bright sun glint on chrome pistons (bloom) is unchanged from main.
- **Solar arrays** are seen edge-on from most chase cameras. Their gain shows mainly close up and in the Moon shot.
- **Wings**: no stencils, because mirrored partners would show the text upside down.
- Rover wheels share the aircraft wheel design. There is no dedicated rover tread or spoked hub.
- Antennas, batteries, probe cores and reaction wheels kept their existing modelling.
- AO remains per part; there is no contact shadow between neighbouring parts.
