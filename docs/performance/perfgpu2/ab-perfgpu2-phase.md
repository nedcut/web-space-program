# GPU A/B: perfgpu2-phase

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| pad | 3/3 | 2.49 → 2.50 | 0 % | 3.61 → 3.56 | 60.21 → 59.95 | 2.83 → 2.79 | 0.79 → 0.79 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 2290653 → 2290653 |
