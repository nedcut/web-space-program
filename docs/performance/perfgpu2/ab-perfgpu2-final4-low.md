# GPU A/B: perfgpu2-final4-low

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| ascent | 3/3 | 0.52 → 0.51 | -1 % | 0.68 → 0.80 | 60.13 → 60.04 | 0.57 → 0.73 | 0.03 → 0.03 | 735×460 / 0.5 → 735×460 / 0.5 | 148775 → 148775 |
| map | 3/3 | 0.33 → 0.33 | -1 % | 0.41 → 0.42 | 60.16 → 60.20 | – → – | 0.00 → 0.00 | 2940×1840 / 2 → 2940×1840 / 2 | 50056 → 50056 |
| moon | 3/3 | 0.49 → 0.50 | 3 % | 0.50 → 0.47 | 60.13 → 60.12 | 0.39 → 0.39 | 0.02 → 0.02 | 735×460 / 0.5 → 735×460 / 0.5 | 105158 → 105158 |
| orbit | 3/3 | 0.51 → 0.50 | -2 % | 0.50 → 0.46 | 60.09 → 60.14 | 0.47 → 0.38 | 0.02 → 0.02 | 735×460 / 0.5 → 735×460 / 0.5 | 171287 → 171287 |
| pad | 3/3 | 0.58 → 0.56 | -3 % | 0.80 → 0.78 | 60.06 → 60.04 | 0.63 → 0.65 | 0.03 → 0.03 | 735×460 / 0.5 → 735×460 / 0.5 | 360146 → 360146 |
