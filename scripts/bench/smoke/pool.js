// gpu-passes.mjs --eval: summary of live trail particles in the flight pool (debug).
(() => {
  const f = window.__flight; let pool = null; f.scene.traverse((o) => { if (o.name === 'flight-particles') pool = o; });
  const g = pool.geometry.attributes, t = pool.material.uniforms.time.value, n = g.params.count;
  const live = []; for (let i = 0; i < n; i++) { const b = g.params.getX(i), life = g.params.getY(i); if (life > 0 && t >= b && t - b < life) live.push(i); }
  const trail = live.filter((i) => g.column.getW(i) > 0.5);
  const s = (i) => ({ i, age: +(t - g.params.getX(i)).toFixed(1), life: +g.params.getY(i).toFixed(1), size: +g.params.getZ(i).toFixed(1), growth: +g.params.getW(i).toFixed(2), a: +g.color.getW(i).toFixed(3), seg: +Math.hypot(g.segment.getX(i), g.segment.getY(i), g.segment.getZ(i)).toFixed(0), w: +g.segment.getW(i).toFixed(2) });
  const w = f.world, a = w.active; return { visible: pool.visible, live: live.length, trail: trail.length, alt: Math.round(w.universe.surfaceInfo(a.body, a.state.position, w.ut).heightAboveTerrain), engines: a.state.parts.filter((p) => p.engine && p.engine.thrust > 0).map((p) => p.def.id + ':' + Math.round(p.engine.thrust)), newest: trail.slice(-3).map(s), oldest: trail.slice(0, 3).map(s), sample: trail.filter((_, k) => k % 40 === 0).map(s) };
})()
