# GPU A/B: perfgpu2-final4-ultra

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| ascent | 3/3 | 14.44 → 14.11 | -2 % | 14.41 → 13.66 | 33.77 → 36.98 | 13.49 → 12.84 | 0.75 → 0.74 | 2940×1840 / 2 → 2940×1840 / 2 | 10642085 → 10612133 |
| map | 3/3 | 0.33 → 0.32 | -1 % | 0.41 → 0.41 | 60.18 → 60.19 | – → – | 0.00 → 0.00 | 2940×1840 / 2 → 2940×1840 / 2 | 50056 → 50056 |
| moon | 3/3 | 4.98 → 4.75 | -5 % | 6.21 → 5.16 | 46.32 → 51.93 | 5.29 → 4.45 | 0.85 → 0.79 | 2940×1840 / 2 → 2940×1840 / 2 | 6095624 → 6095624 |
| orbit | 3/3 | 10.18 → 9.76 | -4 % | 9.77 → 9.34 | 40.93 → 44.38 | 8.99 → 8.52 | 0.72 → 0.73 | 2940×1840 / 2 → 2940×1840 / 2 | 4345813 → 4345813 |
| pad | 3/3 | 14.17 → 13.07 | -8 % | 13.64 → 12.82 | 32.40 → 37.14 | 12.71 → 12.02 | 0.76 → 0.76 | 2940×1840 / 2 → 2940×1840 / 2 | 14855766 → 14855766 |
