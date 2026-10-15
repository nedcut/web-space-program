# Publish Web Space Program

GitHub Actions checks every push and pull request using Node 24.14.1. On a push to
`main`, it uploads the checked `dist/` artifact, then deploys that same artifact to
Cloudflare Pages. Missing either Cloudflare secret skips deployment successfully.
No Cloudflare credentials are needed to run CI. Branch pushes and pull requests
never deploy. PR previews are deferred to keep credentials out of PR execution.

## One-time owner setup

1. In Cloudflare, select the account that will own the game. Copy its Account ID
   from the dashboard. Create a **Pages** project using **Direct Upload**, named
   exactly `web-space-program`, with production branch `main`. Alternatively, after
   authenticating locally with `npx wrangler login`, run:
   `npx wrangler pages project create web-space-program --production-branch=main`.
   Choose Direct Upload rather than Git integration: GitHub Actions builds the site.
2. Under **My Profile → API Tokens → Create Custom Token**, grant account permission
   **Cloudflare Pages: Edit**, limited to that account. No zone permissions are needed.
3. From this repository, set the two GitHub Actions repository secrets interactively:

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```

   Paste the token into the first prompt and the Account ID into the second. Do not
   commit credentials. These commands change repository secrets and are owner steps.
4. Merge the shipping branch after review. The next push to `main` runs CI and deploys.
   If the branch was already merged before setup, use the Actions **Re-run all jobs**
   control on its successful main push run after setting the secrets.
5. Open the URL printed by Wrangler in the deploy job (normally
   `https://web-space-program.pages.dev`, subject to availability). Confirm the menu
   and a stock flight load, then replace the public URL placeholder in README.md and
   PROGRESS.md. Optionally add a custom domain in Pages → Custom domains.

No account, project, token, secrets or production deployment is created by the
shipping implementation itself.

## Hosting contract

- Deploy the contents of `dist/`, including `_headers` and `404.html`.
- HTTPS and the COOP/COEP headers make `crossOriginIsolated` true, allowing terrain
  workers to share the Earth grid. Runtime imagery, fonts, scripts and workers are
  served from the same origin. NASA links are reading links, not runtime downloads.
- Hashed `/assets/*` files are immutable for one year. Entry HTML, the service worker,
  and its registration script revalidate; unversioned Earth data/imagery revalidate.
  The PWA auto-update and stale-build reload path remain enabled.
- The hosted build omits the optional, gitignored 16k Earth imagery pack. Ultra uses
  the highest available imagery level; the rest of its quality settings still apply.
- Query routes (`?flight=stock-kestrel`, `?flight=stock-kestrel&scenario=orbit`, `?mission=moon-return`)
  use the root HTML. Unknown paths return a small real 404 page with a link home;
  missing assets must not return the app's HTML.
- Experimental multiplayer still requires a separately hosted WebSocket server.
  Pages serves the single-player application only.

Cloudflare's [Direct Upload limits](https://developers.cloudflare.com/pages/get-started/direct-upload/)
are 20,000 files and 25 MiB per file. CI checks the finished build against both.
For local hosting verification use `npx wrangler pages dev dist --port 5821`.
See the shipping evidence report for the measured build and browser checks.
