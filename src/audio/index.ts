import { admitVoice, atmosphereColor, engineTransition, musicDuck } from './design';
import { crossfadeSchedule, distanceGain, dopplerPitch, selectTheme, THEMES, type MusicTheme, type MusicSituation } from './situation';
export { crossfadeSchedule, distanceGain, dopplerPitch, selectTheme } from './situation';
import { game } from '../game/store';
/** Procedural, offline audio. This module has no simulation or rendering dependencies. */
export type EngineType = 'kerolox' | 'hydrolox' | 'solid' | 'methalox' | 'ion' | 'monoprop' | 'jet' | 'afterburner' | 'nuclear' | 'aerospike';
export type MusicMode = MusicTheme | 'space' | 'off';
export interface AudioState {
  engines: { thrustFraction: number; type: EngineType; count: number; size?: number }[];
  ambientPressure: number;
  airspeed: number;
  mach: number;
  dynamicPressure: number;
  rcsActive: number;
  reentryHeat: number;
  inMapView: boolean;
  timeWarp: number;
  cameraDistance: number;
  cameraRadialVelocity?: number;
  situation?: MusicSituation;
  vesselId?: string;
  wheelSpeed?: number;
  chuteOpen?: boolean;
  walking?: boolean;
  jetting?: boolean;
  drilling?: boolean;
  mechanicalState?: string;
  landed?: boolean;
  fuelFraction?: number;
  temperatureFraction?: number;
  gForce?: number;
  terrainDanger?: boolean;
  noSignal?: boolean;
  structuralStress?: number;
  launchRumble?: number;
  verticalSpeed?: number;
  splashed?: boolean;
  sas?: boolean;
  rcs?: boolean;
  nodeCount?: number;
  completedMissions?: number;
  /** Camera-relative metres, already rotated into camera axes. Reuse entries. */
  neighbors?: readonly { x: number; y: number; z: number; thrust: number }[];
}

const positive = (v: number): number => Number.isFinite(v) ? Math.max(0, v) : 0;
const unit = (v: number): number => Math.min(1, positive(v));
const atmosphere = (pressure: number): number => Math.sqrt(unit(pressure / 101325));

/** Perceived engine amplitude, including a small structure-borne component in vacuum. */
export function engineLoudness(thrust: number, pressure: number): number {
  return Math.sqrt(unit(thrust)) * (0.12 + 0.88 * atmosphere(pressure));
}

/** Saturating aerodynamic noise amplitude; dynamic pressure already includes density. */
export function windGain(q: number): number {
  const pressure = positive(q);
  return Math.sqrt(pressure / (pressure + 18000));
}

/** Smooth transonic peak, with little buffeting well below/above Mach one. */
export function transonicBuffeting(mach: number): number {
  return Math.exp(-(((positive(mach) - 1) / 0.18) ** 2));
}

/** Gain below which a continuous layer counts as silent (-80 dB). */
const SILENT = 1e-4;

interface Layer { gain: GainNode; filter: BiquadFilterNode; source: AudioBufferSourceNode }
interface EventVoice { body: Layer; snap?: Layer; thump?: { source: OscillatorNode; gain: GainNode }; timer?: ReturnType<typeof setTimeout>; connected: boolean }
interface EngineVoice { previousThrust?: number; roar: Layer; rumble: Layer; crackle?: Layer; whine?: { source: OscillatorNode; gain: GainNode } }
type NoiseKind = 'white' | 'pink' | 'brown' | 'crackle';
// Includes persistent voices, theme buses, and temporary effect/music nodes.

const TIMBRE: Record<EngineType, { cutoff: number; rumble: number; gain: number }> = {
  nuclear: { cutoff: 1200, rumble: 42, gain: 0.5 },
  aerospike: { cutoff: 3300, rumble: 92, gain: 0.85 },
  kerolox: { cutoff: 2500, rumble: 65, gain: 1 },
  hydrolox: { cutoff: 3900, rumble: 85, gain: 0.82 },
  solid: { cutoff: 1900, rumble: 48, gain: 1.1 },
  methalox: { cutoff: 2900, rumble: 75, gain: 0.92 },
  ion: { cutoff: 850, rumble: 150, gain: 0.08 },
  monoprop: { cutoff: 4400, rumble: 120, gain: 0.28 },
  jet: { cutoff: 5200, rumble: 110, gain: 0.45 },
  afterburner: { cutoff: 2300, rumble: 60, gain: 0.9 },
};

