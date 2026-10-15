<img src="assets/icon.svg" width="64" height="64" alt="">

# web-space-program

Created in [T3 Code](https://t3.codes).

## Hosting

Serve `dist/` with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
over HTTPS (`public/_headers` does this on Netlify/Cloudflare Pages). Without them the game still runs, but each
terrain worker keeps its own 22 MiB copy of the Earth height grids. See ARCHITECTURE.md, "Real Earth data initialization".
