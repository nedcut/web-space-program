# GPU A/B: perfgpu2-batch

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| moon | 3/3 | 1.49 → 1.26 | -15 % | 2.65 → 2.39 | 59.95 → 60.19 | 1.73 → 1.38 | 0.89 → 0.89 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 631561 → 631561 |
| orbit | 3/3 | 2.02 → 2.02 | -0 % | 2.94 → 3.01 | 59.45 → 60.17 | 2.39 → 2.01 | 0.67 → 0.67 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 743766 → 743766 |
| pad | 3/3 | 2.67 → 2.48 | -7 % | 3.34 → 3.50 | 59.18 → 59.96 | 2.44 → 2.76 | 0.79 → 0.79 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 2290653 → 2290653 |
