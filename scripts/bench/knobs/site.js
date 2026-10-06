(async () => {
  const f = window.__flight, p = f.pipeline, sc = f.scene, cam = f.cam.camera, gl = p.renderer.getContext();
  const px = new Uint8Array(4);
  const bench = (n = 20) => { p.render(sc, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now(); for (let i = 0; i < n; i++) p.render(sc, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / n; };
  const med = () => { const a = [bench(), bench(), bench(), bench(), bench()].sort((x, y) => x - y); return +a[2].toFixed(2); };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const out = { full: med() };
  const meshes = []; f.site.root.traverse(o => { if (o.isMesh) meshes.push(o); });
  meshes.forEach(m => { m._rs = m.receiveShadow; m.receiveShadow = false; }); await wait(1500); med(); out.siteNoShadowRecv = +(out.full - med()).toFixed(2);
  meshes.forEach(m => { m.receiveShadow = m._rs; }); await wait(1500); med();
  const env = sc.environment; f.skyEnv.update = function () { return null; }; sc.environment = null; await wait(1500); med(); out.noEnvAll = +(out.full - med()).toFixed(2);
  out.glareVisible = f.glare.mesh.visible;
  out.glare = f.glare.mesh.geometry.type + ' ' + (f.glare.mesh.material.uniforms ? Object.keys(f.glare.mesh.material.uniforms).join('/') : '');
  return out;
})()
