import http from 'node:http';
import path from 'node:path';
import { appendFile, writeFile, unlink, access } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { browserSetup } from './browser.mjs';
import { seconds } from './protocol.mjs';

const dir = process.argv[2];
let browser, vite, server, closing = false;
async function close() {
  if (closing) return; closing = true;
  await browser?.close(); await vite?.close();
  server?.close(); await unlink(path.join(dir, 'control.sock')).catch(() => {});
  await unlink(path.join(dir, 'ready')).catch(() => {});
}
process.on('SIGTERM', () => { void close(); });
process.on('SIGINT', () => { void close(); });
try {
  await access('dist/index.html');
  vite = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  const port = vite.httpServer.address().port;
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.setDefaultTimeout(3000);
  const errors = [];
  await page.exposeFunction('__playtestReport', message => errors.push(message));
  page.on('pageerror', e => errors.push(e.stack ?? e.message));
  page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /WebGL.*(?:error|warning|lost)|context lost|GL_INVALID|INVALID_(?:OPERATION|ENUM|VALUE|FRAMEBUFFER)|GL ERROR|Audio disabled after an error/i.test(m.text()))) errors.push(m.text()); });
  await page.addInitScript(browserSetup);
  const epoch = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(epoch);
  await page.goto(`http://127.0.0.1:${port}/`);
  // Loading needs animation frames and asynchronous worker/network completions. Pump only
  // while the loading overlay exists; once ready, all time is command-controlled.
  async function settle() {
    const end = Date.now() + 120000;
    do {
      await new Promise(resolve => setTimeout(resolve, 20));
      if (!await page.locator('.loading-screen').count()) return;
      await page.clock.runFor(32);
    } while (Date.now() < end);
    throw new Error('Loading did not finish in 120 seconds');
  }
  await settle();
  let step = 0;
  const refs = new Map();
  async function state() {
    return page.evaluate(() => {
      const c = window.__flight;
      const scene = c ? (c.mapMode ? 'map' : 'flight') : window.__editor ? 'editor' : document.querySelector('.hub-composition') ? 'spaceCenter' : 'menu/hub';
      if (!c) return { scene, gameTime: null };
      const v = c.world.active;
      if (!v) return { scene, gameTime: c.world.ut, vessel: 'lost' };
      const t = c.telemetry(v);
      return { scene, gameTime: c.world.ut, situation: v.mode === 'prelaunch' ? 'prelaunch' : v.state.situation, body: t.bodyName,
        altitude: t.altitudeAsl, altitudeAGL: t.altitudeTerrain, verticalSpeed: t.verticalSpeed,
        surfaceSpeed: Math.hypot(...Object.values(c.world.surfaceVelocity(v))),
        orbitalSpeed: Math.hypot(...Object.values(c.world.relativeState(v).velocity)),
        apoapsis: t.apoapsis, periapsis: t.periapsis, throttle: t.throttle, stage: t.stage,
        fuel: t.resources, deltaV: t.totalDvVac, sas: [t.sasOn, t.sasMode], rcs: t.rcsOn,
        warp: t.warpLabel, crew: t.crew.map(({ name, radiationDose }) => ({ name, status: t.eva ? 'EVA' : 'aboard', radiationDose: radiationDose ?? 0 })), messages: t.messages };
    });
  }
  // Compact, rounded summary for the agent; actions.jsonl keeps the full-precision state.
  function brief(s) {
    if (s.gameTime === null) return `Scene: ${s.scene}`;
    if (s.vessel === 'lost') return `Scene: ${s.scene} | UT ${s.gameTime.toFixed(1)} s | no active vessel`;
    const d = m => Math.abs(m) < 10000 ? `${m.toFixed(1)} m` : `${(m / 1000).toFixed(1)} km`;
    const v = m => `${m.toFixed(1)} m/s`;
    return [`Scene: ${s.scene} | UT ${s.gameTime.toFixed(1)} s | ${s.body}, ${s.situation}`,
      `Altitude ${d(s.altitude)} (above terrain ${d(s.altitudeAGL)}) | vertical ${v(s.verticalSpeed)}, surface ${v(s.surfaceSpeed)}, orbital ${v(s.orbitalSpeed)}`,
      `Apoapsis ${d(s.apoapsis)}, periapsis ${d(s.periapsis)} | throttle ${Math.round(s.throttle * 100)}%, stage ${s.stage}, Δv ${Math.round(s.deltaV ?? 0)} m/s`,
      `SAS ${s.sas[0] ? s.sas[1] : 'off'}, RCS ${s.rcs ? 'on' : 'off'}, warp ${s.warp}`,
      `Resources: ${s.fuel.map(r => `${r.name} ${Math.round(r.amount)}/${Math.round(r.max)}`).join(', ')}`,
      `Crew: ${s.crew.map(c => `${c.name} (${c.status})`).join(', ') || 'none'}`,
      ...(s.messages.length ? [`Messages: ${s.messages.map(m => m.text).join(' | ')}`] : [])].join('\n');
  }
  // A person takes a moment after each click or key tap; let the UI react (transitions, timers)
  // without the agent needing a separate wait. Logged as game time like any other.
  // Lazy UI chunks load in wall time and then need frames to render, so advance in 50 ms
  // slices with short real pauses until the DOM structure stops changing (0.25 s min, 1 s max).
  async function react() {
    let ms = 0, quiet = 0, last = -1;
    while (ms < 1500 && (ms < 250 || quiet < 8)) {
      await new Promise(resolve => setTimeout(resolve, 100));
      await page.clock.runFor(50); ms += 50;
      const n = await page.evaluate(() => {
        if (!window.__playtestMutations) { window.__playtestMutations = { n: 0 }; new MutationObserver(r => { window.__playtestMutations.n += r.length; }).observe(document.body, { childList: true, subtree: true }); }
        return window.__playtestMutations.n;
      });
      quiet = n === last ? quiet + 1 : 0; last = n;
    }
    return ms;
  }
  async function screenshot() {
    const file = path.join(dir, `${String(step).padStart(4, '0')}.png`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(file, Buffer.from(data, 'base64'));
    // Match smoke pixel bounds, using compositor PNG rather than a discarded GL buffer.
    const canvas = page.locator('canvas[data-engine]:visible').first();
    const box = await canvas.count() ? await canvas.boundingBox() : null;
    const sample = box ? (await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } })).data : data;
    const pixels = await page.evaluate(async b64 => {
      const image = new Image(); image.src = `data:image/png;base64,${b64}`; await image.decode();
      const c = document.createElement('canvas'); c.width = 64; c.height = 36;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0, 64, 36);
      const p = ctx.getImageData(0, 0, 64, 36).data; let lit = 0, min = 255, max = 0;
      for (let i = 0; i < p.length; i += 4) { const v = Math.max(p[i], p[i + 1], p[i + 2]); if (v > 15) lit++; min = Math.min(min, v); max = Math.max(max, v); }
      return { lit, spread: max - min };
    }, sample);
    if (pixels.lit <= 20 || pixels.spread <= 10) errors.push(`Blank screenshot: ${JSON.stringify(pixels)}`);
    return `Screenshot: ${file}`;
  }
  async function look() {
    refs.clear();
    const controls = page.locator('button, input, select, textarea, a, [role="button"], [role="tab"], [role="menuitem"], [role="slider"]');
    const lines = [];
    for (let i = 0; i < await controls.count(); i++) {
      const el = controls.nth(i); if (!await el.isVisible()) continue;
      const id = `e${i + 1}`; refs.set(id, el);
      lines.push(`[${id}] ${await el.evaluate(e => `${e.getAttribute('role') || e.tagName.toLowerCase()} ${e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || e.getAttribute('placeholder') || ''}`)}`);
    }
    return `${brief(await state())}\n${await page.locator('body').ariaSnapshot()}\nControls (refs valid until UI changes):\n${lines.join('\n')}\n${await screenshot()}`;
  }
  async function target(value, saved) {
    if (saved) {
      const all = page.locator(saved.tag).filter({ hasText: saved.text });
      if (saved.testid) return page.getByTestId(saved.testid);
      if (saved.label) return page.getByLabel(saved.label, { exact: true });
      return all.nth(saved.index);
    }
    if (refs.has(value)) return refs.get(value);
    if (/^e\d+$/.test(value)) throw new Error('Unknown ref; run look first');
    if (value.startsWith('testid:')) return page.getByTestId(value.slice(7));
    if (value.startsWith('text:')) return page.getByText(value.slice(5), { exact: true });
    const button = page.getByRole('button', { name: value, exact: true });
    if (await button.count()) return button;
    const testid = page.getByTestId(value); if (await testid.count()) return testid;
    const label = page.getByLabel(value, { exact: true }); if (await label.count()) return label;
    return page.getByText(value, { exact: true });
  }
  async function execute(a) {
    const { command, args, options = {} } = a;
    switch (command) {
      case 'look': return look();
      case 'shot': return screenshot();
      case 'move':
        if (args.length !== 2 || args.some(v => !Number.isFinite(Number(v)))) throw new Error('move <x> <y>');
        await page.mouse.move(...args.map(Number)); return 'Pointer moved';
      case 'scroll':
        if (args.length !== 1 || !Number.isFinite(Number(args[0]))) throw new Error('scroll <vertical pixels>');
        await page.mouse.wheel(0, Number(args[0])); return 'Scrolled';
      case 'click': {
        if (args.length === 2 && args.every(v => Number.isFinite(Number(v)))) {
          await page.mouse.click(...args.map(Number)); const ms = await react(); await settle(); refs.clear(); return `Clicked viewport coordinates (+${ms / 1000} s)`;
        }
        if (!args.length) throw new Error('click <ref|text|testid>');
        const el = await target(args.join(' '), options.target);
        const meta = await el.evaluate(e => ({ tag: e.tagName.toLowerCase(), text: e.textContent?.trim() ?? '', label: e.getAttribute('aria-label'), testid: e.getAttribute('data-testid') }));
        meta.index = await page.locator(meta.tag).filter({ hasText: meta.text }).evaluateAll((els, element) => els.indexOf(element), await el.elementHandle());
        a.options = { ...options, target: meta };
        // Frozen rAF cannot satisfy Playwright's stability wait: visibility/uniqueness are
        // checked normally; force skips only the animation stability wait.
        if (!await el.isVisible() || !await el.isEnabled()) throw new Error('Target is hidden or disabled');
        await el.click({ force: true }); const ms = await react(); await settle(); refs.clear(); return `Clicked (+${ms / 1000} s)`;
      }
      case 'type': { await page.keyboard.insertText(args.join(' ')); const ms = await react(); return `Typed into focused field (+${ms / 1000} s)`; }
      case 'key': {
        if (args.length !== 1) throw new Error('key <Playwright key> [--hold seconds]');
        let ms = options.hold === undefined ? 0 : seconds(options.hold);
        if (!ms) { await page.keyboard.press(args[0]); ms = await react(); }
        else {
          const keys = args[0].length > 1 ? args[0].split('+') : [args[0]];
          const held = [];
          try {
            for (const key of keys) { await page.keyboard.down(key); held.push(key); }
            await page.clock.runFor(ms);
          } finally { for (const key of held.reverse()) await page.keyboard.up(key); }
        }
        await settle(); return `Key released; advanced ${ms / 1000}s (warp applies)`;
      }
      case 'wait': { const ms = seconds(args[0]); await page.clock.runFor(ms); await settle(); return `Advanced ${ms / 1000}s (warp applies)`; }
      case 'drag': {
        if (args.length !== 4 || args.some(v => !Number.isFinite(Number(v)))) throw new Error('drag <fromX> <fromY> <toX> <toY> (viewport pixels)');
        const [x, y, tx, ty] = args.map(Number);
        await page.mouse.move(x, y); await page.mouse.down();
        try { await page.mouse.move(tx, ty, { steps: 12 }); } finally { await page.mouse.up(); }
        return 'Pointer drag complete';
      }
      case 'note': return `Observation: ${args.join(' ')}`;
      case 'debug': return `TRIAGE ONLY (not player evidence): ${JSON.stringify(await page.evaluate(args.join(' ')))}`;
      case 'stop': return 'Stopped (evidence retained)';
      default: throw new Error('Unsupported session command');
    }
  }
  let queue = Promise.resolve();
  server = http.createServer((req, res) => {
    let body = ''; req.on('data', b => body += b);
    req.on('end', () => { queue = queue.then(async () => {
      const start = Date.now(); let a, output, ok = true;
      try { a = JSON.parse(body); step++; output = await execute(a); }
      catch (e) { ok = false; output = e.message; }
      await page.evaluate(() => window.__playtestGPU());
      const current = await state(); const fresh = errors.splice(0);
      if (fresh.length) output = `ERRORS SINCE LAST COMMAND:\n${fresh.join('\n')}\n${output}`;
      await appendFile(path.join(dir, 'actions.jsonl'), JSON.stringify({ version: 1, step, ...a, ...current, ok, summary: output, errors: fresh, wallMs: Date.now() - start }) + '\n');
      res.end(JSON.stringify({ ok, output: a?.command === 'look' ? output : `${output}\n${brief(current)}` }));
      if (a?.command === 'stop') await close();
    }).catch(e => { res.end(JSON.stringify({ ok: false, output: e.stack })); }); });
  });
  await new Promise(resolve => server.listen(path.join(dir, 'control.sock'), resolve));
  await appendFile(path.join(dir, 'actions.jsonl'), JSON.stringify({ version: 1, step: 0, command: 'start', args: [], options: {}, ...await state(), ok: true, summary: 'Fresh storage; production build; clock frozen', errors: [...errors] }) + '\n');
  await writeFile(path.join(dir, 'pid'), String(process.pid));
  await writeFile(path.join(dir, 'ready'), `Session ready: ${dir}\nPreview: http://127.0.0.1:${port}\nFrozen between commands. Run look.`);
} catch (error) {
  console.error(error); await close(); process.exitCode = 1;
}
