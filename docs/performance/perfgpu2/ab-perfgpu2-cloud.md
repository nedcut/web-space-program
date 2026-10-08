# GPU A/B: perfgpu2-cloud

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| pad | 3/3 | 2.53 → 2.49 | -1 % | 3.54 → 3.49 | 59.95 → 59.96 | 2.81 → 2.79 | 0.79 → 0.79 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 2290653 → 2290653 |
