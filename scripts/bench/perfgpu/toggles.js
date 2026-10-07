// Fenced GPU cost (timer query over 20 renders, median of 5) with object groups hidden.
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
  const site = []; sc.traverse((o) => { if (o.name === 'launchSite') site.push(o); });
  const siteRoot = site[0];
  const under = (o, root) => { for (let x = o; x; x = x.parent) if (x === root) return true; return false; };
  const meshes = []; sc.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine) meshes.push(o); });
  const isVeg = (o) => /site:(pines|scrub)/.test(o.name);
  const groups = {
    siteNoVeg: meshes.filter((o) => siteRoot && under(o, siteRoot) && !isVeg(o)),
    vegetation: meshes.filter(isVeg),
    vessel: meshes.filter((o) => (o.material?.isMeshStandardMaterial || o.material?.isMeshPhysicalMaterial) && !(siteRoot && under(o, siteRoot))),
  };
  const out = { full: await fenced(), counts: {} };
  for (const [k, list] of Object.entries(groups)) {
    out.counts[k] = list.length;
    const was = list.map((o) => o.visible); list.forEach((o) => (o.visible = false));
    out[k] = +(out.full - (await fenced())).toFixed(3);
    list.forEach((o, i) => (o.visible = was[i]));
  }
  // Shadow map without vegetation casters.
  const veg = groups.vegetation; const cast = veg.map((o) => o.castShadow); veg.forEach((o) => (o.castShadow = false));
  out.vegShadows = +(out.full - (await fenced())).toFixed(3); veg.forEach((o, i) => (o.castShadow = cast[i]));
  p.gpuTimer = parked;
  return out;
})()
