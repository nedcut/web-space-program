(async () => {
  const f = window.__flight, p = f.pipeline, sc = f.scene, cam = f.cam.camera, gl = p.renderer.getContext();
  const px = new Uint8Array(4);
  const bench = (n = 20) => {
    p.render(sc, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) p.render(sc, cam);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return (performance.now() - t0) / n;
  };
  const med = () => { const a = [bench(), bench(), bench(), bench(), bench()].sort((x, y) => x - y); return +a[2].toFixed(2); };
  const out = {};
  out.pr = p.pixelRatio; out.full = med();
  const d = (v) => +(out.full - v).toFixed(2);
  for (const [k, pass] of [['bloom', p.bloomPass], ['smaa', p.smaaPass]]) if (pass) { pass.enabled = false; out[k] = d(med()); pass.enabled = true; }
  const sm = p.renderer.shadowMap; sm.autoUpdate = false; out.shadowMap = d(med()); sm.autoUpdate = true;
  const mats = new Set(); sc.traverse(o => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) (Array.isArray(o.material) ? o.material : [o.material]).forEach(x => x && mats.add(x)); });
  const U = (m) => m.uniforms ?? {};
  const groups = {
    terrain: m => U(m).uRockColor, ocean: m => U(m).uSeabed, farSphere: m => U(m).uHasMap && U(m).uFallback,
    sky: m => U(m).uSunAngularRadius, clouds: m => U(m).uCamCCloud, volumes: m => U(m).uExtent, scatter: m => U(m).uCenters,
    partsPBR: m => (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) && !m.customProgramCacheKey?.toString().includes('aerial'),
    siteAerial: m => m.customProgramCacheKey?.toString().includes('aerial'),
    plumes: m => U(m).uCoreAmp || U(m).uHaze || U(m).uDiaWidth,
    stars: m => U(m).uGC || /star|milky/i.test(m.name ?? ''), glare: m => U(m).uAspect && U(m).uSun,
    otherBasic: m => m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isLineBasicMaterial,
  };
  const claimed = new Set(); out.counts = {};
  for (const [k, pred] of Object.entries(groups)) {
    const ms = [...mats].filter(m => !claimed.has(m) && pred(m)); ms.forEach(m => claimed.add(m));
    if (!ms.length) continue; out.counts[k] = ms.length; ms.forEach(m => m.visible = false); out[k] = d(med()); ms.forEach(m => m.visible = true);
  }
  const rest = [...mats].filter(m => !claimed.has(m)); rest.forEach(m => m.visible = false); out.otherShader = d(med()); out.otherNames = [...new Set(rest.map(m => m.type + ':' + Object.keys(U(m)).slice(0, 3).join('/')))].slice(0, 16); rest.forEach(m => m.visible = true);
  [...mats].forEach(m => m.visible = false); out.emptyScenePost = med(); [...mats].forEach(m => m.visible = true);
  return out;
})()
