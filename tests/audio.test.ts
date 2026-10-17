import { game } from '../src/game/store';
import { describe, expect, it, vi } from 'vitest';
import { GameAudio, engineLoudness, windGain, transonicBuffeting, distanceGain, dopplerPitch, selectTheme, crossfadeSchedule, type AudioState } from '../src/audio';

const state: AudioState = {
  engines: [{ type: 'kerolox', thrustFraction: 1, count: 2 }],
  ambientPressure: 101325, airspeed: 340, mach: 1, dynamicPressure: 30000,
  rcsActive: 1, reentryHeat: 0.5, inMapView: false, timeWarp: 1, cameraDistance: 10,
};

describe('GameAudio without Web Audio', () => {
  it('constructs and exposes every operation safely in Node, including after disposal', () => {
    expect(globalThis.AudioContext).toBeUndefined();
    const audio = new GameAudio();
    const exercise = () => {
      audio.resume();
      for (const volume of [0, 0.5, 1, -1, NaN]) audio.setMasterVolume(volume);
      audio.update(state);
      audio.update({ ...state, ambientPressure: 0, inMapView: true, timeWarp: 100 });
      audio.staging(); audio.decouple(); audio.explosion(10); audio.chuteDeploy();
      audio.docking(); audio.partAttach(); audio.silenceFlight(); audio.legDeploy(); audio.uiClick(); audio.uiHover(); audio.warning(); audio.touchdown(5);
      audio.setMusic('menu'); audio.setMusic('space'); audio.setMusic('off');
    };
    expect(exercise).not.toThrow();
    expect(() => { audio.dispose(); audio.dispose(); }).not.toThrow();
    expect(exercise).not.toThrow();
  });
});

describe('audio amplitude helpers', () => {
  it('engine loudness is bounded and increases with thrust and pressure', () => {
    for (const pressure of [0, 1000, 20000, 101325, 200000]) {
      const amplitudes = [0, 0.1, 0.4, 0.8, 1, 2].map(t => engineLoudness(t, pressure));
      expect(amplitudes).toEqual([...amplitudes].sort((a, b) => a - b));
      for (const amplitude of amplitudes) { expect(amplitude).toBeGreaterThanOrEqual(0); expect(amplitude).toBeLessThanOrEqual(1); }
    }
    const pressures = [0, 1000, 20000, 101325, 200000].map(p => engineLoudness(1, p));
    expect(pressures).toEqual([...pressures].sort((a, b) => a - b));
    expect(engineLoudness(0, 101325)).toBe(0);
    expect(engineLoudness(1, 0)).toBeCloseTo(0.12);
    expect(engineLoudness(1, 101325)).toBe(1);
  });

  it('wind is silent at zero pressure and saturates monotonically', () => {
    const gains = [0, 1, 100, 1000, 18000, 100000, 1e12].map(windGain);
    expect(gains[0]).toBe(0);
    expect(gains).toEqual([...gains].sort((a, b) => a - b));
    for (const gain of gains) { expect(gain).toBeGreaterThanOrEqual(0); expect(gain).toBeLessThanOrEqual(1); }
    expect(gains.at(-1)).toBeCloseTo(1);
  });

  it('sanitizes negative and non-finite inputs', () => {
    for (const invalid of [-1, NaN, Infinity, -Infinity]) {
      expect(windGain(invalid)).toBe(0);
      expect(engineLoudness(invalid, 101325)).toBe(0);
      expect(engineLoudness(1, invalid)).toBeCloseTo(0.12);
    }
  });

  it('buffeting peaks around Mach one and remains bounded', () => {
    expect(transonicBuffeting(1)).toBe(1);
    expect(transonicBuffeting(0.9)).toBeCloseTo(transonicBuffeting(1.1));
    expect(transonicBuffeting(0.5)).toBeLessThan(0.001);
    expect(transonicBuffeting(2)).toBeLessThan(0.001);
    for (const mach of [-1, NaN, 0, 0.8, 1, 1.2, 10]) {
      expect(transonicBuffeting(mach)).toBeGreaterThanOrEqual(0);
      expect(transonicBuffeting(mach)).toBeLessThanOrEqual(1);
    }
  });
});

