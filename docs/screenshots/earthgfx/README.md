# Real Earth from orbit — screenshots and GPU cost (op/earthgfx, 2026-10-07)

All images: Windows Chrome 154 over CDP, RTX 3060 Ti, 1470×920 CSS px at **DPR 2** (2940×1840, the owner's
Retina MacBook case), production builds. "main" = `main` at the time (real ETOPO terrain + graphics settings),
"real Earth" = this branch. Views come from `planet-preview.html` with fixed camera/sun/month (July) so before and
after are the same frame (`scripts/bench/earthgfx/views.json`; Standard scale, Earth radius 637 km).

| View | Medium before → after | Ultra before → after | Low / Medium / High / Ultra | Ultra full size |
|---|---|---|---|---|
| Low orbit, day side (Bahamas, 150 km) | [day-medium](day-medium-before-after.jpg) | [day-ultra](day-ultra-before-after.jpg) | [tiers](day-tiers.jpg) | [day-ultra.jpg](day-ultra.jpg) |
| Ocean sun glint (Pacific, 200 km) | [glint-medium](glint-medium-before-after.jpg) | [glint-ultra](glint-ultra-before-after.jpg) | [tiers](glint-tiers.jpg) | [glint-ultra.jpg](glint-ultra.jpg) |
| Terminator with city lights (Europe at dusk) | [terminator-medium](terminator-medium-before-after.jpg) | [terminator-ultra](terminator-ultra-before-after.jpg) | [tiers](terminator-tiers.jpg) | [terminator-ultra.jpg](terminator-ultra.jpg) |
| Sunrise over the limb | [sunrise-medium](sunrise-medium-before-after.jpg) | [sunrise-ultra](sunrise-ultra-before-after.jpg) | [tiers](sunrise-tiers.jpg) | [sunrise-ultra.jpg](sunrise-ultra.jpg) |
| High orbit, full disc (2,600 km) | [disc-medium](disc-medium-before-after.jpg) | [disc-ultra](disc-ultra-before-after.jpg) | [tiers](disc-tiers.jpg) | [disc-ultra.jpg](disc-ultra.jpg) |
| From lunar distance (2.4° field) | [moon-medium](moon-medium-before-after.jpg) | [moon-ultra](moon-ultra-before-after.jpg) | [tiers](moon-tiers.jpg) | [moon-ultra.jpg](moon-ultra.jpg) |

## GPU cost per tier (DPR 2)

Method: same view loaded alternately from both builds; 30 renders between two `readPixels` fences, median of
5–7 (`scripts/bench/earthgfx-ab.mjs`, `earthgfx-flightfam.mjs`). The real-GPU harness is shared with other agents;
run-to-run noise is about ±0.1 ms on Medium and larger on Low (±0.25 ms at its half resolution). The pipeline's
timer-query A/B (`gpu-ab.sh`) was too contended for sub-0.3 ms claims during this pass (pad on main ranged
5.7–8.8 ms across repetitions) and is kept only as supporting data in `docs/performance/earthgfx/`.

**Medium** (the default; must not cost more than main):

| Scene | main | real Earth | Δ |
|---|---:|---:|---:|
| Flight, Kestrel in low orbit (full-screen Earth) — two pairs | 4.41 / 4.45 | 4.50 / 4.48 | +0.03…+0.09 |
| Flight, on the pad — two pairs | 5.33 / 5.37 | 5.47 / 5.43 | +0.07…+0.14 |
| Flight, 1,500 km orbit (timer A/B, 3 reps) | 2.04 | 2.03 | −0.01 |
| Preview: low orbit day side | 4.03 | 4.13 | +0.10 |
| Preview: ocean glint | 3.88 | 3.67 | −0.21 |
| Preview: terminator / city lights | 4.77 | 4.13 | −0.64 |
| Preview: full disc | 2.45 | 2.53 | +0.08 |

**After merging main's Retina GPU pass** (op/perfgpu: Medium renders the 3D scene below device resolution and
reconstructs), same method, two pairs each:

| Scene | main | real Earth | Δ |
|---|---:|---:|---:|
| Flight, low orbit | 3.17 / 3.03 | 3.12 / 2.98 | −0.05 / −0.05 |
| Flight, pad | 3.86 / 4.56 | 3.96 / 3.73 | +0.10 / −0.83 (noisy) |

The screenshots above were captured before that merge (full-resolution Medium); the imagery is unchanged by it.

Medium is within noise of main in orbit and on the pad, and cheaper on the night side (texture lights replace five
simplex evaluations per land pixel) and over open ocean (faded wave octaves are now skipped instead of multiplied
by zero, and terrain hidden under the opaque ocean is no longer shaded). The imagery fetch itself is ≈ 0.1–0.17 ms
of full-screen terrain on this GPU.

**Other tiers**, flight low orbit, single pairs (same preset on main):

| Tier | main | real Earth | Δ | What the extra buys |
|---|---:|---:|---:|---|
| Low (half resolution) | 1.29–1.79 | 1.36–1.64 | ≈ +0.1 (in-page imagery on/off) | 2k imagery, bilinear, no anisotropy |
| High | 9.48 | 10.81 | +1.3 | 8k pack, bicubic magnification, marched coast reflections, cloud-top relief, weather-coupled glint, 8× aniso |
| Ultra | 13.58 | 14.23 | +0.6 | as High with the 16k pack |

## Loading / stalls / memory

- Imagery decoding runs in the browser's image decoder (`createImageBitmap`, off the main thread) and is cut into
  row strips; GPU uploads and the colour+mask merge run in strips of ≤ 4 MB / 8 Mpx within a 3 ms per-frame budget.
  Instrumented maximum main-thread time spent on imagery in any frame: **5.2 ms** (High, 166 units incl. the 8k
  pack) and **4.7 ms** (Medium). The loading screen waits only for the bundled level; packs stream in afterwards.
- No texture growth across 12 month swaps (Medium 92 → 92, High 94 → 92 textures); scene-cycle leak check clean.
- GPU memory: Low ≈ 11 MB colour+mask (+ lights 11 MB), Medium ≈ 43 + 11 MB, High ≈ 171 + 43 MB, Ultra
  ≈ 683 + 43 MB (16k RGBA with mips; 8k lights). Transient during an Ultra load: + one 8192² tile (256 MB).
