// Windows Chrome audio checks. Run with Windows node; AUDIO_PLAYWRIGHT can override the driver module.
// Each run owns a tab and leaves the shared browser running.
const { chromium } = await import(process.env.AUDIO_PLAYWRIGHT ?? 'file:///C:/wsp-tools/drv/node_modules/playwright-core/index.mjs');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = await browser.contexts()[0].newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto('http://localhost:5330/?flight=stock-meridian', { waitUntil: 'load' });
  await page.waitForTimeout(7000);
  await page.mouse.click(10, 10);
  const live = await page.evaluate(async () => {
    const { getGameAudio } = await import('/src/audio/ui.ts');
    const { game } = await import('/src/game/store.ts');
    const audio = getGameAudio(); audio.resume();
    const counts = [];
    for (const scene of ['menu', 'editor', 'menu', 'editor', 'menu']) {
      game.set({ scene });
      await new Promise(resolve => setTimeout(resolve, 1200));
      counts.push({ scene, ...audio.diagnostics() });
    }
    audio.setMusic('off'); audio.silenceFlight();
    await new Promise(resolve => setTimeout(resolve, 24000));
    const settled = audio.diagnostics();
    audio.setPaused(true);
    const paused = audio.diagnostics();
    audio.setPaused(false);
    return { counts, settled, paused };
  });
  console.log('LIVE', JSON.stringify(live));
  const rendered = await page.evaluate(async () => {
    const { GameAudio } = await import('/src/audio/index.ts');
    const { game } = await import('/src/game/store.ts');
    const settings = game.get().settings;
    game.set({ settings: { ...settings, masterVolume: 1, sfxVolume: 1, uiVolume: 1, musicVolume: 1 } });
    const RealContext = window.AudioContext;
    const results = [];
    const cases = ['kerolox', 'hydrolox', 'solid', 'monoprop', 'ion', 'jet', 'plasma', 'explosion', 'stress', 'music', 'overload'];
    try {
      for (const kind of cases) {
        const seconds = kind === 'music' ? 12 : 3;
        const offline = new OfflineAudioContext(2, 24000 * seconds, 24000);
        const proxy = new Proxy(offline, { get(target, key) {
          if (key === 'state') return 'running';
          if (key === 'resume' || key === 'suspend' || key === 'close') return () => Promise.resolve();
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
        window.AudioContext = function () { return proxy; };
        const audio = new GameAudio(); audio.resume();
        const state = { vesselId: 'probe', engines: [{ type: kind in { plasma: 1, explosion: 1, stress: 1, music: 1, overload: 1 } ? 'kerolox' : kind, thrustFraction: 1, count: 1 }],
          ambientPressure: 101325, airspeed: 340, mach: 1, dynamicPressure: 0, rcsActive: 0, reentryHeat: 0, inMapView: false, timeWarp: 1, cameraDistance: 15 };
        if (kind === 'plasma') { state.engines = []; state.dynamicPressure = 40000; state.reentryHeat = 1; }
        if (kind === 'stress') state.structuralStress = 0.95;
        if (kind === 'music') audio.setMusic('saturn');
        else if (kind === 'explosion') audio.explosion(10);
        else audio.update(state);
        if (kind === 'overload') for (let i = 0; i < 100; i++) { audio.explosion(10); audio.uiClick(); }
        const counts = audio.diagnostics();
        const buffer = await offline.startRendering();
        let peak = 0, sum = 0, invalid = 0;
        for (let channel = 0; channel < 2; channel++) for (const sample of buffer.getChannelData(channel)) {
          if (!Number.isFinite(sample)) invalid++;
          peak = Math.max(peak, Math.abs(sample)); sum += sample * sample;
        }
        audio.dispose();
        results.push({ kind, peak, rms: Math.sqrt(sum / (buffer.length * 2)), invalid, counts, disposed: audio.diagnostics() });
      }
    } finally { window.AudioContext = RealContext; game.set({ settings }); }
    return results;
  });
  console.log('OFFLINE', JSON.stringify(rendered));
  console.log('ERRORS', JSON.stringify(errors));
  if (errors.length || live.counts.some(c => c.nodes > 234) || live.settled.transients !== 0 || rendered.some(r => r.invalid || r.peak >= 1 || r.rms <= 0 || r.disposed.nodes !== 0)) process.exitCode = 1;
} finally { await page.close(); await browser.close(); }
