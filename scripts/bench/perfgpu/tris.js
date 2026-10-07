// Triangle / draw census of the flight scene, grouped by the nearest named ancestor. Counts only objects whose
// world bounding sphere intersects the camera frustum (approximate cone test), as three would draw them.
(() => {
  const f = window.__flight, sc = f.scene, cam = f.cam.camera;
  sc.updateMatrixWorld(true); cam.updateMatrixWorld();
  const V = cam.position.constructor;
  const inv = cam.matrixWorldInverse, c = new V(), s = new V();
  const tanY = Math.tan((cam.fov * Math.PI) / 360), tanX = tanY * cam.aspect;
  const visible = (o) => {
    if (o.frustumCulled === false) return true;
    const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere?.();
    const bs = o.isInstancedMesh ? (o.boundingSphere ?? g.boundingSphere) : g.boundingSphere; if (!bs) return true;
    c.copy(bs.center).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
    s.setFromMatrixScale(o.matrixWorld); const r = bs.radius * Math.max(s.x, s.y, s.z);
    const z = -c.z; if (z < -r) return false;
    const kx = Math.sqrt(1 + tanX * tanX), ky = Math.sqrt(1 + tanY * tanY);
    return Math.abs(c.x) - tanX * z <= r * kx && Math.abs(c.y) - tanY * z <= r * ky;
  };
  const groups = {};
  const label = (o) => { const parts = []; for (let x = o; x && x !== sc; x = x.parent) if (x.name) parts.push(x.name); return parts.slice(0, 2).reverse().join('/') || (o.material?.type ?? o.type); };
  let total = 0, draws = 0, shadowTris = 0;
  sc.traverseVisible((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine)) return;
    const g = o.geometry; if (!g) return;
    let n = g.index ? g.index.count : g.attributes.position?.count ?? 0;
    if (g.drawRange && Number.isFinite(g.drawRange.count)) n = Math.min(n, g.drawRange.count);
    const inst = o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? (g.instanceCount ?? 1) : 1;
    const tris = o.isMesh ? (n / 3) * inst : 0;
    const k = label(o) + ' [' + (o.material?.type ?? '') + (o.material?.name ? ':' + o.material.name : '') + ']';
    const e = (groups[k] ??= { tris: 0, draws: 0, cast: 0 });
    if (o.castShadow) { e.cast += tris; shadowTris += tris; }
    if (!visible(o)) return;
    e.tris += tris; e.draws++; total += tris; draws++;
  });
  const top = Object.entries(groups).sort((a, b) => b[1].tris + b[1].cast - a[1].tris - a[1].cast).slice(0, 30).map(([k, v]) => [k, Math.round(v.tris), v.draws, Math.round(v.cast)]);
  return { total: Math.round(total), draws, shadowCasterTris: Math.round(shadowTris), info: f.pipeline.stats, top };
})()
