// Triangle / draw census of the flight scene (frustum-visible objects), grouped by the nearest named ancestor.
(() => {
  const f = window.__flight, sc = f.scene, cam = f.cam.camera;
  sc.updateMatrixWorld(true); cam.updateMatrixWorld(); cam.updateProjectionMatrix?.();
  const fr = new (f.scene.constructor.prototype.constructor === undefined ? Object : Object)();
  const THREE_Frustum = cam.constructor; // unused placeholder
  const proj = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
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
    const e = (groups[k] ??= { tris: 0, draws: 0, objs: 0, cast: 0 });
    e.tris += tris; e.draws++; e.objs++; if (o.castShadow) { e.cast += tris; shadowTris += tris; }
    total += tris; draws++;
  });
  const top = Object.entries(groups).sort((a, b) => b[1].tris - a[1].tris).slice(0, 30).map(([k, v]) => [k, Math.round(v.tris), v.draws, Math.round(v.cast)]);
  return { total: Math.round(total), draws, shadowTris: Math.round(shadowTris), info: f.pipeline.stats, top };
})()
