// Upscale pass cost variants (fenced GPU timer over 20 renders, median of 5).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const f = window.__flight, p = f.pipeline, gl = p.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const sc = f.scene, cam = f.cam.camera, px = new Uint8Array(4);
  const parked = p.gpuTimer; p.gpuTimer = null;
  const bench = async () => {
    p.render(sc, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    for (let i = 0; i < 20; i++) p.render(sc, cam);
    gl.endQuery(ext.TIME_ELAPSED_EXT); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let k = 0; k < 100 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await sleep(5);
    const v = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / 20; gl.deleteQuery(q); return v;
  };
  const fenced = async () => { const a = []; for (let i = 0; i < 5; i++) a.push(await bench()); return +med(a).toFixed(3); };
  const u = p.upscalePass.uniforms; const s0 = u.uSharpness.value, f0 = u.uFlat.value;
  const out = { full: await fenced() };
  u.uSharpness.value = 0; out.noSharpen = await fenced(); u.uSharpness.value = s0;
  u.uFlat.value = 1e9; out.allBilinear = await fenced();
  u.uFlat.value = 0; out.allFull = await fenced(); u.uFlat.value = f0;
  p.upscalePass.enabled = false; out.noPass = await fenced(); p.upscalePass.enabled = true;
  p.gpuTimer = parked;
  return out;
})()
