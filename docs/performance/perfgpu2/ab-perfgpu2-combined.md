# GPU A/B: perfgpu2-combined

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| pad | 3/3 | 2.82 → 3.16 | 12 % | 3.41 → 3.92 | 56.95 → 46.86 | 2.41 → 2.72 | 0.79 → 0.79 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 2292903 → 2292903 |