// A small Web Audio double exercises lifecycle and scheduling without audio hardware.
class Param {
  value = 0;
  targets: number[] = [];
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
  setTargetAtTime(value: number) { this.value = value; this.targets.push(value); }
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
  exponentialRampToValueAtTime(value: number) { this.value = value; }
}
class NodeDouble {
  playbackRate = new Param();
  gain = new Param(); frequency = new Param(); detune = new Param(); Q = new Param();
  pan = new Param(); attack = new Param(); release = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param();
  type = ''; loop = false; buffer: unknown;
  onended: (() => void) | null = null;
  stopped = false; disconnected = false;
  outputs = new Set<NodeDouble>();
  connect(node: NodeDouble) { this.outputs.add(node); return node; }
  disconnect() { this.disconnected = true; this.outputs.clear(); }
  start() {}
  stop() { this.stopped = true; }
}
class ContextDouble {
  static latest: ContextDouble;
  state = 'suspended'; currentTime = 1; sampleRate = 1000;
  destination = new NodeDouble(); nodes: NodeDouble[] = [];
  constructor() { ContextDouble.latest = this; }
  private node() { const node = new NodeDouble(); this.nodes.push(node); return node; }
  createWaveShaper() { return this.node(); }
  createStereoPanner() { return this.node(); }
  createGain() { return this.node(); }
  createDynamicsCompressor() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createConvolver() { return this.node(); }
  createBufferSource() { return this.node(); }
  createOscillator() { return this.node(); }
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (channel: number) => data[channel] };
  }
  async suspend() { this.state = 'suspended'; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}

describe('Web Audio lifecycle', () => {
  it('switches and stops music when cancelAndHoldAtTime is unavailable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Param.prototype, 'cancelAndHoldAtTime')!;
    Object.defineProperty(Param.prototype, 'cancelAndHoldAtTime', { ...descriptor, value: undefined });
    vi.stubGlobal('AudioContext', ContextDouble);
    const audio = new GameAudio();
    try {
      audio.setMusic('menu');
      audio.resume();
      const ctx = ContextDouble.latest;
      const graphSize = ctx.nodes.length;
      await Promise.resolve();
      const outgoing = ctx.nodes.slice(graphSize).filter(node => node.type === 'sine');
      expect(outgoing.length).toBeGreaterThan(0);
      const initial = ctx.nodes.length;
      expect(() => audio.setMusic('spaceCenter')).not.toThrow();
      expect(outgoing.every(node => node.stopped)).toBe(true);
      expect(ctx.nodes.length).toBeGreaterThan(initial);
      expect(() => audio.setMusic('off')).not.toThrow();
    } finally {
      audio.dispose();
      vi.unstubAllGlobals();
      Object.defineProperty(Param.prototype, 'cancelAndHoldAtTime', descriptor);
    }
  });

  it('does not create audio before a gesture and retains the requested theme', () => {
    const construct = vi.fn();
    vi.stubGlobal('AudioContext', class extends ContextDouble { constructor() { super(); construct(); } });
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false } });
    const audio = new GameAudio();
    try {
      audio.setMusic('saturn'); audio.update(state); audio.uiHover(); audio.resume();
      expect(construct).not.toHaveBeenCalled();
      vi.stubGlobal('navigator', { userActivation: { hasBeenActive: true } });
      audio.resume();
      expect(construct).toHaveBeenCalledTimes(1);
      expect(ContextDouble.latest.nodes[4].gain.value).toBeGreaterThan(0);
      audio.resume();
      expect(construct).toHaveBeenCalledTimes(1);
    } finally { audio.dispose(); vi.unstubAllGlobals(); }
  });

  it('applies master/music/effects settings live, including menu effects, and unsubscribes', () => {
    vi.stubGlobal('AudioContext', ContextDouble);
    const original = game.get().settings;
    let audio: GameAudio | undefined;
    try {
      game.set({ settings: { ...original, masterVolume: 0.4, musicVolume: 0.5, sfxVolume: 0.25 } });
      audio = new GameAudio();
      audio.resume();
      const ctx = ContextDouble.latest;
      const [master, , effects, , music] = ctx.nodes;
      expect(master.gain.value).toBeCloseTo(0.4);
      expect(effects.gain.value).toBeCloseTo(0.25);
      audio.setMusic('menu');
      expect(music.gain.value).toBeCloseTo(0.06);
      game.set({ settings: { ...game.get().settings, musicVolume: 0, sfxVolume: 0 } });
      expect(effects.gain.value).toBe(0); expect(music.gain.value).toBe(0);
      audio.update({ ...state, inMapView: true });
      game.set({ settings: { ...game.get().settings, sfxVolume: 0.5 } });
      expect(effects.gain.value).toBeCloseTo(0.09);
      audio.dispose();
      const count = master.gain.targets.length;
      game.set({ settings: original });
      expect(master.gain.targets).toHaveLength(count);
    } finally { audio?.dispose(); game.set({ settings: original }); vi.unstubAllGlobals(); }
  });

  it('resumes on gesture, reuses flight voices, schedules music and cleans up all nodes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('AudioContext', ContextDouble);
    let audio: GameAudio | undefined;
    try {
      audio = new GameAudio();
      audio.resume();
      const ctx = ContextDouble.latest;
      expect(ctx.state).toBe('running');
      audio.setMusic('menu');
      audio.resume();
      await Promise.resolve();
      await Promise.resolve();
      expect(ctx.state).toBe('running');
      const initial = ctx.nodes.length;
      for (let frame = 0; frame < 200; frame++) audio.update({ ...state, rcsActive: 0 });
      expect(ctx.nodes.length).toBe(initial);
      expect(ctx.nodes.some(node => node.gain.targets.length > 0)).toBe(true);
      audio.staging(); audio.decouple(); audio.explosion(2); audio.chuteDeploy();
      audio.legDeploy(); audio.uiClick(); audio.uiHover(); audio.warning(); audio.touchdown(3);
      audio.update(state);
      audio.setMusic('space');
      vi.advanceTimersByTime(6000);
      audio.setMusic('off');
      const stoppedMusicCount = ctx.nodes.length;
      vi.advanceTimersByTime(12000);
      expect(ctx.nodes.length).toBe(stoppedMusicCount);
      audio.dispose();
      expect(ctx.state).toBe('closed');
      expect(ctx.nodes.every(node => node.disconnected)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      audio.resume(); audio.update(state); audio.uiClick(); audio.setMusic('menu');
      expect(ctx.nodes.length).toBe(stoppedMusicCount);
    } finally {
      audio?.dispose();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('goes silent instead of throwing when a Web Audio call fails mid-game', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ramp = Param.prototype.linearRampToValueAtTime;
    vi.stubGlobal('AudioContext', ContextDouble);
    let audio: GameAudio | undefined;
    try {
      audio = new GameAudio();
      audio.resume();
      audio.setMusic('menu');
      Param.prototype.linearRampToValueAtTime = () => { throw new Error('unsupported automation'); };
      expect(() => { audio!.setMusic('space'); vi.advanceTimersByTime(5000); audio!.update(state); audio!.uiClick(); audio!.staging(); }).not.toThrow();
      expect(ContextDouble.latest.state).toBe('closed');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      Param.prototype.linearRampToValueAtTime = ramp;
      audio?.dispose(); warn.mockRestore();
      vi.unstubAllGlobals(); vi.useRealTimers();
    }
  });

  it('remains safe when a browser denies context creation', () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('unavailable'); } });
    try {
      const audio = new GameAudio();
      expect(() => { audio.resume(); audio.update(state); audio.setMusic('menu'); audio.dispose(); }).not.toThrow();
    } finally { vi.unstubAllGlobals(); }
  });
});


