(() => {
  const f = window.__flight, p = f.pipeline, sc = f.scene, cam = f.cam.camera, gl = p.renderer.getContext(), px = new Uint8Array(4);
  const run = (n) => { p.render(sc, cam); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px); const t = performance.now(); for (let i = 0; i < n; i++) p.render(sc, cam); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px); return (performance.now() - t) / n; };
  const med = () => { const a = [run(30), run(30), run(30), run(30), run(30), run(30), run(30)].sort((x, y) => x - y); return a[3]; };
  const mats = new Set(); sc.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); });
  const terrain = [...mats].filter(m => m.uniforms && m.uniforms.uRockColor);
  const u = [...mats].map(m => m.uniforms && m.uniforms.uEarthImagery).find(Boolean);
  const out = { full: +med().toFixed(3) };
  if (u) { u.value = 0; out.imageryOff = +med().toFixed(3); u.value = 1; }
  terrain.forEach(m => m.visible = false); out.noTerrain = +med().toFixed(3); terrain.forEach(m => m.visible = true);
  const tris = (() => { let n = 0; sc.traverse(o => { if (o.isMesh && o.visible && o.material && o.material.uniforms && o.material.uniforms.uRockColor) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return n; })();
  out.terrainTris = tris;
  return out;
})()
