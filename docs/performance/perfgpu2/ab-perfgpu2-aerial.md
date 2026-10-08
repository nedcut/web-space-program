# GPU A/B: perfgpu2-aerial

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| pad | 3/3 | 3.07 → 2.81 | -8 % | 4.02 → 3.27 | 43.38 → 55.69 | 2.85 → 2.38 | 0.79 → 0.79 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 2292903 → 2292903 |
