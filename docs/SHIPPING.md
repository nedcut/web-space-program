# Shipping verification — 2026-10-15

Scope: `op/ship`, built from `b6396abc` plus shipping configuration changes.
No production deployment, account/token creation or secret changes were performed.
The [owner setup](DEPLOY.md) remains required. GitHub run results are reported in the
implementation handoff; [branch workflow runs](https://github.com/nedcut/web-space-program/actions?query=branch%3Aop%2Fship)
provide the live status for each pushed commit.

## Production artifact

`npm run build` succeeds using Node 24.14.1. `node scripts/check-pages-build.mjs`
checks every file in the finished output (also required by CI).

- 149 files, approximately 71 MiB total on disk; limit 20,000 files.
- Largest files, against the 25 MiB per-file limit:

  | File | MiB |
  | --- | ---: |
  | `earth/height.i16` | 16.00 |
  | `earth/height-cape.i16` | 6.12 |
  | `earth/imagery/packs/8k/clouds-8k.webp` | 4.37 |
  | `earth/imagery/packs/gulf-v2/night.webp` | 2.69 |
  | `earth/cover.u4` | 1.98 |
  | `earth/imagery/base/clouds-4k.webp` | 1.93 |
  | `earth/imagery/packs/8k/day-8k-12.webp` | 1.79 |
  | `earth/imagery/packs/8k/day-8k-01.webp` | 1.74 |
  | `earth/imagery/packs/8k/day-8k-11.webp` | 1.74 |
  | `earth/imagery/packs/8k/day-8k-02.webp` | 1.72 |

The generated imagery manifest lists `2k`, `4k`, `8k`. No 16k tiles exist in this
checkout. The manifest's final MD5 matches its Workbox precache revision, proving
the build filter runs before service-worker hashing. The original public manifest
is unchanged; a local complete 16k pack can still be included by the same build.

## Actual Pages hosting behaviour

Served the build with Wrangler 4.151.0 `pages dev dist --port 5821 --ip 0.0.0.0`.
Wrangler parsed seven header rules. HTTP probes confirmed:

- `/` and `/sw.js`: `Cache-Control: no-cache`.
- A real hashed JS asset: `public, max-age=31536000, immutable`.
- HTML, JS and missing responses carry COOP `same-origin` and COEP `require-corp`.
- Unknown paths and missing `.js` assets return HTTP 404 rather than the game HTML.

Chrome on Windows, RTX 3060 Ti, via the shared GPU lock, used
`http://localhost:5821` (secure-context exception for localhost). Each route reached
the real flight-ready mark and a visible rendered scene, with
`crossOriginIsolated === true`, `isSecureContext === true` and a controlling SW:

- `?flight=stock-kestrel`: 12.9 s to ready.
- `?flight=stock-kestrel&scenario=orbit`: 10.9 s.
- `?mission=moon-return`: 12.3 s.

These are smoke-check timings on a shared machine, not performance comparisons.
Medium graphics with custom Ultra texture quality fetched the 8k pack and Gulf
imagery. Across these routes: zero JavaScript errors, zero cross-origin requests,
zero missing asset responses and zero `/packs/16k/` requests. After SW installation,
`/does-not-exist` still displayed the real 404 page (the single expected 404).
Static source inspection found external NASA reading links, not runtime external
fonts, CDN scripts or imagery dependencies.

Local screenshots: `C:\wsp-tools\shots\ship\{flight,scenario,mission}.png`.
Machine-readable request/error evidence: `C:\wsp-tools\shots\ship\results.json`.
Browser drivers: `C:\wsp-tools\drv\ship.mjs`, `ship-update.mjs`.
These machine-local artifacts are deliberately outside git.

## Documentation integrity and limits

`docs/progress/2026-10-archive.md` preserves all 1,288 original PROGRESS.md lines
verbatim; original/archive SHA-256:
`e9919b8358727d8cbdf32ea803bc0cfc9a18d82e1333497f92142ca5c236d793`.
The new report is 104 lines. The complete `vitest run --maxWorkers=2` passed
2,000 tests with one skipped across 214 files in 616.88 seconds on the shared local
machine. `vitest list` reports fewer entries because parameterized cases expand
during execution. Lint, `tsc --noEmit`, the production build and the Pages size
check also passed. Exported catalog counts are 44 stock entries
(32 Standard, 5 Challenging, 7 Real), 173 parts, 61 bodies.

The exact workflow configuration gate was exercised locally with neither secret,
one secret, and both dummy secrets: all exited zero; only both enabled deployment.
The extra PWA cross-deployment lifecycle probe could not acquire the shared GPU
lock in two bounded attempts; the existing update code is unchanged.

Unverified: cross-deployment PWA update/reload behaviour,
Cloudflare production HTTPS/edge caching and credential-enabled deploy,
main artifact upload/secret-absent deploy skip on a real main push, custom domains,
Mac/Zen/Safari performance and multiplayer hosting. PR previews are deferred.
