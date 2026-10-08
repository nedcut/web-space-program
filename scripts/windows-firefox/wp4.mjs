// Copy to C:\wsp-tools\drv-ff; run Windows Node under flock /tmp/wsp-gpu.lock from WSL.
// node.exe wp4.mjs <baseURL> <tag> <dpr=1> <chrome|firefox=chrome>
// Artifacts are outside git. Baseline uses scripts/wp4-baseline.config.ts.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
const [base, tag = 'wp4', dpr = '1', which = 'chrome'] = process.argv.slice(2);
const directory = `C:/wsp-tools/shots/wp4/${tag}`;
mkdirSync(directory, { recursive: true });
const profile = `C:/wsp-tools/wp4-profile-${tag}`;
rmSync(profile, { recursive: true, force: true });
const browser = await puppeteer.launch(which === 'firefox' ? {
  browser: 'firefox', headless: false, protocolTimeout: 30000, executablePath: 'C:/Program Files/Mozilla Firefox/firefox.exe', userDataDir: profile,
  extraPrefsFirefox: { 'layout.frame_rate': 120 }, args: ['--width=1600', '--height=990'], defaultViewport: null,
} : { browser: 'chrome', headless: false, protocolTimeout: 30000, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  userDataDir: profile, defaultViewport: { width: 1600, height: 900, deviceScaleFactor: Number(dpr) }, args: ['--disable-frame-rate-limit'] });
const page = (await browser.pages())[0];
const errors = [], longTasks = [], scenes = [];
page.on('pageerror', e => { errors.push(e.message); console.error('Page error:', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.error('Console error:', m.text()); } });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('wsp.help.seen.v1', '1');
  localStorage.setItem('wsp.mapPlanner.open.v1', '0');
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ graphicsProfile: 99, quality: 'medium', masterVolume: 0,
    autoSaveInterval: 0, adaptiveResolution: false, frameRateLimit: 120, showFps: false }));
  window.__wp4Long = [];
  try { new PerformanceObserver(list => window.__wp4Long.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true }); } catch { /* Firefox does not expose long tasks. */ }
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let session, frame = 0; const stamps = [];
try {
  await page.goto(base + '?flight=stock-selene&scenario=orbit', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__flight && (!document.querySelector('.loading-screen') || getComputedStyle(document.querySelector('.loading-screen')).opacity === '0'), { timeout: 90000 });
  await delay(3000);
  if (which === 'chrome' && !tag.includes('final')) {
    session = await page.createCDPSession();
    session.on('Page.screencastFrame', event => {
      const name = `frame-${String(frame++).padStart(5, '0')}.jpg`;
      writeFileSync(`${directory}/${name}`, Buffer.from(event.data, 'base64'));
      stamps.push({ file: name, time: event.metadata.timestamp });
      void session.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    });
    await session.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1600 * Number(dpr), maxHeight: 900 * Number(dpr), everyNthFrame: 5 });
  }
  await page.evaluate(() => { window.__flight.toggleMap(); window.__perf.enabled = true; window.__perf.reset(); window.__wp4Long = []; });
  await delay(2500);
  await page.screenshot({ path: `${directory}/leo.png` });
  const snapshot = label => page.evaluate(label => {
    const c = window.__flight, u = c.world.universe, v = c.world.active, body = u.ephem.getBodyState(v.body, c.world.ut);
    const s = window.__perf.summary();
    return { label, body: v.body, distance: c.map.distance, cameraFocus: c.mapUi.focusFrame(v, v.state.position).position, bodyPosition: body.position,
      draws: c.pipeline.stats.calls, gpuMs: c.pipeline.gpuMs, cpuMs: s.cpuMs.avg, cpuP95: s.cpuMs.p95, sections: s.sections,
      bennuVisible: [...document.querySelectorAll('*')].some(e => e.children.length === 0 && e.textContent === 'Bennu' && getComputedStyle(e).display !== 'none'),
      programs: c.pipeline.renderer.info.programs.length, landing: c.mapUi.landing?.result ? { outcome: c.mapUi.landing.result.outcome,
        computeMs: c.mapUi.landing.result.computeMs, maxChunkMs: c.mapUi.landing.result.maxChunkMs, steps: c.mapUi.landing.result.steps } : null,
      submitMs: c.mapUi.landing?.maxSubmitMs, submitAtMs: c.mapUi.landing?.lastRequest,
      viewport: [innerWidth, innerHeight, devicePixelRatio] };
  }, label);
  scenes.push(await snapshot('leo'));
  // A short mid-injection segment exercises the live/anchored orbit without occupying the shared GPU for a full mission.
  await page.evaluate(() => {
    const c = window.__flight, n = c.world.addNode(c.world.ut + 12); n.prograde = 850;
    c.world.stageActive(); c.input.state.throttle = 1; c.sasOn = true; c.sas = 'prograde';
  });
  await delay(4500); await page.screenshot({ path: `${directory}/mid-tli.png` }); scenes.push(await snapshot('mid-tli'));
  await page.evaluate(() => { const c = window.__flight; c.input.state.throttle = 0; c.world.nodes = []; c.world.alarmClock?.acknowledge(); c.toggleMap(); c.devScenario('moon'); c.toggleMap(); });
  await delay(1800); await page.screenshot({ path: `${directory}/moon.png` }); scenes.push(await snapshot('moon'));
  if (tag.includes('after')) {
    await page.evaluate(() => {
      const c = window.__flight;
      c.world.alarmClock.add(c.world.activeId, 'Camera check', c.world.ut + .5);
      c.world.warp = { mode: 'rails', index: 5 };
    });
    await delay(1000);
    const stop = await page.evaluate(() => ({ held: window.__flight.world.alarmClock.held, warp: window.__flight.world.warp.index }));
    scenes.push({ label: 'custom-alarm', ...stop });
    await page.click('button[aria-label="Mission alarms"]'); await delay(400);
    await page.screenshot({ path: `${directory}/alarms.png` });
    // Start a known atmospheric approach on the actual worker, then inspect its result + main-thread submit cost.
    await page.evaluate(() => {
      const c = window.__flight; c.world.alarmClock.acknowledge(); c.toggleMap(); c.devScenario('reentry');
      while (c.world.active.state.nextStage >= 1) c.world.stageActive();
      const v = c.world.active; const chute = v.state.parts.find(p => p.chute); if (chute) chute.chute.phase = 'armed';
      c.mapUi.landing.attitude = 'retrograde'; c.sasOn = true; c.sas = 'retrograde';
      c.speedMode = 'surface';
    });
    await page.waitForFunction(() => !!window.__flight.mapUi.landing.result, { timeout: 30000 });
    await delay(1000);
    scenes.push(await snapshot('reentry'));
    await page.screenshot({ path: `${directory}/surface-marker.png` });
    await page.evaluate(() => {
      const c = window.__flight; c.toggleMap();
      const points = c.mapUi.landing.result.points, p = points[Math.floor(points.length / 2)];
      c.map.yaw = Math.atan2(p.y, p.x); c.map.pitch = Math.atan2(p.z, Math.hypot(p.x, p.y));
    }); await delay(1200);
    await page.screenshot({ path: `${directory}/reentry-map.png` });
    scenes.push(await page.evaluate(() => {
      const m = window.__flight.map;
      return { label: 'landing-line', visible: m.landingLine?.visible, points: m.landingData?.points.length };
    }));
    // A short local fall puts the landing point on the visible side, so the flight marker can be asserted.
    await page.evaluate(() => {
      const c = window.__flight; c.toggleMap(); c.devScenario('sea'); c.mapUi.landing.attitude = 'hold';
      c.cam.mode = 'auto'; c.cam.pitch = 1.2; c.cam.distance = 25;
    });
    await page.waitForFunction(() => {
      const el = document.querySelector('[aria-label="Predicted landing surface marker"]');
      return el && getComputedStyle(el).display !== 'none';
    }, { timeout: 15000 });
    await page.screenshot({ path: `${directory}/surface-marker-visible.png` });
    scenes.push({ label: 'flight-marker', visible: true });
  }
  if (session) await session.send('Page.stopScreencast');
  longTasks.push(...await page.evaluate(() => window.__wp4Long));
  const report = { tag, scenes, errors, longTasks, videoFrames: frame };
  writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${directory}/frames.json`, JSON.stringify(stamps));
  console.log(JSON.stringify(report));
} catch (error) {
  writeFileSync(`${directory}/failure.json`, JSON.stringify({ message: String(error), errors, scenes }, null, 2));
  try { await page.screenshot({ path: `${directory}/failure.png` }); } catch { /* Preserve the original error. */ }
  throw error;
} finally { await browser.close(); }
