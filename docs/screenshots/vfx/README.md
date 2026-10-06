# Flight effects — cx/vfx, 2026-10-06

All captures use Windows Chrome on the **RTX 3060 Ti**, ANGLE/D3D11, Medium,
1470 × 920 CSS pixels at DPR 2, **2940 × 1840** drawing buffer, adaptive resolution off.
No reference assets or externally sourced textures are used.

## Changes

- One fixed instanced-billboard pool replaces capped point sprites. Smoke grows into billows;
  particle age, expansion, cooling and ballistic acceleration run in the vertex shader.
  Low/Medium/High cap storage at 128/512/1024 particles.
- Engine trails are suppressed in vacuum. Nozzles directed toward nearby terrain produce
  spreading steam in atmosphere and short ballistic regolith spray on airless bodies.
- The existing single resident effect light now follows throttle-weighted nozzle positions and
  fuel colour, with explosion flashes taking priority. Its count and visibility never change.
- Cold staging/chute puffs, RCS nozzle puffs, splashdown spray, cooling fireballs and embers
  share the pool. RCS uses the same torque/translation direction convention and axis masks as
  the sim and requires remaining monopropellant.
- A light transonic vapour cone uses dense Earth air as a humidity proxy. Its silhouette is
  softened to avoid the sharply triangular appearance found in the first GPU inspection.
- Re-entry has a corrected, monotonic lathe profile, softer silhouette and broken streaming
  flames instead of thin regular stripes. It still follows stagnation heating and leading-part bounds.
- The existing kerolox/solid/hydrolox/methalox/ion/monopropellant analytic plumes already supply
  throttle, turbulence, pressure expansion, fuel-specific HDR colours and shock diamonds;
  these were retained rather than replaced.

## Screenshots

| Scene | Before | After |
|---|---|---|
| Lift-off, fixed side/chase framing | [before](before-liftoff.png) | [after](after-liftoff.png) |
| Transonic ascent (320 m/s, 4.5 km AGL) | [before](before-maxq.png) | [after](after-maxq.png) |
| Staged vacuum upper stage | [before](before-vacuum.png) | [after](after-vacuum.png) |
| Lunar lander, 8 m AGL | [before](before-moon.png) | [after](after-moon.png) |
| Separated return capsule, 20 km | [before](before-reentry.png) | [after](after-reentry.png) |
| Explosion, 0.24 s after burst | [before](before-explosion.png) | [after](after-explosion.png) |

[Live launch with the actual chase camera](live-chase.png) additionally verifies a continuously
emitted atmospheric trail during flight. The six paired scenes are controlled visual fixtures,
not claimed end-to-end flights. The file named maxq exercises the transonic effect; it is not a
measurement of the stock rocket's actual peak dynamic pressure. Vacuum and re-entry fixtures
stage through the real simulation before freezing; Moon uses the Bedrock lander.

The diagnostic fixtures pause physics, invalidate render interpolation after repositioning,
pre-roll particles for two seconds in a stationary frame, and use the same camera on both sides.
UI is hidden for inspection. Before images use the effects/controller from the parent of
`c9b8872a`; final source is restored afterward. Small scenery/sky differences reflect warm-up
and terrain streaming. The live view uses normal input, simulation and the unmodified camera.

## GPU draw cost

Production `GpuTimer` (`EXT_disjoint_timer_query_webgl2`) is instantiated around each effect
object's draw through temporary `onBeforeRender` / `onAfterRender` hooks. The outer whole-frame
query is temporarily disabled because WebGL time-elapsed queries cannot nest. Hooks and the
outer timer are restored in `finally`. Each object gets its own timer; family totals sum object
medians after 30 settling frames, with 119 completed samples per visible draw. No effect draws
means zero. Raw results and hardware/buffer confirmation: [gpu-results.json](gpu-results.json).

| Medium, DPR 2 | Plumes | Particles | Plasma | Condensation |
|---|---:|---:|---:|---:|
| Fixed liftoff | 0.049 ms | 0.059 ms | 0 | 0 |
| Live chase liftoff | 0.059 ms | 0.006 ms | 0 | 0 |
| Transonic ascent | 0.110 ms | 0.041 ms | 0 | 0.004 ms |
| Vacuum upper stage | 0.214 ms | 0 | 0 | 0 |
| Lunar descent | 0.228 ms | 0.009 ms | 0 | 0 |
| Re-entry capsule | 0 | 0 | 0.011 ms | 0 |
| Explosion | 0 | 0.023 ms | 0 | 0 |

The tested liftoff plume + particle total is **0.10–0.11 ms**, below the **1.5 ms** target.
This measures effect draws, not a whole-scene FPS improvement or a guarantee for arbitrary
camera proximity/engine count. Bloom/postprocessing and the existing lit-material light loop
remain part of the full scene. No additional dynamic light was introduced. Initial whole-frame
A/B subtraction was rejected: shared-GPU variation falsely attributed ~0.8 ms to invisible vacuum
particles. Direct draw queries resolve that ambiguity. All final captures had no page/shader errors. The final seven-scene sweep was repeated after merging main.

## Reproduce

Start `npx vite --host 0.0.0.0 --port 5331 --strictPort` in this worktree, then run:

```sh
/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe \
  "$(wslpath -w "$PWD/scripts/vfx-check.mjs")" \
  http://localhost:5331 after 'C:/wsp-tools/shots'
```

An optional fourth argument selects comma-separated scenes, e.g. `reentry,live`.
The script uses the Windows driver installation's Playwright package, creates and closes only
its own isolated context, and writes screenshots plus JSON into the output directory.
Use label `before` for screenshot-only runs. Stop the dev server after verification.

## Limits

Smoke uses procedural billboard shading and a terrain-tangent soft intersection, not scene-depth
soft particles or volumetric self-shadowing. Dust uses a local radial terrain approximation;
it does not collide against individual rocks. RCS visuals approximate nozzle firing from controls
rather than recording every simulation substep. Condensation has no meteorological humidity input.
Heat refraction, optional wingtip vortices and tumbling mesh debris remain future work; existing
simulation stage debris and the pooled hot fragments remain. This pass does not change terrain,
part models, textures or the overall scene lighting pipeline.


## Integration verification

`git merge main` completed (sound/effects imports and both documentation entries retained).
On the resulting code, `npm run lint`, `npm run typecheck`,
`npx vitest run --maxWorkers=3` (**93 files / 1,036 tests**, 163.57 s), and
`npm run build` all pass. Existing large-chunk and ineffective-dynamic-import build advisories
remain. The final seven-scene GPU run was repeated after the merge. Port 5331 and this driver's
browser context were closed. No simulation, terrain LOD or material-program changes were made.