export class GameAudio {
  private context?: AudioContext;
  private paused = false;
  private duck = 1;
  private previousSpeed = 0;
  private nextCreak = 0;
  private previousControls?: { sas?: boolean; rcs?: boolean; warp: number; nodes: number; missions: number };
  private transientNodes = new Map<AudioScheduledSourceNode, AudioNode[]>();
  private pyroCursor = 0;
  private pyroVoices: EventVoice[] = [];
  private explosionCursor = 0;
  private explosionVoices: EventVoice[] = [];
  private spatial: { layer: Layer; pan: StereoPannerNode }[] = [];
  private master?: GainNode;
  private effects?: GainNode;
  private interfaceGain?: GainNode;
  private effectsFilter?: BiquadFilterNode;
  private musicGain?: GainNode;
  private reverb?: ConvolverNode;
  private buffers = new Map<NoiseKind, AudioBuffer>();
  private voices = new Map<EngineType, EngineVoice>();
  private wind?: Layer;
  private buffet?: Layer;
  private plasma?: Layer;
  private sources = new Set<AudioScheduledSourceNode>();
  private nodes = new Set<AudioNode>();
  private musicSources = new Set<AudioScheduledSourceNode>();
  private musicTimer?: ReturnType<typeof setInterval>;
  private musicMode: MusicMode = 'off';
  private chord = 0;
  private themeBuses = new Map<MusicTheme, GainNode>();
  private musicDeadline = 0;
  private mechanics = new Map<string, Layer>();
  /** Continuous layers that leave the graph while silent (see `level`), keyed by their output gain. */
  private gates = new Map<GainNode, { to: AudioNode; open: boolean; quietUntil: number }>();
  private gateSweep: ReturnType<typeof setTimeout> | undefined;
  private warningTimes = new Map<string, number>();
  private previousMechanical?: string;
  private previousVessel?: string;
  private wasLanded = false;
  private nextStep = 0;
  private hidden = false;
  private tension?: GainNode;
  private nextThemeChange = 0;
  private visibility = () => {
    this.hidden = typeof document !== 'undefined' && document.hidden;
    if (this.hidden || this.paused) {
      if (this.musicTimer !== undefined) clearInterval(this.musicTimer);
      this.musicTimer = undefined;
      void this.context?.suspend().catch(() => {});
    } else {
      this.resume();
      if (this.musicMode !== 'off' && this.musicTimer === undefined) this.musicTimer = setInterval(() => this.pad(), 1000);
    }
  };
  private nextPuff = 0;
  private rcsWasActive = false;
  private disposed = false;
  private musicVolume = 1;
  private sfxVolume = 1;
  private effectsMix = 1;
  private unsubscribeSettings?: () => void;
  private applySettings = () => {
    const s = game.get().settings;
    this.setMasterVolume(s.masterVolume);
    this.musicVolume = unit(s.musicVolume);
    this.sfxVolume = unit(s.sfxVolume);
    if (this.effects) this.target(this.effects.gain, this.effectsMix * this.sfxVolume);
    if (this.interfaceGain) this.target(this.interfaceGain.gain, unit(s.uiVolume));
    if (this.musicGain) this.target(this.musicGain.gain, this.musicLevel());
  };
  constructor() {
    // Sound is optional. A Web Audio gap in one browser (Firefox has no cancelAndHoldAtTime, which once
    // blanked the whole app) or a driver failure must leave the game silent, never crash a scene: every
    // method, timer and listener callback below runs through this guard, which disposes the graph on a throw.
    const self = this as unknown as Record<string, unknown>;
    const names = [...Object.getOwnPropertyNames(GameAudio.prototype), 'visibility', 'applySettings'];
    for (const name of names) {
      if (name === 'constructor' || name === 'dispose') continue;
      const own = Object.getOwnPropertyDescriptor(this, name) ?? Object.getOwnPropertyDescriptor(GameAudio.prototype, name);
      const method = own?.value;
      if (typeof method !== 'function') continue;
      self[name] = (...args: unknown[]) => {
        try { return method.apply(this, args); } catch (error) { this.fail(error); return undefined; }
      };
    }
  }

  private fail(error: unknown): void {
    if (this.disposed) return;
    console.warn('Audio disabled after an error; the game continues silently.', error);
    try { this.dispose(); } catch { /* Best effort. */ }
  }

  private musicLevel() { return (this.musicMode === 'off' ? 0 : this.musicMode === 'menu' || this.musicMode === 'saturn' ? 0.12 : 0.085) * this.musicVolume * this.duck; }

