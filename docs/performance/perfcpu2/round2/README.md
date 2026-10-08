# CPU pass 2, round 2 evidence

See [the report](../../../PERFORMANCE.md) ("Round 2" under CPU pass 2). Host: Windows Chrome CDP 9333,
RTX 3060 Ti / Ryzen 5600X, 1470×920 DPR 2, Medium unless noted, production sourcemapped builds.

| File | Builds | Content |
|---|---|---|
| `r2-steady-4x.json`, `r2-steady-1x.json` | main `49e6b30e`, round 1 `079e0a7b`, final `d8f0b01c` | Final interleaved steady pad/ascent/orbit, 2 reps (`cpu-steady.sh`) |
| `r2-probe-4x.json` | main, round 1 | First profiling probe (1 rep) |
| `r2-wip1-4x.json` … `r2-wip3-4x.json` | intermediate round-2 builds | Development measurements; not final |
| `r2-intermediate-steady-4x-contaminated.json` | main, round 1, intermediate | Rep 1 overlapped the host test suite: **excluded** |
| `imagery-4x-1x.md`, `imagery-ops-r1-first.json` | main, round 1, `0441a5d1` | Imagery streaming pairs (`cpu2-imgops.mjs`, `earthgfx-stalls.mjs`) |
| `autosave-4x.jsonl` | main, round 1, final | Autosave sync call + idle tasks from traces (`cpu2-autosave.mjs`) |

CPU profiles (`.cpuprofile`) from `STEADY_PROFILE=1` stay in `C:\wsp-tools\bench` (not committed); attribute
them with `node scripts/bench/cpu-profile-report.mjs <profile> <sourcemapped dist> [top] [frames]`.
