// Scene-cycle leak finder (companion to gpu-bench.mjs): flight → map → editor → flight → menu, N times, then a
// heap snapshot; prints counts of detached DOM nodes / app classes and the shortest retaining path (from the GC
// roots) of a few detached nodes and of surplus FlightController / EditorView / renderer instances.
//   scripts/bench/gpu-leaks.sh [--base http://localhost:5317] [--cycles 3]
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const base = args.base ?? 'http://localhost:5317';
const N = +(args.cycles ?? 3);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
await context.addInitScript(() => { localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'low', graphicsProfile: 99, autoSaveInterval: 0, masterVolume: 0 })); localStorage.setItem('wsp.help.seen.v1', '1'); });
const page = await context.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
const cdp = await context.newCDPSession(page);
const ready = () => page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000, polling: 100 });
const setScene = (s, extra = {}) => page.evaluate(([s, e]) => window.__game.set({ scene: s, ...e }), [s, extra]);
try {
  await page.goto(`${base}/?flight=stock-kestrel`); await ready(); await page.waitForTimeout(1000);
  for (let i = 0; i < N; i++) {
    await setScene('flight', { launchPending: true, resumeWorld: null }); await ready(); await page.waitForTimeout(800);
    await page.evaluate(() => window.__flight.toggleMap()); await page.waitForTimeout(800); await page.evaluate(() => window.__flight.toggleMap());
    await setScene('editor'); await page.waitForFunction(() => window.__editor?.view, null, { timeout: 60000 }); await page.waitForTimeout(800);
    await setScene('flight', { launchPending: true, resumeWorld: null }); await ready(); await page.waitForTimeout(800);
    await setScene('menu'); await page.waitForTimeout(800);
  }
  await page.waitForTimeout(1500);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const chunks = [];
  cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  const snap = JSON.parse(chunks.join(''));
  const m = snap.snapshot.meta; const nf = m.node_fields.length; const ef = m.edge_fields.length;
  const nodeTypes = m.node_types[0]; const edgeTypes = m.edge_types[0];
  const N_TYPE = m.node_fields.indexOf('type'), N_NAME = m.node_fields.indexOf('name'), N_EC = m.node_fields.indexOf('edge_count'), N_SIZE = m.node_fields.indexOf('self_size');
  const E_TYPE = m.edge_fields.indexOf('type'), E_NAME = m.edge_fields.indexOf('name_or_index'), E_TO = m.edge_fields.indexOf('to_node');
  const nodes = snap.nodes, edges = snap.edges, strings = snap.strings; const count = nodes.length / nf;
  const firstEdge = new Uint32Array(count + 1); for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += nodes[i * nf + N_EC] * ef; } firstEdge[count] = edges.length;
  const name = (i) => strings[nodes[i * nf + N_NAME]]; const type = (i) => nodeTypes[nodes[i * nf + N_TYPE]];
  const counts = new Map();
  for (let i = 0; i < count; i++) { const t = type(i); if (t === 'object' || t === 'native') { const n = name(i); counts.set(n, (counts.get(n) ?? 0) + 1); } }
  const show = [...counts.entries()].filter(([k]) => /^Detached|FlightController|EditorView|WebGLRenderer|HubScene|MapView|Navball|VesselView|PlanetRenderer|World$|Universe|FiberNode|AudioContext|GainNode|OscillatorNode|AudioBufferSourceNode/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 40);
  console.log('instance counts after', N, 'cycles:'); for (const [k, v] of show) console.log(`  ${String(v).padStart(7)}  ${k}`);
  // BFS from root over strong edges.
  const parent = new Int32Array(count).fill(-1); const pedge = new Int32Array(count).fill(-1);
  const q = new Int32Array(count); let qh = 0, qt = 0; q[qt++] = 0; parent[0] = 0;
  while (qh < qt) {
    const i = q[qh++];
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += ef) {
      const et = edgeTypes[edges[e + E_TYPE]]; if (et === 'weak' || et === 'shortcut') continue;
      const to = edges[e + E_TO] / nf; if (parent[to] !== -1) continue;
      parent[to] = i; pedge[to] = e; q[qt++] = to;
    }
  }
  const pathOf = (i) => {
    const out = []; let guard = 0;
    while (i !== 0 && parent[i] !== -1 && guard++ < 40) {
      const e = pedge[i]; const et = edgeTypes[edges[e + E_TYPE]]; const en = et === 'element' || et === 'hidden' ? `[${edges[e + E_NAME]}]` : strings[edges[e + E_NAME]];
      out.push(`${name(parent[i])}.${en}`); i = parent[i];
    }
    return out.reverse().join(' → ');
  };
  const want = (args.find ?? 'Detached HTMLDivElement,FlightController,EditorView,WebGLRenderer,HubScene').split(',');
  for (const w of want) {
    const ids = []; for (let i = 0; i < count && ids.length < 400; i++) if (name(i) === w && (type(i) === 'object' || type(i) === 'native')) ids.push(i);
    const reach = ids.filter((i) => parent[i] !== -1);
    console.log(`\n${w}: ${ids.length} (${reach.length} strongly reachable)`);
    const seen = new Set();
    for (const i of reach) { const p = pathOf(i); const k = p.split(' → ').slice(-6).join(' → '); if (seen.has(k)) continue; seen.add(k); console.log(`  … ${p.split(' → ').slice(-14).join(' → ')}`); if (seen.size >= +(args.paths ?? 4)) break; }
  }
} finally { await context.close(); await browser.close().catch(() => {}); }
