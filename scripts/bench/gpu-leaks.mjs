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
await context.addInitScript(() => {
  localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'low', graphicsProfile: 99, autoSaveInterval: 0, masterVolume: 0 })); localStorage.setItem('wsp.help.seen.v1', '1');
  // Same in-page cycle as gpu-bench.mjs (one identical evaluate per cycle).
  const until = async (f, ms = 60000) => { const t0 = performance.now(); while (!f()) { if (performance.now() - t0 > ms) throw new Error('cycle timeout'); await new Promise((r) => setTimeout(r, 100)); } };
  const flightUp = () => !!window.__flight && !document.querySelector('.loading-screen');
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__benchCycle = async () => {
    const g = window.__game;
    g.set({ scene: 'flight', launchPending: true, resumeWorld: null }); await until(flightUp); await pause(800);
    window.__flight.toggleMap(); await pause(800); window.__flight.toggleMap();
    g.set({ scene: 'editor' }); await until(() => !!window.__editor?.view); await pause(800);
    g.set({ scene: 'flight', launchPending: true, resumeWorld: null }); await until(flightUp); await pause(800);
    g.set({ scene: 'menu' }); await pause(800);
    return 0;
  };
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
const cdp = await context.newCDPSession(page);
const ready = () => page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'), null, { timeout: 120000, polling: 100 });
try {
  await page.goto(`${base}/?flight=stock-kestrel`); await ready(); await page.waitForTimeout(1000);
  const cycle = () => page.evaluate(() => window.__benchCycle());

  await cdp.send('HeapProfiler.enable');
  let chunks = [];
  cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
  const takeSnapshot = async () => {
    await page.waitForTimeout(1500);
    await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
    chunks = [];
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
    return JSON.parse(chunks.join(''));
  };
  // Aggregate (count, self size) per node type+name.
  const census = (sn) => {
    const mm = sn.snapshot.meta; const f = mm.node_fields.length; const T = mm.node_fields.indexOf('type'), NM = mm.node_fields.indexOf('name'), SZ = mm.node_fields.indexOf('self_size');
    const out = new Map();
    for (let i = 0; i < sn.nodes.length; i += f) { const t = mm.node_types[0][sn.nodes[i + T]]; let n = sn.strings[sn.nodes[i + NM]]; if (t === 'string' || t === 'concatenated string' || t === 'sliced string') n = '(string)'; else if (t === 'code') n = `(code) ${String(n).slice(0, 50)}`; const k = `${t}:${String(n).slice(0, 70)}`; const e = out.get(k) ?? [0, 0]; e[0]++; e[1] += sn.nodes[i + SZ]; out.set(k, e); }
    return out;
  };
  let before = null;
  if (args.diff) { for (let i = 0; i < +(args.warm ?? 2); i++) await cycle(); before = census(await takeSnapshot()); }
  for (let i = 0; i < N; i++) await cycle();
  const snap = await takeSnapshot();
  if (before) {
    const after = census(snap); const rows = [];
    for (const [k, [c, sz]] of after) { const b = before.get(k) ?? [0, 0]; rows.push([k, c - b[0], sz - b[1]]); }
    console.log(`heap census delta over ${N} cycles (top by bytes):`);
    for (const [k, dc, ds] of rows.sort((a, b) => b[2] - a[2]).slice(0, 30)) console.log(`  ${(ds / 1024).toFixed(1).padStart(9)} kB  ${String(dc).padStart(7)}  ${k}`);
  }
  const m = snap.snapshot.meta; const nf = m.node_fields.length; const ef = m.edge_fields.length;
  const nodeTypes = m.node_types[0]; const edgeTypes = m.edge_types[0];
  const N_TYPE = m.node_fields.indexOf('type'), N_NAME = m.node_fields.indexOf('name'), N_EC = m.node_fields.indexOf('edge_count');
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
      out.push(`${name(parent[i]).slice(0, 50)}.${String(en).slice(0, 40)}`); i = parent[i];
    }
    return out.reverse().join(' → ');
  };
  const want = (args.find ?? 'Detached HTMLDivElement,FlightController,EditorView,WebGLRenderer,HubScene').split(',');
  for (const w of want) {
    const ids = []; for (let i = 0; i < count && ids.length < 400; i++) if (name(i) === w && (type(i) === 'object' || type(i) === 'native')) ids.push(i);
    const reach = ids.filter((i) => parent[i] !== -1);
    console.log(`\n${w}: ${ids.length} (${reach.length} strongly reachable)`);
    const seen = new Set();
    for (const i of reach) { const p = pathOf(i); const k = p.split(' → ').slice(-6).join(' → '); if (seen.has(k)) continue; seen.add(k); console.log(`  … ${p.split(' → ').slice(-(+(args.depth ?? 10))).join(' → ')}`); if (seen.size >= +(args.paths ?? 4)) break; }
  }
} finally { await context.close(); await browser.close().catch(() => {}); }
