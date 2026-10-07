(() => {
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const S = 2048, N = 60000;
  const mk = () => { const c = document.createElement('canvas'); c.width = S; c.height = S; const g = c.getContext('2d'); g.fillStyle = '#a19e96'; g.fillRect(0, 0, S, S); return { c, g }; };
  const A = (g, r, a) => { for (let i = 0; i < N; i++) { const l = r() < 0.5 ? 50 : 200; g.fillStyle = `rgba(${l},${l},${l},${a * (0.4 + r())})`; g.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5); } };
  const B = (g, r, a) => { let cur = -1; for (let i = 0; i < N; i++) { const l = r() < 0.5 ? 50 : 200; if (l !== cur) { cur = l; g.fillStyle = l === 50 ? '#323232' : '#c8c8c8'; } g.globalAlpha = a * (0.4 + r()); g.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5); } g.globalAlpha = 1; };
  const out = {};
  const px = (c) => c.getContext('2d').getImageData(0, 0, S, S).data;
  for (const [k, f] of [['A', A], ['B', B], ['A2', A], ['B2', B]]) { const { c, g } = mk(); const t0 = performance.now(); f(g, rng(5), 0.1); px(c).length; out[k] = +(performance.now() - t0).toFixed(1); if (k === 'A') out.pa = px(c); if (k === 'B') out.pb = px(c); }
  let maxd = 0, sum = 0; for (let i = 0; i < out.pa.length; i++) { const d = Math.abs(out.pa[i] - out.pb[i]); maxd = Math.max(maxd, d); sum += d; }
  delete out.pa; delete out.pb; out.maxDiff = maxd; out.meanDiff = sum / (S * S * 4);
  return out;
})()
