# GPU A/B: low

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| ascent | 1/2 | 0.59 → 1.32 | 125 % | 0.70 → 1.61 | 60.02 → 59.91 | 0.72 → 0.65 | 0.02 → 0.08 | 735×460 / 0.5 → 1470×920 / 0.5 | 146119 → 146120 |
| editor | 2/2 | 1.28 → 1.51 | 18 % | – → – | 59.00 → 59.36 | – → – | 0.00 → 0.00 | 735×460 / 0.5 → 735×460 / 0.5 | NaN → NaN |
| map | 2/2 | 0.41 → 0.40 | -2 % | 0.58 → 0.50 | 42.05 → 40.31 | – → – | 0.00 → 0.00 | 2940×1840 / 2 → 2940×1840 / 2 | 50056 → 50056 |
| moon | 2/2 | 0.75 → 0.73 | -2 % | 0.71 → 0.86 | 60.15 → 58.28 | 0.87 → 0.80 | 0.03 → 0.09 | 735×460 / 0.5 → 1470×920 / 0.5 | 111878 → 111879 |
| orbit | 2/2 | 0.92 → 0.84 | -8 % | 1.10 → 0.86 | 60.14 → 59.69 | 0.79 → 0.71 | 0.03 → 0.07 | 735×460 / 0.5 → 1470×920 / 0.5 | 161879 → 161880 |
| pad | 2/2 | 0.63 → 0.89 | 42 % | 1.48 → 1.63 | 60.26 → 59.93 | 1.03 → 1.04 | 0.03 → 0.11 | 735×460 / 0.5 → 1470×920 / 0.5 | 545818 → 360147 |