describe('spatial mix and location themes', () => {
  it('attenuates with distance and sanitizes invalid input', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(100)).toBeCloseTo(1 / Math.sqrt(2));
    expect(distanceGain(10000)).toBeLessThan(distanceGain(100));
    for (const v of [-10, NaN, Infinity]) expect(distanceGain(v)).toBe(1);
  });
  it('shifts approaching/receding sources, with no acoustic doppler in vacuum', () => {
    expect(dopplerPitch(-100, 101325)).toBeGreaterThan(1);
    expect(dopplerPitch(100, 101325)).toBeLessThan(1);
    expect(dopplerPitch(100, 0)).toBe(1);
    for (const v of [-1e9, 1e9, NaN, Infinity]) {
      expect(dopplerPitch(v, 101325)).toBeGreaterThanOrEqual(0.7);
      expect(dopplerPitch(v, 101325)).toBeLessThanOrEqual(1.4);
    }
  });
  it('chooses Saturn for its menu portrait and distinct local themes with danger priority', () => {
    expect(selectTheme({ scene: 'menu' })).toBe('saturn');
    expect(selectTheme({ scene: 'spaceCenter' })).toBe('spaceCenter');
    expect(selectTheme({ bodyId: 'enceladus', parentId: 'saturn' })).toBe('saturn');
    expect(selectTheme({ bodyId: 'titan', parentId: 'saturn' })).toBe('titan');
    for (const [bodyId, theme] of [['earth', 'earthOrbit'], ['moon', 'moon'], ['sun', 'cruise'], ['saturn', 'saturn'], ['titan', 'titan']] as const) {
      expect(selectTheme({ scene: 'flight', bodyId })).toBe(theme);
      expect(selectTheme({ scene: 'flight', bodyId, landing: true })).toBe('tense');
      expect(selectTheme({ bodyId, reentryHeat: 0.8 })).toBe('tense');
    }
  });
  it('schedules interruptible, bounded fades at finite increasing times', () => {
    expect(crossfadeSchedule(10, 3, 0.35, 1)).toEqual([{ time: 10, gain: 0.35 }, { time: 13, gain: 1 }]);
    const points = crossfadeSchedule(NaN, -1, Infinity, 5);
    expect(points).toEqual([{ time: 0, gain: 0 }, { time: 0.02, gain: 1 }]);
  });
});


