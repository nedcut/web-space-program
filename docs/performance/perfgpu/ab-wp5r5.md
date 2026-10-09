# GPU A/B: wp5r5

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| moonLow | 3/3 | 1.61 → 1.69 | 5 % | 1.92 → 2.04 | 60.18 → 60.22 | 0.92 → 1.04 | 1.00 → 1.01 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 1330021 → 1379749 |
| orbit | 3/3 | 2.06 → 2.03 | -1 % | 2.42 → 2.39 | 60.18 → 60.18 | 1.77 → 1.74 | 0.65 → 0.64 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 1025510 → 1002881 |
| pad | 3/3 | 2.43 → 2.45 | 1 % | 2.86 → 2.88 | 60.19 → 60.16 | 2.07 → 2.05 | 0.79 → 0.83 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 2261765 → 2263631 |
