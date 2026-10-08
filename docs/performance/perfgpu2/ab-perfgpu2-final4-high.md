# GPU A/B: perfgpu2-final4-high

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| ascent | 3/3 | 5.87 → 5.72 | -3 % | 6.36 → 5.58 | 49.05 → 57.99 | 5.48 → 4.76 | 0.74 → 0.73 | 2940×1840 / 1.7 → 2940×1840 / 1.7 | 1805254 → 1805254 |
| map | 3/3 | 0.33 → 0.33 | -1 % | 0.40 → 0.43 | 60.16 → 60.24 | – → – | 0.00 → 0.00 | 2940×1840 / 2 → 2940×1840 / 2 | 50056 → 50056 |
| moon | 3/3 | 2.58 → 2.44 | -6 % | 3.67 → 3.60 | 58.91 → 59.63 | 2.50 → 2.49 | 1.07 → 1.07 | 2940×1840 / 1.7 → 2940×1840 / 1.7 | 1256713 → 1256713 |
| orbit | 3/3 | 5.32 → 4.98 | -6 % | 5.26 → 4.92 | 55.08 → 59.08 | 4.41 → 4.32 | 0.75 → 0.75 | 2940×1840 / 1.7 → 2940×1840 / 1.7 | 1410390 → 1410390 |
| pad | 3/3 | 7.07 → 6.31 | -11 % | 8.27 → 6.29 | 42.34 → 52.87 | 7.17 → 5.38 | 0.87 → 0.84 | 2940×1840 / 1.7 → 2940×1840 / 1.7 | 5981175 → 5981175 |