  private initialize(): void {
    // Some browsers expose the prefixed constructor. Node deliberately has neither.
    const host = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Context = host.AudioContext ?? host.webkitAudioContext;
    if (!Context) return;
    try {
      const ctx = new Context();
      this.context = ctx;
      this.master = this.track(ctx.createGain());
      this.master.gain.value = 0.65;
      const limiter = this.track(ctx.createDynamicsCompressor());
      limiter.threshold.value = -12;
      limiter.knee.value = 12;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.master.connect(limiter).connect(ctx.destination);
      this.effects = this.track(ctx.createGain());
      this.effectsFilter = this.track(ctx.createBiquadFilter());
      this.effectsFilter.type = 'lowpass';
      this.effectsFilter.frequency.value = 18000;
      this.effects.connect(this.effectsFilter).connect(this.master);
      this.musicGain = this.track(ctx.createGain());
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.master);
      this.reverb = this.track(ctx.createConvolver());
      // Preparing the 3.5 s impulse response was the slowest step of the first click (~0.1-0.2 s on an old
      // laptop). Music fades in over seconds, so the reverb can arrive in a later idle turn.
      const reverb = this.reverb;
      const attach = () => {
        if (this.reverb !== reverb) return;
        try { reverb.buffer = this.makeImpulse(); } catch (error) { this.fail(error); }
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(attach, { timeout: 1000 });
      else setTimeout(attach, 50);
      const wet = this.track(ctx.createGain());
      wet.gain.value = 0.45;
      this.reverb.connect(wet).connect(this.musicGain);
      this.interfaceGain = this.track(ctx.createGain());
      this.interfaceGain.connect(this.master);
      for (const kind of ['white', 'pink', 'brown', 'crackle'] as const) {
        this.buffers.set(kind, this.makeNoise(kind));
      }
      for (let i=0;i<4;i++) {
        const body = this.loop('white','lowpass',1800); body.gain.disconnect();
        this.pyroVoices.push({ body, connected: false });
        const rumble = this.loop('brown','lowpass',1400), snap = this.loop('white','lowpass',3000), thump = this.oscillatorLoop(65);
        rumble.gain.disconnect(); snap.gain.disconnect(); thump.gain.disconnect();
        this.explosionVoices.push({ body: rumble, snap, thump, connected: false });
      }
      for (const type of Object.keys(TIMBRE) as EngineType[]) {
        const roar = this.gated(this.loop(type === 'monoprop' ? 'white' : 'pink', 'lowpass', TIMBRE[type].cutoff));
        const rumble = this.gated(this.loop('brown', 'lowpass', TIMBRE[type].rumble));
        this.voices.set(type, { roar, rumble,
          crackle: type === 'solid' || type === 'afterburner' ? this.gated(this.loop('crackle', 'bandpass', 1600)) : undefined,
          whine: ['jet', 'afterburner', 'ion', 'nuclear'].includes(type) ? this.gated(this.oscillatorLoop(type === 'ion' ? 1800 : 120)) : undefined });
      }
      this.wind = this.gated(this.loop('pink', 'highpass', 450));
      this.buffet = this.gated(this.loop('brown', 'lowpass', 35));
      this.plasma = this.gated(this.loop('pink', 'bandpass', 1600));
      for (const [name, kind, cutoff] of [
        ['wheels', 'brown', 220], ['chute', 'pink', 1300], ['jetpack', 'white', 2600], ['drill', 'crackle', 450],
      ] as const) this.mechanics.set(name, this.gated(this.loop(kind, 'bandpass', cutoff)));
      for (let i = 0; i < 4; i++) {
        const pan = this.track(ctx.createStereoPanner());
        pan.connect(this.effects);
        this.spatial.push({ layer: this.gated(this.loop('pink', 'lowpass', 1200), pan), pan });
      }
      for (const theme of Object.keys(THEMES) as MusicTheme[]) {
        const bus = this.track(ctx.createGain()); bus.gain.value = 0;
        bus.connect(this.musicGain); bus.connect(this.reverb);
        this.themeBuses.set(theme, bus);
      }
      const tensionSource = this.track(ctx.createOscillator()); tensionSource.frequency.value = 55;
      this.tension = this.track(ctx.createGain()); this.tension.gain.value = 0;
      const pulse = this.track(ctx.createGain()); pulse.gain.value = 0.5;
      const rhythm = this.track(ctx.createOscillator()); rhythm.frequency.value = 2;
      const depth = this.track(ctx.createGain()); depth.gain.value = 0.45;
      rhythm.connect(depth).connect(pulse.gain);
      tensionSource.connect(pulse).connect(this.tension).connect(this.musicGain);
      this.sources.add(tensionSource); this.sources.add(rhythm);
      tensionSource.start(); rhythm.start();
      // The compressor has a finite attack; a soft safety ceiling catches exceptional pile-ups.
      const ceiling = this.track(ctx.createWaveShaper());
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) {
        const x = i * 2 / (curve.length - 1) - 1, a = Math.abs(x);
        curve[i] = Math.sign(x) * (a <= 0.85 ? a : 0.85 + 0.1 * Math.tanh((a - 0.85) / 0.1));
      }
      ceiling.curve = curve;
      limiter.disconnect(); limiter.connect(ceiling).connect(ctx.destination);
      this.applySettings();
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.visibility);
        this.hidden = document.hidden;
        if (this.hidden) void ctx.suspend().catch(() => {});
      }
      this.unsubscribeSettings = game.subscribe(this.applySettings);
    } catch {
      // Unsupported/denied audio contexts leave a safe, silent instance.
      this.dispose();
    }
  }

  /** Call synchronously from the first pointer/key gesture. Safe to call again. */
  resume(): void {
    if (this.disposed) return;
    // Scene effects and synthetic events must not allocate/start an audio graph.
    if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (!this.context) {
      const pendingMusic = this.musicMode;
      this.initialize();
      this.musicMode = 'off';
      this.setMusic(pendingMusic);
    }
    if (!this.disposed && !this.hidden && !this.paused && this.context?.state === 'suspended') {
      void this.context.resume().then(() => {
        if (!this.disposed && this.musicMode !== 'off' && this.musicSources.size === 0) this.pad();
      }).catch(() => { /* A later gesture can retry. */ });
    }
  }

  /** Suspend the audio clock too: paused music must not accumulate scheduled notes. */
  setPaused(paused: boolean): void {
    if (this.paused === paused || this.disposed) return;
    this.paused = paused;
    this.visibility();
  }

  /** Read-only diagnostic counts, including persistent silent pooled voices. */
  diagnostics() { return { nodes: this.nodes.size, sources: this.sources.size, transients: this.transientNodes.size, music: this.musicSources.size, paused: this.paused }; }

  setMasterVolume(v: number): void {
    if (this.master) this.target(this.master.gain, unit(v));
  }

  update(state: AudioState): void {
    const ctx = this.context;
    if (!ctx || this.disposed || this.hidden || this.paused || !this.effects || !this.effectsFilter) return;
    if (state.situation && ctx.currentTime >= this.nextThemeChange) {
      const theme = selectTheme(state.situation);
      if (theme !== this.musicMode) { this.setMusic(theme); this.nextThemeChange = ctx.currentTime + 4; }
    }
    if (this.tension) this.target(this.tension.gain, this.musicMode === 'tense' ? 0.02 + 0.05 * Math.max(unit(state.reentryHeat), unit((state.gForce ?? 0) / 8), state.terrainDanger ? 1 : 0) : 0, 1);
    const air = atmosphere(state.ambientPressure);
    const colorAir = atmosphereColor(state.situation?.bodyId);
    let totalThrust = 0;
    for (const engine of state.engines) totalThrust += engine.thrustFraction;
    this.duck = musicDuck(totalThrust, state.dynamicPressure, state.reentryHeat);
    if (this.musicGain) this.target(this.musicGain.gain, this.musicLevel(), 0.5);
    const distance = distanceGain(state.cameraDistance);
    const pitch = dopplerPitch(state.cameraRadialVelocity ?? 0, state.ambientPressure);
    this.effectsMix = state.timeWarp > 1 ? 0 : state.inMapView ? 0.18 : 1;
    this.target(this.effects.gain, this.effectsMix * this.sfxVolume);
    this.target(this.effectsFilter.frequency, state.inMapView ? 650 : 700 + 17300 * air);
    for (const [type, voice] of this.voices) {
      // thrustFraction is absolute thrust / 3.3 MN; count must not multiply it.
      let thrust = 0, count = 0, size = 0;
      for (const engine of state.engines) if (engine.type === type && engine.count > 0) {
        thrust += unit(engine.thrustFraction); count += engine.count; size += (engine.size ?? 1) * engine.count;
      }
      thrust = unit(thrust); size /= Math.max(1, count);
      if (voice.previousThrust !== undefined && this.previousVessel === state.vesselId && state.timeWarp <= 1) {
        const transition = engineTransition(voice.previousThrust, thrust);
        if (transition === 'ignite') { this.burst(0.24, 0.12 * distance * (0.12 + air), 900, 'lowpass', 'brown'); }
        if (transition === 'shutdown') this.burst(0.22, 0.045 * distance * (0.12 + air), 1800, 'bandpass', 'pink');
      }
      voice.previousThrust = thrust;
      const color = Math.max(0.5, Math.min(1.8, (1 + Math.log1p(count) * 0.08) / Math.sqrt(Math.max(0.25, size))));
      const timbre = TIMBRE[type];
      const amplitude = engineLoudness(thrust, state.ambientPressure) * distance * timbre.gain;
      if (this.level(voice.roar.gain, amplitude * (0.08 + 0.92 * air) * 0.32, type === 'jet' || type === 'afterburner' ? 0.7 : 0.08)) {
        this.target(voice.roar.filter.frequency, 100 + timbre.cutoff * air * (0.25 + thrust * 0.75) * color * pitch);
        this.target(voice.roar.source.playbackRate, pitch);
      }
      if (this.level(voice.rumble.gain, amplitude * 0.48)) {
        this.target(voice.rumble.filter.frequency, timbre.rumble * (0.7 + thrust * 0.6) * color * pitch);
        this.target(voice.rumble.source.playbackRate, pitch);
      }
      if (voice.whine) {
        const spool = type === 'jet' || type === 'afterburner' ? 0.7 : 0.15;
        if (this.level(voice.whine.gain, amplitude * (type === 'ion' ? 0.12 : 0.08), spool))
          this.target(voice.whine.source.frequency, (type === 'ion' ? 1400 : type === 'nuclear' ? 55 : 280) * (0.4 + thrust * 1.6) * color * pitch, spool);
      }
      if (voice.crackle && this.level(voice.crackle.gain, amplitude * air * 0.12)) this.target(voice.crackle.source.playbackRate, pitch);
    }
    const aero = windGain(state.dynamicPressure) * air * distance;
    if (this.wind && this.level(this.wind.gain, aero * 0.25))
      this.target(this.wind.filter.frequency, (250 + Math.min(2500, positive(state.airspeed) * 2)) * colorAir);
    if (this.buffet) this.level(this.buffet.gain, aero * (0.16 + transonicBuffeting(state.mach) * 0.55) + unit(state.launchRumble ?? 0) * distance * 0.28);
    if (this.plasma) this.level(this.plasma.gain, unit(state.reentryHeat) * air * distance * 0.3);
    for (let i = 0; i < this.spatial.length; i++) {
      const voice = this.spatial[i], source = state.neighbors?.[i];
      const range = source ? Math.hypot(source.x, source.y, source.z) : 0;
      if (!this.level(voice.layer.gain, source ? unit(source.thrust) * air * 0.12 / (1 + range / 70) : 0)) continue;
      this.target(voice.pan.pan, source ? Math.max(-1, Math.min(1, source.x / Math.max(1, range))) : 0);
      this.target(voice.layer.filter.frequency, (150 + air * 1500) * colorAir);
    }
    const rcs = unit(state.rcsActive);
    if (rcs > 0 && (!this.rcsWasActive || ctx.currentTime >= this.nextPuff) && ctx.state === 'running' && state.timeWarp <= 1) {
      this.burst(0.09, rcs * distance * 0.06, 2800, 'highpass');
      this.nextPuff = ctx.currentTime + 0.15;
    }
    this.rcsWasActive = rcs > 0;
    this.updateMechanics(state, distance);
  }

  staging(): void { this.pyro('stage'); }
  /** Existing hull creak, also callable on the sim's warning edge before a fast overload separates. */
  structuralCreak(stress: number): void {
    const ctx = this.context;
    if (!ctx || this.paused || this.hidden || ctx.state !== 'running' || ctx.currentTime < this.nextCreak) return;
    this.burst(0.45, 0.06 * unit(stress), 420, 'bandpass', 'crackle');
    this.tone(130, 0.35, 0.035, 'triangle', 85);
    this.nextCreak = ctx.currentTime + 1.5;
  }
  decouple(kind: 'decoupler' | 'solid' = 'decoupler'): void { this.pyro(kind); }
  private pyro(kind: 'stage' | 'decoupler' | 'solid' | 'fairing'): void {
    const ctx = this.context;
    if (!ctx || this.paused || this.hidden) return;
    // Reuse continuous noise voices: event cascades do not allocate WebAudio graphs.
    const voice = this.pyroVoices[this.pyroCursor++ % this.pyroVoices.length];
    if (!voice) return;
    const heavy = kind === 'solid', fairing = kind === 'fairing';
    const now = ctx.currentTime, duration = heavy ? .65 : fairing ? .35 : .24;
    this.connectEvent(voice,duration+.05);
    const layer = voice.body;
    layer.filter.frequency.setValueAtTime(heavy ? 450 : fairing ? 3200 : 1800,now);
    layer.filter.frequency.exponentialRampToValueAtTime(80,now+duration);
    layer.gain.gain.cancelScheduledValues(now);
    layer.gain.gain.setValueAtTime(heavy ? .9 : fairing ? .5 : .7,now);
    layer.gain.gain.exponentialRampToValueAtTime(.00001,now+duration);
  }
  explosion(size: number, distance = 0, pressure = 101325, throughHull = true): void {
    const scale = Math.sqrt(unit(positive(size) / 10));
    const attenuation = distanceGain(distance) * ((throughHull ? 0.12 : 0) + (throughHull ? 0.88 : 1) * atmosphere(pressure));
    const ctx = this.context;
    if (!ctx || this.paused || this.hidden) return;
    const voice = this.explosionVoices[this.explosionCursor++ % this.explosionVoices.length];
    if (!voice?.snap || !voice.thump) return;
    const duration = .5 + scale*1.4, now = ctx.currentTime;
    this.connectEvent(voice,duration+.05);
    voice.body.gain.gain.cancelScheduledValues(now); voice.snap.gain.gain.cancelScheduledValues(now); voice.thump.gain.gain.cancelScheduledValues(now);
    this.envelope(voice.body.gain,now,duration,(.15+scale*.6)*attenuation);
    this.envelope(voice.snap.gain,now,.18,(.1+scale*.2)*attenuation);
    this.envelope(voice.thump.gain,now,.5+scale,(.1+scale*.25)*attenuation);
    voice.thump.source.frequency.cancelScheduledValues(now);
    voice.thump.source.frequency.setValueAtTime(65,now);
    voice.thump.source.frequency.exponentialRampToValueAtTime(22,now+.5+scale);
  }
  private connectEvent(voice: EventVoice, duration: number) {
    if (voice.timer !== undefined) clearTimeout(voice.timer);
    if (!voice.connected) {
      voice.body.gain.connect(this.effects!); voice.snap?.gain.connect(this.effects!); voice.thump?.gain.connect(this.effects!);
      voice.connected=true;
    }
    voice.timer=setTimeout(() => this.disconnectEvent(voice),duration*1000);
  }
  private disconnectEvent(voice: EventVoice) {
    if (voice.timer !== undefined) clearTimeout(voice.timer);
    voice.timer=undefined;
    if (!voice.connected) return;
    voice.body.gain.disconnect(); voice.snap?.gain.disconnect(); voice.thump?.gain.disconnect();
    voice.connected=false;
  }

  flameout(): void {
    const now = this.context?.currentTime ?? 0;
    if (now < (this.warningTimes.get('flameout') ?? -1)) return;
    this.warningTimes.set('flameout', now + 0.4);
    this.burst(0.35, 0.18, 750, 'bandpass', 'crackle');
    this.tone(95, 0.32, 0.08, 'triangle', 25);
  }
  fairing(): void { this.pyro('fairing'); }
  missionComplete(): void {
    for (let i = 0; i < 4; i++) this.tone(220 * 2 ** ([0, 7, 12, 16][i] / 12), 0.9, 0.045, 'sine', 220 * 2 ** ([0, 7, 12, 16][i] / 12), i * 0.18, true);
  }
  controlCue(up = true): void { this.tone(up ? 520 : 390, 0.09, 0.055, 'sine', up ? 780 : 260, 0, true); }
  chuteDeploy(): void { this.burst(0.65, 0.17, 1800, 'bandpass', 'pink'); this.tone(130, 0.12, 0.1, 'triangle', 65); }
  legDeploy(): void { this.tone(220, 0.3, 0.06, 'triangle', 120); this.burst(0.08, 0.08, 700, 'lowpass'); }
  uiClick(): void { this.tone(620, 0.045, 0.065, 'sine', 420, 0, true); }
  uiHover(): void {
    const now = this.context?.currentTime ?? 0;
    if (now < (this.warningTimes.get("hover") ?? -1)) return;
    this.warningTimes.set("hover", now + 0.08);
    this.tone(760, 0.035, 0.025, 'sine', 760, 0, true);
  }
  docking(): void { this.burst(0.16, 0.18, 300, 'lowpass', 'brown'); this.tone(110, 0.18, 0.1, 'triangle', 55); this.tone(420, 0.07, 0.05, 'triangle', 180, 0.22); }
  partAttach(): void { this.burst(0.055, 0.09, 2100, 'bandpass'); this.tone(480, 0.07, 0.07, 'triangle', 220); }
  warning(): void { this.tone(660, 0.18, 0.09); this.tone(660, 0.18, 0.09, 'sine', 660, 0.26); }
  touchdown(speed: number): void {
    const impact = unit(positive(speed) / 25);
    this.burst(0.1 + impact * 0.4, 0.03 + impact * 0.35, 500, 'lowpass', 'brown');
    this.tone(80, 0.12 + impact * 0.25, 0.02 + impact * 0.18, 'sine', 32);
  }

  setMusic(mode: MusicMode): void {
    if (this.disposed) return;
    if (!this.context) { this.musicMode = mode; return; }
    if (!this.musicGain || mode === this.musicMode) return;
    const theme = mode === 'space' ? 'cruise' : mode === 'menu' ? 'saturn' : mode;
    this.musicMode = mode;
    // Retire outgoing pads after the crossfade, rather than consuming voices for their full 22 s tail.
    for (const source of this.musicSources) {
      const gain = this.transientNodes.get(source)?.[1] as GainNode | undefined;
      if (!gain) continue;
      const now = this.context.currentTime;
      const param = gain.gain;
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
      else {
        // Firefox lacks cancelAndHoldAtTime; anchor the current gain before fading.
        const value = param.value;
        param.cancelScheduledValues(now);
        param.setValueAtTime(value, now);
      }
      gain.gain.linearRampToValueAtTime(0, now + 3);
      try { source.stop(now + 3.05); } catch { /* Already ended. */ }
    }
    if (this.musicTimer !== undefined) clearInterval(this.musicTimer);
    this.musicTimer = undefined;
    for (const [name, bus] of this.themeBuses) {
      const points = crossfadeSchedule(this.context.currentTime, 3, bus.gain.value, name === theme ? 1 : 0);
      bus.gain.cancelScheduledValues(this.context.currentTime);
      bus.gain.setValueAtTime(points[0].gain, points[0].time);
      bus.gain.linearRampToValueAtTime(points[1].gain, points[1].time);
    }
    this.target(this.musicGain.gain, this.musicLevel(), 1.5);
    if (theme !== 'tense' && this.tension) this.target(this.tension.gain, 0, 1);
    if (theme === 'off') return;
    this.chord = 0;
    this.musicDeadline = 0;
    this.pad();
    if (!this.hidden) this.musicTimer = setInterval(() => this.pad(), 1000);
  }

  /** Used when leaving flight, keeping the shared menu/UI context alive. */
  silenceFlight(preserveEvents = false): void {
    // Transients must not survive a scene boundary. Persistent pools remain silent and bounded.
    for (const [source, nodes] of this.transientNodes) if (!preserveEvents && !this.musicSources.has(source)) {
      const gain = nodes[nodes.length - 1] as GainNode;
      const now = this.context?.currentTime ?? 0;
      gain.gain.cancelScheduledValues(now); gain.gain.setTargetAtTime(0, now, 0.008);
      try { source.stop(now + 0.04); } catch { /* Already ended. */ }
    }
    if (!preserveEvents) {
      for (const voice of this.pyroVoices) this.disconnectEvent(voice);
      for (const voice of this.explosionVoices) this.disconnectEvent(voice);
    }
    for (const voice of this.spatial) this.level(voice.layer.gain, 0);
    this.previousControls = undefined;
    this.duck = 1;
    if (this.musicGain) this.target(this.musicGain.gain, this.musicLevel(), 1);

    for (const voice of this.voices.values()) {
      for (const layer of [voice.roar, voice.rumble, voice.crackle, voice.whine]) if (layer) this.level(layer.gain, 0);
    }
    for (const layer of [...this.mechanics.values(), this.wind, this.buffet, this.plasma]) if (layer) this.level(layer.gain, 0);
    // Flight no longer calls update(): disconnect the layers once their fades have finished.
    if (this.gateSweep !== undefined) clearTimeout(this.gateSweep);
    this.gateSweep = setTimeout(() => this.sweepGates(), 8000);
    this.effectsMix = 1;
    if (this.effects) this.target(this.effects.gain, this.sfxVolume);
    if (this.effectsFilter) this.target(this.effectsFilter.frequency, 18000);
    this.previousVessel = undefined;
    this.nextThemeChange = 0;
    if (this.tension) this.target(this.tension.gain, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeSettings?.();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility);
    if (this.gateSweep !== undefined) clearTimeout(this.gateSweep);
    this.gateSweep = undefined;
    this.gates.clear();
    if (this.musicTimer !== undefined) clearInterval(this.musicTimer);
    this.musicTimer = undefined;
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* May already have ended. */ }
    }
    for (const voice of this.pyroVoices) this.disconnectEvent(voice);
    for (const voice of this.explosionVoices) this.disconnectEvent(voice);
    for (const node of this.nodes) node.disconnect();
    this.sources.clear(); this.nodes.clear(); this.musicSources.clear();
    this.transientNodes.clear(); this.spatial.length = 0; this.pyroVoices.length = 0; this.explosionVoices.length = 0;
    this.buffers.clear(); this.voices.clear(); this.themeBuses.clear(); this.mechanics.clear();
    const ctx = this.context;
    this.context = undefined;
    this.master = undefined; this.effects = undefined; this.effectsFilter = undefined;
    this.musicGain = undefined; this.reverb = undefined; this.interfaceGain = undefined; this.tension = undefined;
    this.wind = undefined; this.buffet = undefined; this.plasma = undefined;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
  }

  private track<T extends AudioNode>(node: T): T { this.nodes.add(node); return node; }
  private target(param: AudioParam, value: number, smoothing = 0.08): void {
    if (this.context) param.setTargetAtTime(value, this.context.currentTime, smoothing);
  }

  /** Take a continuous layer out of the graph until `level` makes it audible; it then feeds `to`. */
  private gated<T extends { gain: GainNode }>(layer: T, to: AudioNode = this.effects!): T {
    layer.gain.disconnect();
    this.gates.set(layer.gain, { to, open: false, quietUntil: Infinity });
    return layer;
  }

  /**
   * Fade a gated layer to `value`. A connected loop costs its source and filter every render quantum even at zero
   * gain (the ~40 pooled layers took ~25% of a core on an old laptop), so a layer leaves the graph once its fade
   * to silence is over. Returns whether it is connected: callers set its other params only then, so automation
   * does not pile up on a node the graph is not processing.
   */
  private level(gain: GainNode, value: number, smoothing = 0.08): boolean {
    const gate = this.gates.get(gain);
    const now = this.context?.currentTime ?? 0;
    if (gate && value > SILENT) {
      gate.quietUntil = Infinity;
      if (!gate.open) {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        gain.connect(gate.to);
        gate.open = true;
      }
    } else if (gate) {
      if (!gate.open) return false;
      if (gate.quietUntil === Infinity) gate.quietUntil = now + smoothing * 10;
      else if (now >= gate.quietUntil) { gain.disconnect(); gate.open = false; return false; }
    }
    this.target(gain.gain, value, smoothing);
    return true;
  }

  private sweepGates(): void {
    this.gateSweep = undefined;
    const now = this.context?.currentTime ?? 0;
    for (const [gain, gate] of this.gates) if (gate.open && now >= gate.quietUntil) { gain.disconnect(); gate.open = false; }
  }

  private makeNoise(kind: NoiseKind): AudioBuffer {
    const ctx = this.context!;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0, pink = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + white * 0.035) / 1.02;
      // Three octave-spaced low-pass bands approximate a pink spectrum.
      pink = pink * 0.985 + white * 0.015;
      data[i] = kind === 'brown' ? brown * 3.5 : kind === 'pink' ? pink * 2.5 + brown * 1.2 + white * 0.12
        : kind === 'crackle' ? (Math.random() < 0.012 ? white : 0) : white;
    }
    // Blend the seam to prevent a periodic click in looping buffers.
    const fade = Math.min(256, data.length / 2);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = data[data.length - fade + i] * (1 - t) + data[i] * t;
    }
    return buffer;
  }

  private makeImpulse(): AudioBuffer {
    const ctx = this.context!;
    const buffer = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * 3.5), ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < data.length; i++) {
        smooth = smooth * 0.7 + (Math.random() * 2 - 1) * 0.3;
        data[i] = smooth * (1 - i / data.length) ** 3;
      }
    }
    return buffer;
  }

  private loop(kind: NoiseKind, filterType: BiquadFilterType, frequency: number): Layer {
    const ctx = this.context!;
    const source = this.track(ctx.createBufferSource());
    source.buffer = this.buffers.get(kind)!;
    source.loop = true;
    const filter = this.track(ctx.createBiquadFilter());
    filter.type = filterType; filter.frequency.value = frequency; filter.Q.value = 0.6;
    const gain = this.track(ctx.createGain()); gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.effects!);
    this.sources.add(source);
    source.start(0, Math.random() * 2);
    return { filter, gain, source };
  }

  private envelope(gain: GainNode, start: number, duration: number, amplitude: number, attack = 0.006): void {
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(amplitude, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.00001, start + duration);
    gain.gain.linearRampToValueAtTime(0, start + duration + 0.02);
  }

  private cleanup(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    this.sources.add(source);
    this.transientNodes.set(source, nodes);
    source.onended = () => {
      source.onended = null;
      this.transientNodes.delete(source);
      this.sources.delete(source);
      for (const node of nodes) { node.disconnect(); this.nodes.delete(node); }
      this.musicSources.delete(source);
    };
  }

  private burst(duration: number, amplitude: number, cutoff: number, type: BiquadFilterType, kind: NoiseKind = 'white'): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.disposed || this.hidden || this.paused || !admitVoice(this.nodes.size, 3)) return;
    const source = this.track(ctx.createBufferSource()); source.buffer = this.buffers.get(kind)!;
    const filter = this.track(ctx.createBiquadFilter());
    filter.type = type; filter.frequency.value = cutoff; filter.Q.value = 0.6;
    const gain = this.track(ctx.createGain());
    source.connect(filter).connect(gain).connect(this.effects!);
    this.envelope(gain, ctx.currentTime, duration, amplitude);
    this.cleanup(source, [source, filter, gain]);
    source.start(); source.stop(ctx.currentTime + duration + 0.03);
  }

  private tone(frequency: number, duration: number, amplitude: number, type: OscillatorType = 'sine', end = frequency, delay = 0, interfaceSound = false): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.disposed || this.hidden || this.paused || !admitVoice(this.nodes.size, 2, interfaceSound)) return;
    const oscillator = this.track(ctx.createOscillator()); oscillator.type = type;
    const start = ctx.currentTime + delay;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(end, start + duration);
    const gain = this.track(ctx.createGain());
    oscillator.connect(gain).connect(interfaceSound ? this.interfaceGain! : this.effects!);
    this.envelope(gain, start, duration, amplitude);
    this.cleanup(oscillator, [oscillator, gain]);
    oscillator.start(start); oscillator.stop(start + duration + 0.03);
  }

  private oscillatorLoop(frequency: number) {
    const ctx = this.context!;
    const source = this.track(ctx.createOscillator()); source.type = 'sine'; source.frequency.value = frequency;
    const gain = this.track(ctx.createGain()); gain.gain.value = 0;
    source.connect(gain).connect(this.effects!); this.sources.add(source); source.start();
    return { source, gain };
  }

  private updateMechanics(state: AudioState, distance: number): void {
    const ctx = this.context!;
    const running = state.timeWarp <= 1 && ctx.state === 'running';
    const mix = running ? distance : 0;
    const wheel = positive(state.wheelSpeed ?? 0);
    for (const [name, layer] of this.mechanics) {
      const amplitude = name === 'wheels' ? Math.sqrt(wheel / (wheel + 25)) * 0.13
        : name === 'chute' ? (state.chuteOpen ? windGain(state.dynamicPressure) * 0.16 : 0)
        : name === 'jetpack' ? (state.jetting ? 0.07 : 0) : state.drilling ? 0.12 : 0;
      if (this.level(layer.gain, amplitude * mix) && name === 'wheels') this.target(layer.filter.frequency, 80 + Math.min(1800, wheel * 18));
    }
    if (this.previousVessel !== state.vesselId) {
      this.previousVessel = state.vesselId;
      this.previousMechanical = state.mechanicalState;
      this.wasLanded = !!state.landed;
      this.warningTimes.clear();
      this.previousControls = undefined;
    }
    const previous = this.previousControls;
    if (previous) {
      if (previous.sas !== state.sas) this.controlCue(!!state.sas);
      if (previous.rcs !== state.rcs) this.controlCue(!!state.rcs);
      if (previous.warp !== state.timeWarp) this.controlCue(state.timeWarp > previous.warp);
      if ((state.nodeCount ?? 0) > previous.nodes) this.tone(880, 0.17, 0.06, 'sine', 1100, 0, true);
      if ((state.completedMissions ?? 0) > previous.missions) this.missionComplete();
      previous.sas = state.sas; previous.rcs = state.rcs; previous.warp = state.timeWarp;
      previous.nodes = state.nodeCount ?? 0; previous.missions = state.completedMissions ?? 0;
    } else this.previousControls = { sas: state.sas, rcs: state.rcs, warp: state.timeWarp, nodes: state.nodeCount ?? 0, missions: state.completedMissions ?? 0 };
    if (!running) return;
    if (state.mechanicalState !== undefined && this.previousMechanical !== undefined && state.mechanicalState !== this.previousMechanical) {
      const old = new Map(this.previousMechanical.split(',').map(entry => entry.split(':')) as [string, string][]);
      if (state.mechanicalState.split(',').some(entry => {
        const [uid, deployed] = entry.split(':');
        return old.has(uid) && old.get(uid) !== deployed;
      })) this.legDeploy();
    }
    this.previousMechanical = state.mechanicalState;
    if (state.landed && !this.wasLanded) {
      this.touchdown(this.previousSpeed);
      if (state.splashed) this.burst(0.9, 0.08 + unit(this.previousSpeed / 30) * 0.2, 1200, 'bandpass', 'pink');
    }
    this.previousSpeed = Math.abs(state.verticalSpeed ?? state.airspeed);
    if ((state.structuralStress ?? 0) > 0.55 && ctx.currentTime >= this.nextCreak) {
      this.structuralCreak(state.structuralStress!);
    }
    this.wasLanded = !!state.landed;
    if (state.walking && ctx.currentTime >= this.nextStep) {
      this.burst(0.14, 0.07 * distance, 1600, 'lowpass', 'crackle');
      this.burst(0.09, 0.035 * distance, 350, 'lowpass', 'brown');
      this.nextStep = ctx.currentTime + 0.48;
    }
    this.alarm('fuel', state.fuelFraction !== undefined && state.fuelFraction < 0.1, 440);
    this.alarm('heat', (state.temperatureFraction ?? 0) > 0.85, 880);
    this.alarm('stress', (state.structuralStress ?? 0) > 0.85, 590);
    this.alarm('g', (state.gForce ?? 0) > 6, 740);
    this.alarm('terrain', !!state.terrainDanger, 330);
    this.alarm('signal', !!state.noSignal, 520);
  }

  private alarm(name: string, active: boolean, pitch: number): void {
    const now = this.context!.currentTime;
    if (!active || now < (this.warningTimes.get(name) ?? 0)) return;
    this.tone(pitch, 0.14, 0.07, 'sine', pitch, 0, true);
    this.tone(name === 'terrain' ? pitch * 2 : pitch, 0.14, 0.07, 'sine', pitch, 0.23, true);
    this.warningTimes.set(name, now + (name === 'terrain' ? 2 : 8));
  }

  private pad(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.hidden || this.paused || this.musicMode === 'off' || !this.musicGain || !this.reverb || ctx.currentTime < this.musicDeadline) return;
    const theme = this.musicMode === 'space' ? 'cruise' : this.musicMode === 'menu' ? 'saturn' : this.musicMode;
    const config = THEMES[theme];
    const bus = this.themeBuses.get(theme)!;
    this.musicDeadline = ctx.currentTime + config.interval;
    const notes = config.chords[this.chord++ % config.chords.length];
    const tones = notes.flatMap(note => [{ note, detune: -4 }, { note, detune: 4 }]);
    if (config.shimmer) tones.push({ note: notes[0] + 36, detune: 7 });
    for (const { note, detune } of tones) {
      if (!admitVoice(this.nodes.size, 2)) break;
      const oscillator = this.track(ctx.createOscillator()); oscillator.type = 'sine';
      oscillator.frequency.value = config.root * 2 ** (note / 12); oscillator.detune.value = detune;
      const gain = this.track(ctx.createGain());
      const start = ctx.currentTime;
      const amplitude = note >= 36 ? 0.025 : 0.07;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(amplitude, start + config.duration * 0.3);
      gain.gain.linearRampToValueAtTime(0, start + config.duration);
      oscillator.connect(gain).connect(bus);
      this.musicSources.add(oscillator);
      this.cleanup(oscillator, [oscillator, gain]);
      oscillator.start(start); oscillator.stop(start + config.duration + 0.05);
    }
  }
}
