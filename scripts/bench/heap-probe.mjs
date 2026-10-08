// JS heap after GC per flight stage on the real-GPU Chrome (Windows Node + playwright-core, CDP 9333).
// Splits `usedJSHeapSize` into V8 objects (Runtime.getHeapUsage usedSize) and ArrayBuffer backing stores
// (typed arrays), and reports the focused planet's terrain cache/batch state. Optional V8 heap snapshot per stage
// (--snap 1) for retainer attribution (see docs/PERFORMANCE.md, "Terrain heap").
//   flock /tmp/wsp-gpu.lock scripts/bench/heap-probe.sh --base http://<ip>:5511 --quality ultra --run teleport
//   --run teleport: ?flight=stock-kestrel pad → devScenario('orbit') → map
//   --run ascent:   ?flight=stock-meridian pad → orbit assist at 4× physics warp → orbit → map
import { chromium } from 'playwright-core';
import { createWriteStream, mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = (args.base ?? 'http://localhost:5511').replace(/\/$/, '');
const quality = args.quality ?? 'medium';
const run = args.run ?? 'teleport';
const label = args.label ?? `${quality}-${run}`;
const snapDir = args.snapdir ?? 'C:\\wsp-tools\\heapsnaps';
const snapshots = args.snap === '1';
if (snapshots) mkdirSync(snapDir, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 180000 });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
await context.addInitScript((q) => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: q, graphicsProfile: 99, shadows: true, bloom: true, clouds: true, scatter: true, renderScale: 1, adaptiveQuality: false, autoSaveInterval: 0, masterVolume: 0 }));
  localStorage.setItem('wsp.help.seen.v1', '1');
}, quality);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await context.newCDPSession(page);
await cdp.send('HeapProfiler.enable');
let out = null;
cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => out?.write(e.chunk));

const MB = 1048576;
const terrainInfo = () => page.evaluate(() => {
  const rows = [];
  window.__flight.scene.traverse((o) => {
    const pl = o.userData?.planet; const qt = pl?.quadtree; if (!qt) return;
    const batch = (b) => b ? { capacity: b.capacity ?? b.mesh.maxInstanceCount, live: b.slots.size, free: b.free.length, count: b.count, gpuMB: b.gpuBytes != null ? Math.round(b.gpuBytes / 1048576) : undefined } : null;
    rows.push({ body: pl.body?.id, stats: { ...qt.stats }, res: qt.opts.res, land: batch(qt.terrainBatch), ocean: batch(qt.oceanBatch) });
  });
  return rows;
});
const mem = async () => {
  const used = await page.evaluate(() => performance.memory.usedJSHeapSize);
  const hu = await cdp.send('Runtime.getHeapUsage');
  return { used: used / MB, objects: hu.usedSize / MB, backing: (hu.backingStorageSize ?? 0) / MB };
};
const r1 = (v) => Math.round(v * 10) / 10;
const results = [];
const measure = async (tag) => {
  await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(500);
  const m = await mem();
  const terrain = await terrainInfo().catch((e) => ({ err: e.message }));
  if (snapshots) {
    out = createWriteStream(`${snapDir}\\${label}-${tag}.heapsnapshot`);
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
    await new Promise((r) => out.end(r)); out = null;
  }
  const row = { label, tag, used: r1(m.used), objects: r1(m.objects), backing: r1(m.backing), terrain };
  results.push(row);
  console.log(JSON.stringify(row));
};
const ready = () => page.waitForFunction(() => !!window.__flight && window.__flight.sceneReady && !document.querySelector('.loading-screen'), null, { timeout: 180000, polling: 250 });
try {
  if (run === 'ascent') {
    await page.goto(`${base}/?flight=stock-meridian`); await ready(); await page.waitForTimeout(10000);
    await measure('pad');
    await page.evaluate(() => { window.__flight.startAssist('orbit'); window.__flight.world.warp = { mode: 'physics', index: 3 }; });
    await page.waitForFunction(() => !window.__flight.assist, null, { polling: 500, timeout: 300000 });
    await page.evaluate(() => { window.__flight.world.warp = { mode: 'physics', index: 0 }; });
    await page.waitForTimeout(10000);
    await measure('orbit');
  } else {
    await page.goto(`${base}/?flight=stock-kestrel`); await ready(); await page.waitForTimeout(10000);
    await measure('pad');
    await page.evaluate(() => { window.__flight.cancelAssist?.(); window.__flight.devScenario('orbit'); });
    await page.waitForTimeout(15000);
    await measure('orbit');
  }
  await page.evaluate(() => window.__flight.toggleMap());
  await page.waitForTimeout(10000);
  await measure('map');
  if (errors.length) console.log(`errors ${JSON.stringify(errors.slice(0, 3))}`);
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
process.exit(0);
