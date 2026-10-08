# GPU A/B: perfgpu2-sky

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| pad | 3/3 | 2.71 → 2.57 | -5 % | 3.48 → 3.17 | 57.30 → 57.24 | 2.37 → 2.23 | 0.79 → 0.79 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 2292903 → 2292903 |