describe('alarm tones', () => {
  it('sound only for alerts on the HUD banner: cautions once, warnings every 8 s', async () => {
    vi.stubGlobal('AudioContext', ContextDouble);
    const audio = new GameAudio();
    try {
      audio.resume(); await Promise.resolve(); await Promise.resolve();
      const ctx = ContextDouble.latest;
      const beeps: number[] = [];
      vi.spyOn(audio as unknown as { tone: (f: number) => void }, 'tone').mockImplementation((f: number) => { beeps.push(f); });
      const quiet: AudioState = { ...state, vesselId: 'v', reentryHeat: 0, gForce: 8, terrainDanger: true };
      const at = (t: number, alerts: AudioState['alerts']) => { ctx.currentTime = t; beeps.length = 0; audio.update({ ...quiet, alerts }); return beeps.length / 2; };
      // High g and terrain inputs alone, with nothing on the banner, stay silent.
      expect(at(1, [])).toBe(0);
      expect(at(20, [])).toBe(0);
      const caution = [{ id: 'g', level: 'warn' as const }];
      expect(at(21, caution)).toBe(1);
      expect(at(40, caution)).toBe(0);
      expect(at(41, [])).toBe(0);
      expect(at(42, caution)).toBe(1);
      const warning = [{ id: 'heat', level: 'bad' as const }];
      expect(at(50, warning)).toBe(1);
      expect(at(55, warning)).toBe(0);
      expect(at(58.1, warning)).toBe(1);
      // Alerts past the three the banner shows do not sound.
      const many = (['control', 'heat', 'g', 'fuel'] as const).map(id => ({ id, level: 'warn' as const }));
      expect(at(70, many)).toBe(3);
      expect(beeps).not.toContain(440);
    } finally { audio.dispose(); vi.unstubAllGlobals(); }
  });
});

