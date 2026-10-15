<img src="public/icon.svg" width="64" height="64" alt="">

# Web Space Program

An original browser spaceflight sandbox set in the solar system: build vehicles,
fly missions, explore worlds, and grow a science or career program.

## How to play

**Public URL:** pending Cloudflare setup. [Owner go-live steps](docs/DEPLOY.md).

For local play, install Node 24.14.1 (see `.nvmrc`), then:

```sh
npm ci
npm run play
```

The production game opens in your browser. Start with Training, a quick-start
mission, or New Program → Sandbox. F1 opens controls. `npm run dev` starts the
live development server. Saves stay in this browser; export saves before changing
devices or browser profiles.

[Current progress and known gaps](PROGRESS.md) · [Architecture](ARCHITECTURE.md) ·
[Performance](docs/PERFORMANCE.md) · [Balance](docs/BALANCE.md)

## Checks and hosting

Every push and pull request runs lint, type checking, tests and a production build.
Main builds deploy to Cloudflare Pages when the owner supplies both secrets;
otherwise deployment skips. See [deployment instructions](docs/DEPLOY.md).

Serve `dist/` over HTTPS with its `_headers` file: COOP/COEP lets terrain workers
share Earth data. Content-hashed assets cache immutably; entry HTML and the service
worker revalidate. The optional 16k Earth pack is omitted from hosted builds;
Ultra falls back to packaged imagery. Experimental multiplayer needs a separate
WebSocket server.

Created in [T3 Code](https://t3.codes).
