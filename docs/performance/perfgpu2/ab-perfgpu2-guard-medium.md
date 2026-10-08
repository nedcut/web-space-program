# GPU A/B: perfgpu2-guard-medium

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| pad | 3/3 | 2.80 → 2.53 | -10 % | 3.44 → 3.67 | 59.20 → 59.72 | 2.48 → 2.81 | 0.79 → 0.79 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 2290653 → 2290653 |