describe('bounded upgraded audio', () => {
  it('runs every engine, mechanical layer and adaptive theme without per-frame node allocation', async () => {
    vi.stubGlobal('AudioContext', ContextDouble);
    const audio = new GameAudio();
    try {
      audio.resume(); await Promise.resolve(); await Promise.resolve();
      const ctx = ContextDouble.latest;
      const upgraded: AudioState = { ...state, vesselId: 'vessel', rcsActive: 0,
        engines: ['jet', 'afterburner', 'nuclear', 'aerospike', 'ion', 'monoprop', 'solid'].map(type => ({ type: type as AudioState['engines'][number]['type'], count: 4, size: 2, thrustFraction: 0.14 })),
        wheelSpeed: 12, chuteOpen: true, jetting: true, drilling: true,
        mechanicalState: '1:false', situation: { bodyId: 'saturn' }, cameraRadialVelocity: 100 };
      audio.update(upgraded);
      const baseline = ctx.nodes.length;
      for (let i = 0; i < 300; i++) audio.update(upgraded);
      expect(ctx.nodes.length).toBe(baseline);
      expect(ctx.nodes.some(n => n.playbackRate.targets.some(v => v < 1))).toBe(true);
      audio.update({ ...upgraded, mechanicalState: '1:true', walking: true,
        gForce: 8, terrainDanger: true, alerts: [{ id: 'terrain', level: 'bad' }, { id: 'g', level: 'warn' }] });
      expect(ctx.nodes.length).toBeGreaterThan(baseline);
      for (let i = 0; i < 500; i++) { audio.uiClick(); audio.setMusic(i % 2 ? 'titan' : 'saturn'); }
      const nodesWithSound = ctx.nodes.length;
      expect(nodesWithSound).toBeLessThanOrEqual(234);
      // End transient sources like a browser would, then confirm capacity is reusable.
      for (const node of [...ctx.nodes]) node.onended?.();
      audio.uiClick();
      expect(ctx.nodes.length).toBeGreaterThan(nodesWithSound);
    } finally { audio.dispose(); vi.unstubAllGlobals(); }
  });
  it('suspends while hidden and prevents synthesis until visible again', async () => {
    const listeners = new Map<string, () => void>();
    const documentDouble = { hidden: false, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
    vi.stubGlobal('document', documentDouble); vi.stubGlobal('AudioContext', ContextDouble);
    const audio = new GameAudio();
    try {
      audio.resume(); await Promise.resolve(); await Promise.resolve();
      const ctx = ContextDouble.latest;
      audio.setMusic('saturn');
      const initial = ctx.nodes.length;
      documentDouble.hidden = true; listeners.get('visibilitychange')!();
      expect(ctx.state).toBe('suspended');
      audio.update(state); audio.uiClick(); audio.resume();
      expect(ctx.nodes.length).toBe(initial);
      documentDouble.hidden = false; listeners.get('visibilitychange')!();
      await Promise.resolve(); await Promise.resolve();
      expect(ctx.state).toBe('running');
      audio.uiClick(); expect(ctx.nodes.length).toBeGreaterThan(initial);
      audio.dispose(); expect(listeners.size).toBe(0);
    } finally { audio.dispose(); vi.unstubAllGlobals(); }
  });
});

describe('sound polish regressions', () => {
  it('keeps UI independent of effects and reserves capacity for alarms', async () => {
    vi.stubGlobal('AudioContext', ContextDouble);
    const original = game.get().settings;
    const audio = new GameAudio();
    try {
      audio.resume(); await Promise.resolve();
      const ctx = ContextDouble.latest;
      game.set({ settings: { ...original, sfxVolume: 0, uiVolume: 0.3 } });
      expect(ctx.nodes[2].gain.value).toBe(0);
      expect(ctx.nodes[7].gain.value).toBeCloseTo(0.3);
      for (let i = 0; i < 200; i++) audio.explosion(10);
      const count = audio.diagnostics().nodes;
      expect(count).toBeLessThanOrEqual(210);
      audio.controlCue();
      expect(audio.diagnostics().nodes).toBe(count + 2);
      for (let i = 0; i < 100; i++) audio.controlCue();
      expect(audio.diagnostics().nodes).toBeLessThanOrEqual(234);
    } finally { audio.dispose(); game.set({ settings: original }); vi.unstubAllGlobals(); }
  });

  it('pausing suspends music and effects even after visibility changes or gestures', async () => {
    vi.useFakeTimers(); vi.stubGlobal('AudioContext', ContextDouble);
    const listeners = new Map<string, () => void>();
    const doc = { hidden: false, addEventListener: (n: string, f: () => void) => listeners.set(n, f), removeEventListener: (n: string) => listeners.delete(n) };
    vi.stubGlobal('document', doc);
    const audio = new GameAudio();
    try {
      audio.resume(); await Promise.resolve(); audio.setMusic('earthOrbit');
      audio.setPaused(true);
      const count = audio.diagnostics().nodes;
      doc.hidden = true; listeners.get('visibilitychange')!();
      doc.hidden = false; listeners.get('visibilitychange')!();
      audio.resume(); audio.uiClick(); audio.update(state); vi.advanceTimersByTime(30000);
      expect(ContextDouble.latest.state).toBe('suspended');
      expect(audio.diagnostics().nodes).toBe(count);
      expect(vi.getTimerCount()).toBe(0);
      audio.setPaused(false); await Promise.resolve();
      expect(ContextDouble.latest.state).toBe('running');
    } finally { audio.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); }
  });

  it('reclaims every transient across repeated scene transitions and fully disposes the pool', async () => {
    vi.stubGlobal('AudioContext', ContextDouble);
    const audio = new GameAudio();
    try {
      audio.resume(); await Promise.resolve();
      const baseline = audio.diagnostics();
      for (let scene = 0; scene < 30; scene++) {
        audio.update({ ...state, vesselId: `v${scene}` });
        audio.flameout(); audio.fairing(); audio.explosion(10); audio.missionComplete();
        audio.silenceFlight();
        for (const node of ContextDouble.latest.nodes) node.onended?.();
        expect(audio.diagnostics().nodes).toBe(baseline.nodes);
        expect(audio.diagnostics().sources).toBe(baseline.sources);
        expect(audio.diagnostics().transients).toBe(0);
      }
      audio.dispose();
      expect(audio.diagnostics()).toMatchObject({ nodes: 0, sources: 0, transients: 0, music: 0 });
    } finally { audio.dispose(); vi.unstubAllGlobals(); }
  });

  it('uses pre-contact descent speed for impacts and suppresses false transitions on vessel switch', async () => {
    vi.stubGlobal('AudioContext', ContextDouble);
    const audio = new GameAudio();
    try {
      audio.resume(); await Promise.resolve();
      const impact = vi.spyOn(audio, 'touchdown');
      audio.update({ ...state, vesselId: 'a', landed: false, verticalSpeed: -18 });
      audio.update({ ...state, vesselId: 'a', landed: true, verticalSpeed: 0 });
      expect(impact).toHaveBeenCalledWith(18);
      audio.update({ ...state, vesselId: 'b', landed: true });
      expect(impact).toHaveBeenCalledTimes(1);
    } finally { audio.dispose(); vi.unstubAllGlobals(); }
  });
});

