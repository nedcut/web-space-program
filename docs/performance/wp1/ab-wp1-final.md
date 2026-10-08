# GPU A/B: wp1-final

Interleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.

| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| ascent | 1/1 | 2.02 → 2.05 | 2 % | 3.04 → 2.86 | 35.64 → 35.87 | 1.86 → 1.89 | 0.59 → 0.59 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 1103590 → 1103590 |
| orbit | 1/1 | 2.06 → 2.03 | -2 % | 2.59 → 2.72 | 59.39 → 58.44 | 2.10 → 1.85 | 0.66 → 0.66 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 1051622 → 1051622 |
| pad | 1/1 | 2.43 → 2.45 | 1 % | 3.33 → 2.98 | 58.91 → 53.72 | 2.34 → 2.14 | 0.79 → 0.80 | 2940×1840 / 1.4 → 2940×1840 / 1.4 | 2261765 → 2261765 |
