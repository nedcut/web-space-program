# GPU A/B: high

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| ascent | 2/2 | 7.73 → 5.20 | -33 % | 9.37 → 7.11 | 25.06 → 25.10 | 6.25 → 5.66 | 1.90 → 0.77 | 2940×1840 / 2 → 2940×1840 / 1.7 | 1482726 → 1482726 |
| editor | 2/2 | 1.89 → 2.10 | 11 % | – → – | 44.33 → 45.63 | – → – | 0.00 → 0.00 | 2940×1840 / 2 → 2940×1840 / 2 | NaN → NaN |
| map | 2/2 | 0.45 → 0.47 | 6 % | 0.72 → 0.56 | 44.20 → 48.42 | – → – | 0.00 → 0.00 | 2940×1840 / 2 → 2940×1840 / 2 | 50056 → 50056 |
| moon | 2/2 | 4.98 → 4.17 | -16 % | 6.06 → 4.84 | 30.43 → 31.80 | 3.81 → 3.85 | 2.11 → 1.09 | 2940×1840 / 2 → 2940×1840 / 1.7 | 1373449 → 1309705 |
| orbit | 2/2 | 8.09 → 5.60 | -31 % | 8.89 → 5.85 | 30.01 → 32.18 | 6.82 → 4.98 | 2.12 → 0.73 | 2940×1840 / 2 → 2940×1840 / 1.7 | 1412694 → 1412694 |
| pad | 2/2 | 11.86 → 8.65 | -27 % | 13.44 → 9.78 | 23.56 → 26.93 | 10.61 → 8.08 | 1.97 → 0.89 | 2940×1840 / 2 → 2940×1840 / 1.7 | 7177309 → 5985783 |