it('plays warp and maneuver cues while physics sounds are suppressed on rails', async () => {
  vi.stubGlobal('AudioContext', ContextDouble);
  const audio = new GameAudio();
  try {
    audio.resume(); await Promise.resolve();
    const cue = vi.spyOn(audio, 'controlCue');
    audio.update({ ...state, vesselId: 'craft', timeWarp: 1 });
    audio.update({ ...state, vesselId: 'craft', timeWarp: 100, nodeCount: 1 });
    expect(cue).toHaveBeenCalledWith(true);
    audio.update({ ...state, vesselId: 'craft', timeWarp: 1, nodeCount: 1 });
    expect(cue).toHaveBeenLastCalledWith(false);
  } finally { audio.dispose(); vi.unstubAllGlobals(); }
});

it('reuses the event audio graphs through a destruction cascade and makes no sonic-boom voice for the pilot', async () => {
  vi.useFakeTimers(); vi.stubGlobal('AudioContext',ContextDouble);
  const audio=new GameAudio();
  try {
    audio.resume(); await Promise.resolve();
    const baseline=audio.diagnostics();
    for(let i=0;i<100;i++){audio.staging();audio.decouple(i%2?'solid':'decoupler');audio.fairing();audio.explosion(10);}
    expect(audio.diagnostics()).toEqual(baseline);
    vi.advanceTimersByTime(3000);
    audio.update({...state,engines:[],mach:.99,rcsActive:0});
    const before=audio.diagnostics().nodes;
    audio.update({...state,engines:[],mach:1.01,rcsActive:0});
    expect(audio.diagnostics().nodes).toBe(before);
  } finally { audio.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); }
});

it('keeps silent continuous layers out of the audio graph and reconnects them when they sound', async () => {
  vi.stubGlobal('AudioContext', ContextDouble);
  const audio = new GameAudio();
  try {
    audio.resume(); await Promise.resolve();
    const ctx = ContextDouble.latest;
    // Pooled layers are looping noise source -> filter -> gain; count the ones whose gain feeds the mix.
    const connected = () => ctx.nodes.filter(n => n.loop && [...n.outputs].some(f => [...f.outputs].some(g => g.outputs.size > 0))).length;
    expect(connected()).toBe(0);
    audio.update(state);
    const flying = connected();
    // Kerolox roar and rumble, wind, buffet and plasma: not the other engine types, mechanics or neighbours.
    expect(flying).toBe(5);
    const quiet: AudioState = { ...state, engines: [], ambientPressure: 0, dynamicPressure: 0, reentryHeat: 0, rcsActive: 0 };
    audio.update(quiet);
    expect(connected()).toBe(flying); // still fading out
    ctx.currentTime += 1;
    audio.update(quiet);
    expect(connected()).toBe(0);
    audio.update(state);
    expect(connected()).toBe(flying);
  } finally { audio.dispose(); vi.unstubAllGlobals(); }
});

it('builds the reverb impulse after the first gesture, not inside it', async () => {
  vi.useFakeTimers(); vi.stubGlobal('AudioContext', ContextDouble);
  const created = vi.spyOn(ContextDouble.prototype, 'createBuffer');
  const audio = new GameAudio();
  try {
    audio.resume();
    const stereo = () => created.mock.calls.filter(([channels]) => channels === 2).length;
    expect(stereo()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(stereo()).toBe(1);
  } finally { audio.dispose(); created.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); }
});
