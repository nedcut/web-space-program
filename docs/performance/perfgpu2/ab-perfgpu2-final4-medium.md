# GPU A/B: perfgpu2-final4-medium

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| ascent | 3/3 | 2.33 → 2.15 | -8 % | 3.44 → 3.13 | 59.14 → 60.12 | 2.62 → 2.58 | 0.65 → 0.65 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 872646 → 872646 |
| map | 3/3 | 0.33 → 0.33 | -1 % | 0.40 → 0.41 | 60.16 → 60.22 | – → – | 0.00 → 0.00 | 2940×1840 / 2 → 2940×1840 / 2 | 50056 → 50056 |
| moon | 3/3 | 1.39 → 1.26 | -10 % | 2.40 → 2.33 | 59.81 → 60.20 | 1.69 → 1.39 | 0.89 → 0.89 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 631561 → 631561 |
| orbit | 3/3 | 2.38 → 2.04 | -14 % | 3.58 → 2.91 | 59.69 → 60.17 | 2.84 → 2.07 | 0.67 → 0.67 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 743766 → 743766 |
| pad | 3/3 | 2.79 → 2.51 | -10 % | 3.40 → 3.58 | 59.22 → 59.98 | 2.53 → 2.81 | 0.79 → 0.79 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 2290653 → 2290653 |
