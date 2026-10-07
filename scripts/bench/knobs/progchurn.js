(async () => {
  const f = window.__flight, p = f.pipeline, r = p.renderer, sc = f.scene;
  const counts = new Map();
  const mats = new Map(); sc.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m && !mats.has(m) && mats.set(m, o)); });
  for (const [m, o] of mats) {
    const orig = m.customProgramCacheKey;
    m.customProgramCacheKey = function () { counts.set(m, (counts.get(m) ?? 0) + 1); return orig.call(this); };
  }
  const props = new Map(); for (const m of mats.keys()) { const pr = r.properties.get(m); props.set(m, { v: pr.__version, lsv: pr.lightsStateVersion, tm: pr.toneMapping, cs: pr.outputColorSpace, env: pr.envMap, rs: pr.receiveShadow, inst: pr.instancing, fog: pr.fog }); }
  const frames0 = f.framesRendered;
  await new Promise(res => setTimeout(res, 2000));
  const frames = f.framesRendered - frames0;
  const out = { frames, total: 0, top: [] };
  for (const [m, n] of counts) out.total += n;
  out.top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([m, n]) => {
    const o = mats.get(m), pr = r.properties.get(m), was = props.get(m);
    return { perFrame: +(n / frames).toFixed(2), type: m.type, name: m.name || o.name || o.parent?.name, uni: Object.keys(m.uniforms ?? {}).slice(0, 3).join('/'),
      changed: Object.entries({ v: pr.__version !== was.v || m.version, lsv: pr.lightsStateVersion !== was.lsv, tm: pr.toneMapping, cs: pr.outputColorSpace, env: pr.envMap !== was.env, rs: pr.receiveShadow, objRs: o.receiveShadow, inst: pr.instancing, isInst: !!o.isInstancedMesh, needsLights: pr.needsLights }).map(([k, v]) => `${k}=${v}`).join(' ') };
  });
  out.nMats = mats.size; out.lightsVersion = r.properties ? undefined : 0;
  for (const [m] of mats) delete m.customProgramCacheKey;
  return out;
})()
