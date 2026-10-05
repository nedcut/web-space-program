// Real module-worker planning and map UI against qa3 Vite on 5198.
import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const expect = baseExpect.configure({ timeout: 90000 });
const out = new URL('../docs/qa/qa3/', import.meta.url); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); page.setDefaultTimeout(120000);
const report = { checks: [], errors: [], warnings: [] };
page.on('pageerror', e => report.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); if (m.type() === 'warning') report.warnings.push(m.text()); }); page.on('dialog', d => d.accept());
try {
  await page.addInitScript(() => { localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'low', renderScale: 0.5, bloom: false, shadows: false, scatter: false, clouds: false, autoSaveInterval: 0, masterVolume: 0 })); localStorage.setItem('wsp.help.seen.v1', '1'); });
  await page.goto('http://127.0.0.1:5198/'); await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await page.evaluate(async () => {
    window.__qaImport = async path => import(performance.getEntriesByType('resource').map(e => e.name).filter(n => new URL(n).pathname === path).at(-1) ?? path);
    const { World } = await window.__qaImport('/src/game/world.ts'), { Universe } = await window.__qaImport('/src/game/universe.ts'), { PART_CATALOG } = await window.__qaImport('/src/data/parts.ts');
    const { game, DEFAULT_START_UT } = await window.__qaImport('/src/game/store.ts'), { buildRingrunner } = await window.__qaImport('/src/editor/stockCrafts.ts'), { serializeWorld } = await window.__qaImport('/src/game/persistence.ts');
    const { stateToElements } = await window.__qaImport('/src/sim/orbit/index.ts'), { add, v3 } = await window.__qaImport('/src/util/vec3.ts');
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT), craft = buildRingrunner(), v = w.launch(craft), b = w.universe.body('earth'), r = b.radius + 120000, bs = w.universe.ephem.getBodyState('earth', w.ut);
    const pos = v3(r, 0, 0), vel = v3(0, Math.sqrt(b.gm / r) * Math.cos(0.5), Math.sqrt(b.gm / r) * Math.sin(0.5));
    Object.assign(v.state, { position: add(bs.position, pos), velocity: add(bs.velocity, vel), situation: 'flying' }); Object.assign(v, { mode: 'rails', fixed: undefined, orbit: stateToElements(b.gm, b.id, pos, vel, w.ut) });
    game.set({ scene: 'flight', resumeWorld: serializeWorld(w), craft, launchPending: false });
  });
  await page.waitForFunction(() => window.__flight && document.querySelector('.hud-dock')); await page.locator('.loading-screen').waitFor({ state: 'hidden' });
  const outcome = await page.evaluate(async () => {
    const c = window.__flight; c.toggleMap(); c.paused = true;
    const { planningSnapshot, requestPlan } = await window.__qaImport('/src/game/planning/client.ts'), { applyPlanningResult } = await window.__qaImport('/src/game/planning/apply.ts');
    c.world.addNode(c.world.ut + 300).prograde = 12; const snapshot = planningSnapshot(c.world);
    const cancelled = requestPlan('transfer', snapshot, { target: 'moon' }); cancelled.cancel(); let cancellation;
    try { await cancelled.result; } catch (e) { cancellation = e.name; }
    const preserved = JSON.stringify(c.world.nodes) === JSON.stringify(snapshot.nodes);
    let beats = 0, progress = 0; const timer = setInterval(() => beats++, 10);
    const task = requestPlan('transfer', snapshot, { target: 'moon' }, { onProgress: () => progress++ }); const plan = await task.result; clearInterval(timer);
    if (plan) applyPlanningResult(c.world, snapshot, plan);
    return { cancellation, preserved, beats, progress, dv: plan?.dv, nodes: c.world.nodes.length, nodeId: c.world.nodes[0]?.id, originalId: snapshot.nodes[0].id };
  });
  expect(outcome.cancellation).toBe('AbortError'); expect(outcome.preserved).toBe(true); expect(outcome.beats).toBeGreaterThan(0); expect(outcome.progress).toBeGreaterThan(0); expect(outcome.dv).toBeGreaterThan(0); expect(outcome.nodeId).toBeGreaterThan(outcome.originalId);
  report.checks.push({ name: 'Worker cancellation preserves nodes; successful Moon plan gets a fresh ID while main-thread timers run', status: 'pass', detail: outcome }); console.log('PASS worker', outcome);
  await page.getByLabel('Transfer window destination').selectOption('saturn');
  await expect(page.getByRole('dialog', { name: 'Transfer window', exact: true })).toBeVisible();
  await expect(page.getByText('Hover for details. Click a cell to verify and plan its transfer.')).toBeVisible();
  await page.screenshot({ path: new URL('transfer-window.png', out).pathname, timeout: 120000 });
  report.checks.push({ name: 'Progressive Saturn transfer-window grid', status: 'pass' });
  expect(report.errors).toEqual([]); report.checks.push({ name: 'Zero console errors', status: 'pass' });
} catch (e) { report.checks.push({ name: 'Planner browser check', status: 'fail', error: e.message }); console.error(e); }
finally { await writeFile(new URL('planner-report.json', out), JSON.stringify(report, null, 2)); await browser.close(); process.exitCode = report.checks.some(c => c.status === 'fail') || report.errors.length ? 1 : 0; }
