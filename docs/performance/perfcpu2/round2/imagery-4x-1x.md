# Imagery streaming pairs (round 2)

High, Kestrel, `devScenario('orbit')`, Windows Chrome CDP, 1470×920 DPR 2. Builds: main `49e6b30e` (5350),
round 1 `079e0a7b` (5351), round-2 imagery budget `0441a5d1` (5352). Driver: `scripts/bench/cpu2-imgops.mjs`
(4×) and `earthgfx-stalls.mjs` (1×, 30 s after ready). Interleaved; single Chrome lock per run.

## 4× CPU throttle (`cpu2-imgops.mjs`)

| Build | Imagery ops | Op p50 / p95 / max (ms) | Op total (ms) | Stream span (s) | Worst `step()` (ms) | Long tasks > 50 ms (whole run) |
|---|---:|---|---:|---:|---:|---:|
| main | 164 | 3.6 / 4.2 / 4.7 | 567 | 10.0 | 7.7 | 210 |
| round 1 | 655 | 0.9 / 1.6 / 3.1 | 636 | 34.8 | 5.3 | 533 |
| round 2 (run 1) | 655 | 0.8 / 1.5 / 2.4 | 584 | 13.3 | 6.5 | 100 |
| round 2 (run 2) | 655 | 0.8 / 1.5 / 1.8 | 584 | 12.7 | 6.1 | 94 |
| round 2 + heavy-unit rule | 655 | 0.8 / 1.5 / 2.6 | 583 | 13.5 | 6.0 | 86 |

## Unthrottled (`earthgfx-stalls.mjs high 30 2`), three interleaved repetitions

| Build | Worst imagery `step()` (ms) | Long tasks after ready | Frames > 33 ms |
|---|---|---|---|
| main | 15.8 / 5.2 / 5.2 | 0 / 0 / 0 | 84 / 75 / 73 |
| round 1 | 2.5 / 2.0 / 1.5 | 0 / 0 / 0 | 82 / 92 / 84 |
| round 2 | 3.8 / 2.7 / 3.2 | 0 / 0 / 0 | 58 / 68 / 71 |

All runs reached 8k. The earlier round-1 57.5 ms cumulative maximum did not reproduce in any of these runs;
the >40 ms operations seen at load were part-texture allocations (decal atlas), not imagery.
