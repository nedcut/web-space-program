# GPU pass 2 evidence

All real-GPU runs use production builds, Windows Chrome via CDP 9333, and
`flock /tmp/wsp-gpu.lock`. Baseline is an immutable build of main at
`49e6b30ed46444906fd98d63fe8cc205d50cd9fd`.

Viewport: 1470×920 CSS, DPR 2. Flight output is 2940×1840 on Medium/High/Ultra;
Low retains its inexpensive 735×460 canvas. Medium renders at ratio 1.4 and
High at 1.7 before upscaling; Ultra renders at 2.0. Map has a separate path.
Presets keep their original
internal render ratios, geometry, imagery, shadows, clouds and post-processing.
Adaptive quality is disabled. Medium/High settle on 8k Earth imagery; Ultra
falls back to the available 8k pack. Each fenced result is the median of five
20-render batches measured with `EXT_disjoint_timer_query_webgl2`, with
`readPixels` fences at the boundaries. It includes draw-submission gaps inside
the batch, so batching can improve the timer as well as the CPU wall time.
Loop pacing is a separate metric affected by compositor/vsync and the shared
host; it is not an Apple hardware result.

Experiments are deliberately preserved, including unfavorable results:

- `ab-perfgpu2-aerial`: main versus adaptive aerial integration only, pad,
  three interleaved pairs. Each pair improves. The original wrapper split
  multiword `--pre` expressions, so these stationary pad runs were not paused.
  The wrapper now preserves argument boundaries.
- `ab-perfgpu2-combined`: aerial plus experimental terrain/ocean/cloud math,
  pad, three pairs. Aggregate median worsened; the additional shader math was
  **rejected**. The script was edited while this old run was active and exited
  after recording its final pair; its summary was regenerated from all six
  intact JSON results.
- `ab-perfgpu2-sky`: add conservative Earth sky occlusion to the experimental
  shader build, pad. The original wrapper also left these stationary pad runs
  unpaused. Three pairs have a 2.71→2.57 ms median (one unfavorable pair is
  retained). This measures the incremental sky change, not the final candidate.
  Its old running wrapper also exited after writing the complete final pair;
  the report was regenerated from all six intact results.
- `ab-perfgpu2-batch`: add terrain/ocean batches to the sky experiment build.
  Both sides share the same shaders. Flight is paused for measurement. This
  isolates the batch change; rejected shader math is removed from the final
  candidate.
- `ab-perfgpu2-guard-medium`: main versus aerial/sky/batches with the distant
  sky safeguard, three pad pairs. 2.80→2.53 ms: the pad still missed the target.
- `ab-perfgpu2-fetch`: share terrain colour/coverage and slope texture reads,
  retaining the original cyclic accumulation order. Three pad pairs show
  aggregate parity (2.529→2.527 ms), median paired delta −0.016 ms. No robust
  standalone RTX win is claimed for this compiler hint.
- `ab-perfgpu2-cloud`: skip Medium detail noise on exactly zero baked coverage,
  after evaluating derivatives. Three pad pairs all improve; median
  2.530→2.493 ms. Other presets compile out this shortcut.
- `ab-perfgpu2-phase`: positive phase-function `pow(x, 1.5)` versus
  `x * sqrt(x)`, with the same scattering model. Three pad pairs measure
  2.494→2.496 ms, median paired delta +0.002 ms: parity, not a claimed RTX win.
- `ab-perfgpu2-final4-*`: main versus the retained implementation, three
  interleaved A→B pairs per scene/preset. Flight is paused and the selected
  imagery pack is ready before measurement. `sceneState` records
  terrain, imagery and simulation time; errors and GL status remain in JSON.

Earlier `final`, `final2` and `final3` runs were superseded while still incomplete;
their partial samples are not the final acceptance matrix. One own Ultra sample
was interrupted during the rebuild and excluded; a locked cleanup found no
orphan benchmark pages. Other agents' pages/processes were left alone.

The baseline and experimental family profiles retain raw subtraction results.
Negative deltas are noise/interactions, not negative material cost. Final
conclusions use paired whole-frame measurements, not sums of those deltas.

Screenshots are under `../../screenshots/perfgpu2/`: main on the left, final
candidate on the right, both at normal Retina viewing size; the corresponding
`crop-1to1` files retain device-pixel detail. Different simulation timestamps,
ascent trajectory/camera and animated cloud/plume positions must be considered
when comparing them. The original device-resolution captures remain in the
Windows harness's `C:\wsp-tools\shots\perfgpu` directory.

`validation.txt` records the successful final check commands and output excerpts.
`summary.json` records exact three-pair medians, individual samples, paired deltas
and idle-run counts. All 120 runs are paused/error-free; 102 are terrain-idle.
Ultra pad/orbit/map retain four in-flight builds on both sides (selected geometry
and rendered triangle counts match), so those cells are streaming workloads.
Ultra ascent median triangles vary by ~0.28%; this limitation is preserved.

The final `dist/` and the immutable candidate served on 5341 have identical
content hashes: `c8713baecca603ea35ba142d526899451aa0dc476eb5e580435783f623b89b44`
(SHA-256 over sorted relative file names and bytes, 124 files). Baseline was
served on 5340. Ports 5342–5349 held isolated experiments and are stopped.

Reproduce a final preset comparison after serving the pinned main build and
candidate on 5340 and 5341 respectively (the wrapper locks every A/B pair):

```bash
AB_OUT=docs/performance/perfgpu2 scripts/bench/gpu-passes-ab.sh rerun-medium \
  http://<WSL-IP>:5340 http://<WSL-IP>:5341 pad,ascent,orbit,map,moon 3 \
  --quality medium --settle 3000 \
  --pre '(async()=>{window.__flight.paused=true;const roots=[];window.__flight.scene.traverse(o=>{if(o.userData.imagery)roots.push(o.userData.imagery)});for(let i=0;i<300&&roots.some(p=>!p.ready);i++)await new Promise(r=>setTimeout(r,100))})()'
```

Repeat for Low/High/Ultra with a distinct name and `--quality`; Low can use
`--pre 'window.__flight.paused=true'` because it uses the inexpensive imagery path.
Run standalone diagnostic scripts under `flock /tmp/wsp-gpu.lock` as well.
