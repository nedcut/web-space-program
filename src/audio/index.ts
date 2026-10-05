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

interface Layer { gain: GainNode; filter: BiquadFilterNode; source: AudioBufferSourceNode }
interface EngineVoice { roar: Layer; rumble: Layer; crackle?: Layer; whine?: { source: OscillatorNode; gain: GainNode } }
type NoiseKind = 'white' | 'pink' | 'brown' | 'crackle';
// Includes persistent voices, theme buses, and temporary effect/music nodes.
const MAX_AUDIO_NODES = 234;
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
    if (this.hidden) {
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
    if (this.interfaceGain) this.target(this.interfaceGain.gain, this.sfxVolume);
    if (this.musicGain) this.target(this.musicGain.gain, this.musicLevel());
  };
  private musicLevel() { return (this.musicMode === 'off' ? 0 : this.musicMode === 'menu' || this.musicMode === 'saturn' ? 0.12 : 0.085) * this.musicVolume; }

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
      limiter.ratio.value = 8;
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
      this.reverb.buffer = this.makeImpulse();
      const wet = this.track(ctx.createGain());
      wet.gain.value = 0.45;
      this.reverb.connect(wet).connect(this.musicGain);
      this.interfaceGain = this.track(ctx.createGain());
      this.interfaceGain.connect(this.master);
      for (const kind of ['white', 'pink', 'brown', 'crackle'] as const) {
        this.buffers.set(kind, this.makeNoise(kind));
      }
      for (const type of Object.keys(TIMBRE) as EngineType[]) {
        const roar = this.loop(type === 'monoprop' ? 'white' : 'pink', 'lowpass', TIMBRE[type].cutoff);
        const rumble = this.loop('brown', 'lowpass', TIMBRE[type].rumble);
        this.voices.set(type, { roar, rumble,
          crackle: type === 'solid' || type === 'afterburner' ? this.loop('crackle', 'bandpass', 1600) : undefined,
          whine: ['jet', 'afterburner', 'ion', 'nuclear'].includes(type) ? this.oscillatorLoop(type === 'ion' ? 1800 : 120) : undefined });
      }
      this.wind = this.loop('pink', 'highpass', 450);
      this.buffet = this.loop('brown', 'lowpass', 35);
      this.plasma = this.loop('pink', 'bandpass', 1600);
      for (const [name, kind, cutoff] of [
        ['wheels', 'brown', 220], ['chute', 'pink', 1300], ['jetpack', 'white', 2600], ['drill', 'crackle', 450],
      ] as const) this.mechanics.set(name, this.loop(kind, 'bandpass', cutoff));
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
    if (!this.disposed && !this.hidden && this.context?.state === 'suspended') {
      void this.context.resume().then(() => {
        if (!this.disposed && this.musicMode !== 'off' && this.musicSources.size === 0) this.pad();
      }).catch(() => { /* A later gesture can retry. */ });
    }
  }

  setMasterVolume(v: number): void {
    if (this.master) this.target(this.master.gain, unit(v));
  }

  update(state: AudioState): void {
    const ctx = this.context;
    if (!ctx || this.disposed || this.hidden || !this.effects || !this.effectsFilter) return;
    if (state.situation && ctx.currentTime >= this.nextThemeChange) {
      const theme = selectTheme(state.situation);
      if (theme !== this.musicMode) { this.setMusic(theme); this.nextThemeChange = ctx.currentTime + 4; }
    }
    if (this.tension) this.target(this.tension.gain, this.musicMode === 'tense' ? 0.02 + 0.05 * Math.max(unit(state.reentryHeat), unit((state.gForce ?? 0) / 8), state.terrainDanger ? 1 : 0) : 0, 1);
    const air = atmosphere(state.ambientPressure);
    const distance = distanceGain(state.cameraDistance);
    const pitch = dopplerPitch(state.cameraRadialVelocity ?? 0, state.ambientPressure);
    this.effectsMix = state.timeWarp > 1 ? 0 : state.inMapView ? 0.18 : 1;
    this.target(this.effects.gain, this.effectsMix * this.sfxVolume);
    this.target(this.effectsFilter.frequency, state.inMapView ? 650 : 700 + 17300 * air);
    for (const [type, voice] of this.voices) {
      // thrustFraction is already a share of TOTAL vessel thrust; count must not multiply it.
      const thrust = unit(state.engines.reduce((sum, engine) =>
        sum + (engine.type === type && positive(engine.count) > 0 ? unit(engine.thrustFraction) : 0), 0));
      const group = state.engines.filter(e => e.type === type && e.count > 0);
      const count = group.reduce((sum, e) => sum + e.count, 0);
      const size = group.reduce((sum, e) => sum + (e.size ?? 1) * e.count, 0) / Math.max(1, count);
      const color = Math.max(0.5, Math.min(1.8, (1 + Math.log1p(count) * 0.08) / Math.sqrt(Math.max(0.25, size))));
      const timbre = TIMBRE[type];
      const amplitude = engineLoudness(thrust, state.ambientPressure) * distance * timbre.gain;
      this.target(voice.roar.gain.gain, amplitude * air * 0.32, type === 'jet' || type === 'afterburner' ? 0.7 : 0.08);
      this.target(voice.roar.filter.frequency, 100 + timbre.cutoff * air * (0.25 + thrust * 0.75) * color * pitch);
      this.target(voice.rumble.gain.gain, amplitude * 0.48);
      this.target(voice.rumble.filter.frequency, timbre.rumble * (0.7 + thrust * 0.6) * color * pitch);
      for (const layer of [voice.roar, voice.rumble, voice.crackle]) if (layer) this.target(layer.source.playbackRate, pitch);
      if (voice.whine) {
        const spool = type === 'jet' || type === 'afterburner' ? 0.7 : 0.15;
        this.target(voice.whine.source.frequency, (type === 'ion' ? 1400 : type === 'nuclear' ? 55 : 280) * (0.4 + thrust * 1.6) * color * pitch, spool);
        this.target(voice.whine.gain.gain, amplitude * (type === 'ion' ? 0.12 : 0.08), spool);
      }
      if (voice.crackle) this.target(voice.crackle.gain.gain, amplitude * air * 0.12);
    }
    const aero = windGain(state.dynamicPressure) * air * distance;
    if (this.wind) {
      this.target(this.wind.gain.gain, aero * 0.25);
      this.target(this.wind.filter.frequency, 250 + Math.min(2500, positive(state.airspeed) * 2));
    }
    if (this.buffet) this.target(this.buffet.gain.gain, aero * transonicBuffeting(state.mach) * 0.55);
    if (this.plasma) this.target(this.plasma.gain.gain, unit(state.reentryHeat) * air * distance * 0.3);
    const rcs = unit(state.rcsActive);
    if (rcs > 0 && (!this.rcsWasActive || ctx.currentTime >= this.nextPuff) && ctx.state === 'running' && state.timeWarp <= 1) {
      this.burst(0.09, rcs * distance * 0.06, 2800, 'highpass');
      this.nextPuff = ctx.currentTime + 0.15;
    }
    this.rcsWasActive = rcs > 0;
    this.updateMechanics(state, distance);
  }

  staging(): void {
    this.uiClick();
    this.burst(0.2, 0.45, 1800, 'lowpass');
    this.tone(95, 0.18, 0.22, 'triangle', 35);
  }
  decouple(): void { this.burst(0.12, 0.2, 900, 'bandpass'); this.tone(160, 0.12, 0.15, 'triangle', 60); }
  explosion(size: number): void {
    const scale = Math.sqrt(unit(positive(size) / 10));
    this.burst(0.4 + scale * 1.4, 0.15 + scale * 0.6, 1400, 'lowpass', 'brown');
    this.burst(0.18, 0.1 + scale * 0.2, 3000, 'lowpass');
    this.tone(65, 0.5 + scale, 0.1 + scale * 0.25, 'sine', 22);
  }
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
  silenceFlight(): void {
    for (const voice of this.voices.values()) {
      for (const layer of [voice.roar, voice.rumble, voice.crackle]) if (layer) this.target(layer.gain.gain, 0);
      if (voice.whine) this.target(voice.whine.gain.gain, 0);
    }
    for (const layer of [...this.mechanics.values(), this.wind, this.buffet, this.plasma]) if (layer) this.target(layer.gain.gain, 0);
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
    if (this.musicTimer !== undefined) clearInterval(this.musicTimer);
    this.musicTimer = undefined;
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* May already have ended. */ }
    }
    for (const node of this.nodes) node.disconnect();
    this.sources.clear(); this.nodes.clear(); this.musicSources.clear();
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
    source.onended = () => {
      this.sources.delete(source);
      for (const node of nodes) { node.disconnect(); this.nodes.delete(node); }
      this.musicSources.delete(source);
    };
  }

  private burst(duration: number, amplitude: number, cutoff: number, type: BiquadFilterType, kind: NoiseKind = 'white'): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.disposed || this.hidden || this.nodes.size + 3 > MAX_AUDIO_NODES) return;
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
    if (!ctx || ctx.state !== 'running' || this.disposed || this.hidden || this.nodes.size + 2 > MAX_AUDIO_NODES) return;
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
    const amplitudes = { wheels: Math.sqrt(wheel / (wheel + 25)) * 0.13,
      chute: state.chuteOpen ? windGain(state.dynamicPressure) * 0.16 : 0,
      jetpack: state.jetting ? 0.07 : 0, drill: state.drilling ? 0.12 : 0 };
    for (const [name, layer] of this.mechanics) {
      this.target(layer.gain.gain, amplitudes[name as keyof typeof amplitudes] * mix);
      if (name === 'wheels') this.target(layer.filter.frequency, 80 + Math.min(1800, wheel * 18));
    }
    if (this.previousVessel !== state.vesselId) {
      this.previousVessel = state.vesselId;
      this.previousMechanical = state.mechanicalState;
      this.wasLanded = !!state.landed;
      this.warningTimes.clear();
    }
    if (!running) return;
    if (state.mechanicalState !== undefined && this.previousMechanical !== undefined && state.mechanicalState !== this.previousMechanical) {
      const old = new Map(this.previousMechanical.split(',').map(entry => entry.split(':')) as [string, string][]);
      if (state.mechanicalState.split(',').some(entry => {
        const [uid, deployed] = entry.split(':');
        return old.has(uid) && old.get(uid) !== deployed;
      })) this.legDeploy();
    }
    this.previousMechanical = state.mechanicalState;
    if (state.landed && !this.wasLanded) this.touchdown(state.airspeed);
    this.wasLanded = !!state.landed;
    if (state.walking && ctx.currentTime >= this.nextStep) {
      this.burst(0.14, 0.07 * distance, 1600, 'lowpass', 'crackle');
      this.burst(0.09, 0.035 * distance, 350, 'lowpass', 'brown');
      this.nextStep = ctx.currentTime + 0.48;
    }
    const warnings = [
      ['fuel', state.fuelFraction !== undefined && state.fuelFraction < 0.1, 440],
      ['heat', (state.temperatureFraction ?? 0) > 0.85, 880],
      ['g', (state.gForce ?? 0) > 6, 740], ['terrain', state.terrainDanger, 330], ['signal', state.noSignal, 520],
    ] as const;
    for (const [name, active, pitch] of warnings) {
      if (!active || ctx.currentTime < (this.warningTimes.get(name) ?? 0)) continue;
      this.tone(pitch, 0.14, 0.07);
      this.tone(name === 'terrain' ? pitch * 2 : pitch, 0.14, 0.07, 'sine', pitch, 0.23);
      this.warningTimes.set(name, ctx.currentTime + (name === 'terrain' ? 2 : 8));
    }
  }

  private pad(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.hidden || this.musicMode === 'off' || !this.musicGain || !this.reverb || ctx.currentTime < this.musicDeadline) return;
    const theme = this.musicMode === 'space' ? 'cruise' : this.musicMode === 'menu' ? 'saturn' : this.musicMode;
    const config = THEMES[theme];
    const bus = this.themeBuses.get(theme)!;
    this.musicDeadline = ctx.currentTime + config.interval;
    const notes = config.chords[this.chord++ % config.chords.length];
    const tones = notes.flatMap(note => [{ note, detune: -4 }, { note, detune: 4 }]);
    if (config.shimmer) tones.push({ note: notes[0] + 36, detune: 7 });
    for (const { note, detune } of tones) {
      if (this.nodes.size + 2 > MAX_AUDIO_NODES) break;
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
