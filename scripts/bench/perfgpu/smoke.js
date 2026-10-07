// Functional smoke check of the resolution plan in a running flight: live Retina-level changes, map mode, capture.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const g = window.__game, f = window.__flight, p = f.pipeline, gl = p.renderer.getContext();
  const set = (adv) => g.set((s) => ({ settings: { ...s.settings, advancedGraphics: { ...s.settings.advancedGraphics, ...adv }, graphicsCustom: true } }));
  const snap = (tag) => ({ tag, canvas: [p.renderer.domElement.width, p.renderer.domElement.height], internal: +p.pixelRatio.toFixed(3), output: +p.outputPixelRatio.toFixed(3), upscaling: p.upscaling, lod: +p.lodViewportHeight.toFixed(1) });
  const out = [snap('default')];
  for (const level of ['quality', 'performance', 'native', 'balanced']) { set({ upscale: level }); await sleep(600); out.push(snap(level)); }
  f.toggleMap(); await sleep(800); out.push(snap('map')); f.toggleMap(); await sleep(800); out.push(snap('back'));
  const c = p.capture(f.scene, f.cam.camera, 1); out.push({ tag: 'capture', size: [c.width, c.height] });
  out.push({ glError: gl.getError(), upscaleProgram: !!p.renderer.info.programs.find((x) => x.name === 'EdgeUpscale') });
  return out;
})()
