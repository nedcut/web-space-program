(async () => {
  const f = window.__flight, p = f.pipeline, r = p.renderer;
  const counts = {}; let shadow = false;
  const orig = r.renderBufferDirect.bind(r);
  const sm = r.shadowMap, origSm = sm.render.bind(sm);
  sm.render = (...a) => { shadow = true; try { return origSm(...a); } finally { shadow = false; } };
  r.renderBufferDirect = (cam, scene, geo, mat, obj, group) => {
    let n = obj.name || obj.parent?.name || '';
    if (!n) { const u = mat.uniforms ?? {}; n = u.uRockColor ? 'terrain' : u.uCenters ? 'scatter' : u.uSeabed ? 'ocean' : u.uSunAngularRadius ? 'sky' : mat.type; }
    n = /^\d+\//.test(n) ? 'chunk:' + (mat.uniforms?.uRockColor ? 'terrain' : mat.uniforms?.uSeabed ? 'ocean' : mat.uniforms?.uCenters ? 'scatter' : mat.type) : n.replace(/[-:]\d+.*$/, '').replace(/\d+$/, ''); if (n === 'ShaderMaterial') n += ':' + Object.keys(mat.uniforms ?? {}).slice(0, 3).join('/');
    const k = (shadow ? 'SHADOW ' : '') + n + (obj.isInstancedMesh ? ' [inst]' : '');
    counts[k] = (counts[k] ?? 0) + 1;
    return orig(cam, scene, geo, mat, obj, group);
  };
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  const c0 = JSON.parse(JSON.stringify(counts)); for (const k in counts) counts[k] = 0;
  const rr = r.render.bind(r); let renders = 0; r.render = (...a) => { renders++; return rr(...a); };
  const gl = r.getContext(); let de = 0; const odE = gl.drawElements.bind(gl), odA = gl.drawArrays.bind(gl), odEI = gl.drawElementsInstanced.bind(gl), odAI = gl.drawArraysInstanced.bind(gl);
  gl.drawElements = (...a) => { de++; return odE(...a); }; gl.drawArrays = (...a) => { de++; return odA(...a); }; gl.drawElementsInstanced = (...a) => { de++; return odEI(...a); }; gl.drawArraysInstanced = (...a) => { de++; return odAI(...a); };
  await new Promise(res => requestAnimationFrame(res));
  r.render = rr; delete gl.drawElements; delete gl.drawArrays; delete gl.drawElementsInstanced; delete gl.drawArraysInstanced;
  r.renderBufferDirect = orig; sm.render = origSm;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { total, renders, glDraws: de, statsCalls: p.stats.calls, top: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40) };
})()
