# GPU A/B: medium

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| ascent | 3/3 | 3.56 → 2.03 | -43 % | 4.35 → 3.12 | 30.97 → 30.01 | 3.22 → 2.06 | 1.01 → 0.63 | 2940×1840 / 2 → 2940×1840 / 1.4 | 748262 → 748262 |
| editor | 3/3 | 1.30 → 1.23 | -5 % | – → – | 49.20 → 47.72 | – → – | 0.00 → 0.00 | 2940×1840 / 2 → 2940×1840 / 2 | NaN → NaN |
| map | 3/3 | 0.40 → 0.39 | -4 % | 0.67 → 0.65 | 39.12 → 39.95 | – → – | 0.00 → 0.00 | 2940×1840 / 2 → 2940×1840 / 2 | 50056 → 50056 |
| moon | 3/3 | 1.72 → 1.57 | -8 % | 2.45 → 2.39 | 34.21 → 32.15 | 1.41 → 1.27 | 1.00 → 0.91 | 2940×1840 / 2 → 2940×1840 / 1.4 | 645385 → 645385 |
| orbit | 3/3 | 3.92 → 2.26 | -42 % | 4.63 → 2.85 | 32.59 → 31.49 | 3.50 → 1.98 | 1.00 → 0.65 | 2940×1840 / 2 → 2940×1840 / 1.4 | 679254 → 679254 |
| pad | 3/3 | 4.51 → 2.77 | -39 % | 5.50 → 3.77 | 29.45 → 27.99 | 4.13 → 2.80 | 1.05 → 0.79 | 2940×1840 / 2 → 2940×1840 / 1.4 | 3484429 → 2292903 |
