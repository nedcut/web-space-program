// Run from qa3 against Vite on 5198. Public dev hooks accelerate physics; UI remains real.
import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const expect = baseExpect.configure({ timeout: 90000 });
const out = new URL('../docs/qa/qa3/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
page.setDefaultTimeout(120000);
const report = { checks: [], errors: [], warnings: [] };
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); if (m.type() === 'warning') report.warnings.push(m.text()); });
page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'QA mission' : undefined));
const save = () => writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
const shot = name => page.screenshot({ path: new URL(`${name}.png`, out).pathname, timeout: 120000 });
const check = async (name, fn) => {
  console.log('START', name);
  try { const detail = await fn(); report.checks.push({ name, status: 'pass', detail }); console.log('PASS', name, JSON.stringify(detail ?? '')); }
  catch (e) { report.checks.push({ name, status: 'fail', error: e.message }); console.log('FAIL', name, e.message); console.log(await page.locator('body').innerText({ timeout: 10000 }).catch(() => '')); await save(); throw e; }
  await save();
};
const scene = (name, patch = {}) => page.evaluate(async ({ name, patch }) => { const { game } = await window.__qaImport('/src/game/store.ts'); game.set({ scene: name, ...patch }); }, { name, patch });
const ready = async () => { await page.waitForFunction(() => window.__flight && document.querySelector('.hud-dock')); await page.locator('.loading-screen').waitFor({ state: 'hidden' }); };
const enterMission = async id => { await scene('menu'); await page.evaluate(async id => { const { startScenario } = await window.__qaImport('/src/scenarios/runtime.ts'); startScenario(id); }, id); await ready(); };
try {
  await page.addInitScript(() => {
    localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'low', shadows: false, bloom: false, clouds: false, scatter: false, renderScale: 0.5, masterVolume: 0.15, reduceMotion: true, autoSaveInterval: 0 }));
    localStorage.setItem('wsp.help.seen.v1', '1');
  });
  await page.goto('http://127.0.0.1:5198/');
  await page.evaluate(() => { window.__qaImport = async path => import(performance.getEntriesByType('resource').map(e => e.name).filter(n => new URL(n).pathname === path).at(-1) ?? path); });
  await check('Menu, all settings tabs and photo/stress bindings', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    for (const name of ['Graphics', 'Audio', 'Controls', 'Gameplay', 'Accessibility']) { await page.getByRole('tab', { name, exact: true }).click(); await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible(); }
    await page.getByRole('tab', { name: 'Controls', exact: true }).click();
    await expect(page.getByText('Photo Mode', { exact: true })).toBeVisible();
    await expect(page.getByText('Stress Overlay', { exact: true })).toBeVisible();
    await shot('settings'); await page.getByRole('button', { name: 'Done', exact: true }).click();
  });
  await check('All ten scenario briefings', async () => {
    await page.getByRole('button', { name: 'Scenarios · Missions', exact: true }).click();
    await expect(page.locator('.scenario-card')).toHaveCount(10);
    for (const button of await page.locator('.scenario-card').all()) { await button.click(); await expect(page.locator('.scenario-briefing h2')).toBeVisible(); }
    await shot('scenarios'); await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  });
  await check('New program, hub and photo capture', async () => {
    await page.getByRole('button', { name: 'New Game', exact: true }).click(); await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.waitForFunction(() => window.__hub); await page.getByRole('button', { name: 'Photo mode', exact: true }).click();
    await expect(page.getByText('Photo mode · simulation frozen')).toBeVisible();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'PNG 1×', exact: true }).click();
    const file = new URL('hub-photo.png', out).pathname; await (await download).saveAs(file);
    const png = await readFile(file); expect(png.subarray(1, 4).toString()).toBe('PNG');
    const dimensions = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    expect(dimensions.width).toBeGreaterThan(0); await page.getByRole('button', { name: 'Exit', exact: true }).click(); return dimensions;
  });
  await check('IndexedDB legacy migration, stock scale badges, library actions', async () => {
    await page.evaluate(async () => { const { buildSoundingRocket } = await window.__qaImport('/src/editor/stockCrafts.ts'); localStorage.setItem('wsp.crafts.v1', JSON.stringify([{ ...buildSoundingRocket(), name: 'Legacy QA craft' }])); });
    await page.getByRole('button', { name: /Vehicle Assembly/ }).click(); await page.waitForFunction(() => window.__editor);
    await page.getByTitle('Load craft', { exact: true }).click();
    await expect(page.locator('.vab-stock-scale').filter({ hasText: 'real scale' }).first()).toBeVisible();
    await expect(page.locator('.vab-stock-scale').filter({ hasText: 'challenging scale' }).first()).toBeVisible();
    const row = page.locator('.vab-saved-row').filter({ hasText: 'Legacy QA craft' }); await expect(row).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('wsp.crafts.v1'))).toBeNull();
    await row.getByRole('button', { name: 'Duplicate', exact: true }).click(); await expect(page.locator('.vab-saved-row')).toHaveCount(2);
    await page.getByLabel('Search craft library').fill('Legacy QA craft copy'); await expect(page.locator('.vab-saved-row')).toHaveCount(1);
    await shot('library'); await page.getByRole('button', { name: 'Close', exact: true }).click();
  });
  await check('Share code round trip through editor preview/import', async () => {
    const before = await page.evaluate(() => { window.__editor.loadStock('meridian'); return window.__editor.session.currentCraft(); });
    await page.getByRole('button', { name: 'Copy share code', exact: true }).click();
    const code = await page.getByLabel('Generated share code').inputValue(); expect(code.startsWith('WSP1.')).toBe(true);
    await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByLabel('Craft share code').fill(code); await page.getByRole('button', { name: 'Preview code', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Load vehicle', exact: true })).toBeEnabled(); await shot('share-import');
    await page.getByRole('button', { name: 'Load vehicle', exact: true }).click();
    const after = await page.evaluate(() => window.__editor.session.currentCraft()); expect(after).toEqual(before); return { parts: after.parts.length, codeBytes: code.length };
  });
  await check('Launch VFX, stress overlay and pause/photo clock', async () => {
    await page.getByRole('button', { name: /^Launch/ }).click(); await ready();
    await page.keyboard.press('F4'); expect(await page.evaluate(() => window.__flight.stressOverlay)).toBe(true);
    await page.keyboard.press('F4'); await page.keyboard.press('z'); await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__flight.world.active?.state.situation === 'flying');
    await page.evaluate(async () => { const c = window.__flight; const { neutralInput } = await window.__qaImport('/src/sim/vessel/index.ts'); for (let i = 0; i < 600; i++) c.world.tick(0.02, neutralInput({ throttle: 1, sas: 'stabilityAssist' })); });
    await page.waitForTimeout(1500); await page.keyboard.press('p'); await expect(page.getByText('Photo mode · simulation frozen')).toBeVisible();
    const before = await page.evaluate(() => ({ ut: window.__flight.world.ut, altitude: window.__flight.world.active.state.telemetry.altitudeAGL, thrust: window.__flight.world.active.state.telemetry.thrust, parts: window.__flight.world.active.state.parts.length, events: window.__flight.world.flightlog.records.flatMap(r => r.events) }));
    expect(before.thrust).toBeGreaterThan(0); expect(before.events.some(e => e.kind === 'partLoss' || e.kind === 'landing')).toBe(false); expect(before.events.some(e => e.kind === 'launch')).toBe(true);
    await page.waitForTimeout(1200); expect(await page.evaluate(() => window.__flight.world.ut)).toBe(before.ut); await shot('liftoff');
    await page.keyboard.press('Escape'); expect(await page.evaluate(() => window.__flight.paused)).toBe(false);
    await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: /^Resume/ })).toBeVisible();
    await page.getByRole('button', { name: 'Photo mode', exact: true }).click(); await page.keyboard.press('p');
    expect(await page.evaluate(() => window.__flight.paused)).toBe(true); await expect(page.getByRole('button', { name: /^Resume/ })).toBeVisible(); return before;
  });
  await check('Flight report, charts, share summary and achievements screen', async () => {
    await page.getByRole('button', { name: 'Space Center', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Flight log', exact: true })).toBeVisible();
    await expect(page.locator('.report-charts canvas')).toHaveCount(4); await page.getByRole('button', { name: 'Share summary', exact: true }).click();
    await expect(page.locator('.flight-report textarea')).toContainText('Meridian'); await shot('flight-log');
    await page.getByRole('button', { name: 'Achievements', exact: true }).click(); await expect(page.locator('.achievement.earned').first()).toBeVisible(); await shot('achievements');
    await page.getByRole('button', { name: 'Space Center', exact: true }).click();
  });
  await check('Named save, Continue slots and export', async () => {
    await page.getByRole('button', { name: 'Save as…', exact: true }).click(); await page.getByRole('button', { name: 'Main menu', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click(); await expect(page.getByText('QA mission', { exact: true })).toBeVisible();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).first().click();
    const file = new URL('program.wsp-save.json', out).pathname; await (await download).saveAs(file);
    const exported = JSON.parse(await readFile(file, 'utf8')); expect(exported.format).toBe('wsp-save'); await shot('save-slots');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  });
  await check('Ring Skimmer mission completion and photo keeps debrief paused', async () => {
    await enterMission('ring-skimmer');
    const result = await page.evaluate(async () => {
      const c = window.__flight; c.paused = true;
      const { neutralInput } = await window.__qaImport('/src/sim/vessel/index.ts'); const { getScenarioRun } = await window.__qaImport('/src/scenarios/runtime.ts');
      for (let i = 0; i < 1500 && !getScenarioRun().result; i++) c.world.tick(0.25, neutralInput());
      return { result: getScenarioRun().result, records: c.world.flightlog.records.length };
    });
    expect(result.result.success).toBe(true); await expect(page.getByLabel('Mission debrief')).toBeVisible(); await shot('scenario-debrief');
    await page.keyboard.press('p'); await page.keyboard.press('p'); expect(await page.evaluate(() => window.__flight.paused)).toBe(true);
    await page.getByRole('button', { name: 'Scenarios', exact: true }).click(); return result;
  });
  await check('Real atmospheric reentry, hot hardware and scenario flight record', async () => {
    await enterMission('moon-return');
    const entry = await page.evaluate(async () => {
      const c = window.__flight, w = c.world; c.paused = true; w.stageActive(); w.stageActive();
      const { neutralInput } = await window.__qaImport('/src/sim/vessel/index.ts');
      let maximum = 0, steps = 0;
      while (w.active && steps++ < 7000) {
        w.tick(0.25, neutralInput({ sas: 'retrograde', sasReference: 'surface' }));
        const temp = Math.max(...(w.active?.state.parts ?? []).flatMap(p => p.skinTemperature)); maximum = Math.max(maximum, temp);
        if (temp > 1100 && w.active.state.telemetry.dynamicPressure > 100) break;
      }
      return { maximum, steps, parts: w.active?.state.parts.length };
    });
    expect(entry.maximum).toBeGreaterThan(1100); await page.waitForTimeout(1500); await shot('reentry');
    const landing = await page.evaluate(async () => {
      const w = window.__flight.world; const { neutralInput } = await window.__qaImport('/src/sim/vessel/index.ts'); const { getScenarioRun } = await window.__qaImport('/src/scenarios/runtime.ts');
      for (let i = 0; i < 14000 && !getScenarioRun().result; i++) w.tick(0.25, neutralInput({ sas: 'retrograde', sasReference: 'surface' }));
      return { result: getScenarioRun().result, events: w.flightlog.records.flatMap(r => r.events.map(e => e.kind)) };
    });
    expect(landing.result.success).toBe(true); expect(landing.events.some(e => e === 'landing' || e === 'splashdown')).toBe(true);
    await page.getByRole('button', { name: 'Scenarios', exact: true }).click(); return { entry, landing };
  });
  await check('Tutorial world, achievements and return navigation', async () => {
    await scene('training'); await page.evaluate(async () => { const { startLesson } = await window.__qaImport('/src/tutorial/runtime.ts'); startLesson('moon-landing'); }); await ready();
    const result = await page.evaluate(async () => { const { loadAchievements } = await window.__qaImport('/src/game/flightlog/storage.ts'); return { recorded: window.__flight.world.flightlog.records.some(r => r.bodies.includes('moon')), moon: loadAchievements().unlocked['soi-moon'] }; });
    expect(result.recorded).toBe(true); expect(result.moon).toBeDefined(); await shot('tutorial'); await page.getByRole('button', { name: 'Lessons', exact: true }).click(); return result;
  });
  await check('Titan sea splashdown, buoyancy, biome and achievement', async () => {
    await scene('menu');
    await page.evaluate(async () => {
      const { game, DEFAULT_START_UT } = await window.__qaImport('/src/game/store.ts'); const { World } = await window.__qaImport('/src/game/world.ts'); const { Universe } = await window.__qaImport('/src/game/universe.ts');
      const { PART_CATALOG } = await window.__qaImport('/src/data/parts.ts'); const { stock, spawnRelative } = await window.__qaImport('/src/scenarios/catalog.ts'); const { serializeWorld } = await window.__qaImport('/src/game/persistence.ts');
      const { latLonToUnit } = await window.__qaImport('/src/sim/terrain/index.ts'); const { scale, add, normalize, dot } = await window.__qaImport('/src/util/vec3.ts');
      const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT), u = w.universe, craft = stock('hazewalker');
      let best = -Infinity;
      for (let i = 0; i < 64; i++) { const t = DEFAULT_START_UT + u.body('titan').rotationPeriod * i / 64; const light = dot(u.ephem.fromBodyFixed('titan', latLonToUnit(76, 40), t), normalize(scale(u.ephem.getBodyState('titan', t).position, -1))); if (light > best) { best = light; w.ut = t; } }
      const up = u.ephem.fromBodyFixed('titan', latLonToUnit(76, 40), w.ut), rel = scale(up, u.body('titan').radius + u.terrain('titan').liquid.level + 30);
      const v = spawnRelative(w, craft, 'titan', rel, add(u.ephem.surfaceVelocity('titan', rel, w.ut), scale(up, -1)), up); v.state.situation = 'flying';
      game.set({ scene: 'flight', craft, launchPending: false, resumeWorld: serializeWorld(w), scenarioActive: false, trainingActive: false });
    }); await ready();
    const result = await page.evaluate(async () => {
      const c = window.__flight, w = c.world; c.paused = true; c.cam.pitch = 0.7; c.cam.distance = 40; const v = w.active;
      const { neutralInput } = await window.__qaImport('/src/sim/vessel/index.ts'); const { scienceContext } = await window.__qaImport('/src/game/science.ts'); const { length } = await window.__qaImport('/src/util/vec3.ts');
      for (let i = 0; i < 1200 && !v.state.destroyed; i++) w.tick(0.02, neutralInput({ sas: 'stabilityAssist' }));
      return { situation: v.state.situation, speed: length(w.surfaceVelocity(v)), parts: v.state.parts.length, destroyed: v.state.destroyed, biome: scienceContext(w, v).biome, achievement: w.achievementProfile.unlocked['titan-land'], events: w.flightlog.records.flatMap(r => r.events.map(e => e.kind)) };
    });
    expect(result.situation).toBe('splashed'); expect(result.destroyed).toBe(false); expect(result.biome).toBe('Hydrocarbon Seas'); expect(result.achievement).toBeDefined(); expect(result.events).toContain('splashdown'); await page.waitForFunction(() => window.__flight.planets.isIdle('titan')); await page.waitForTimeout(2000); await shot('titan-splashdown'); return result;
  });
  await check('No console errors or framebuffer warnings', async () => { expect(report.errors).toEqual([]); expect(report.warnings.filter(x => /INVALID_FRAMEBUFFER|zero size/.test(x))).toEqual([]); });
} finally { await save(); await browser.close(); process.exitCode = report.checks.some(c => c.status === 'fail') || report.errors.length ? 1 : 0; }
