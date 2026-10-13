// gpu-passes.mjs --eval: GPU cost of the flight particle draw per camera view (fenced, particles shown minus hidden).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const f = window.__flight, p = f.pipeline, gl = p.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  let pool = null; f.scene.traverse((o) => { if (o.name === 'flight-particles') pool = o; });
  const px = new Uint8Array(4); const parked = p.gpuTimer; p.gpuTimer = null;
  const bench = async (n = 20) => {
    p.render(f.scene, f.cam.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    for (let i = 0; i < n; i++) p.render(f.scene, f.cam.camera);
    gl.endQuery(ext.TIME_ELAPSED_EXT); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let k = 0; k < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await sleep(5);
    const v = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / n; gl.deleteQuery(q); return v;
  };
  const fenced = async () => { const a = []; for (let i = 0; i < 5; i++) a.push(await bench()); return med(a); };
  const c = f.cam, out = { visible: pool?.visible };
  const views = {
    default: () => {},
    chase: () => { c.mode = 'chase'; c.yaw = Math.PI; c.pitch = 0.12; c.distance = 45; },
    side: () => { c.mode = 'auto'; c.yaw = Math.PI * 0.5; c.pitch = 0.05; c.distance = 160; },
    far: () => { c.mode = 'auto'; c.yaw = Math.PI * 0.6; c.pitch = -0.25; c.distance = 1200; },
    under: () => { c.mode = 'auto'; c.pitch = -1.3; c.distance = 120; },
  };
  for (const [k, set] of Object.entries(views)) {
    set(); f.paused = true; await sleep(800);
    const on = await fenced(); if (pool) pool.visible = false; const off = await fenced(); if (pool) pool.visible = true;
    out[k] = { on: +on.toFixed(3), particles: +(on - off).toFixed(3) };
  }
  p.gpuTimer = parked;
  return out;
})()
