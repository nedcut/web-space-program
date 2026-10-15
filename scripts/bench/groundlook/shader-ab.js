/* global window, setTimeout */
// gpu-passes.mjs --eval: requires window.__groundlookBaseline and window.__groundlookVertex (baseline terrain sources).
// Alternates shaders in one frozen scene, avoiding scene setup and clock differences between builds.
(async () => {
  const f = window.__flight, p = f.pipeline, r = p.renderer, gl = r.getContext();
  const materials = new Set();
  f.scene.traverse(o => { for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
    if (m.uniforms?.uEarthDay && m.uniforms?.uRockBlend) materials.add(m);
  } });
  const originals = new Map([...materials].map(m => [m, { fragment: m.fragmentShader, vertex: m.vertexShader }]));
  if (!materials.size || !window.__groundlookBaseline || !window.__groundlookVertex) throw Error('Terrain shader pair is missing');
  const timer = p.gpuTimer; p.gpuTimer = null;
  const paused = f.paused; f.paused = true;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) throw Error('GPU timer unavailable');
  const px = new Uint8Array(4), results = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const draw = () => p.render(f.scene, f.cam.camera);
  window.__perf.reset(); window.__perf.enabled = true;
  try {
    for (const version of ['before','after','after','before','before','after']) {
      for (const m of materials) {
        m.fragmentShader = version === 'before' ? window.__groundlookBaseline : originals.get(m).fragment;
        m.vertexShader = version === 'before' ? window.__groundlookVertex : originals.get(m).vertex;
        m.needsUpdate = true;
      }
      for (let i=0;i<12;i++) draw();
      await sleep(500);
      window.__perf.reset();
      await sleep(1500);
      const f8 = window.__perf.summary();
      const samples = [];
      for (let j=0;j<5;j++) {
        draw(); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT,q);
        for (let i=0;i<30;i++) draw();
        gl.endQuery(ext.TIME_ELAPSED_EXT); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
        for (let k=0;k<200&&!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE);k++) await sleep(5);
        if (!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE) || gl.getParameter(ext.GPU_DISJOINT_EXT)) throw Error('GPU query invalid');
        samples.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6/30); gl.deleteQuery(q);
      }
      results.push({version,samples,f8});
    }
    return {results, region: [...materials][0].uniforms.uEarthRegionOn.value};
  } finally {
    for (const m of materials) { m.fragmentShader = originals.get(m).fragment; m.vertexShader = originals.get(m).vertex; m.needsUpdate = true; }
    f.paused = paused; p.gpuTimer = timer;
  }
})()
