import { game } from '../game/store';
/** Procedural, offline audio. This module has no simulation or rendering dependencies. */
export type EngineType = 'kerolox' | 'hydrolox' | 'solid' | 'methalox' | 'ion' | 'monoprop' | 'jet' | 'afterburner';
export type MusicMode = 'menu' | 'space' | 'off';
export interface AudioState {
  engines: { thrustFraction: number; type: EngineType; count: number }[];
  ambientPressure: number;
  airspeed: number;
  mach: number;
  dynamicPressure: number;
  rcsActive: number;
  reentryHeat: number;
  inMapView: boolean;
  timeWarp: number;
  cameraDistance: number;
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

interface Layer { gain: GainNode; filter: BiquadFilterNode }
interface EngineVoice { roar: Layer; rumble: Layer; crackle?: Layer }
type NoiseKind = 'white' | 'pink' | 'brown' | 'crackle';
const TIMBRE: Record<EngineType, { cutoff: number; rumble: number; gain: number }> = {
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
  private nextPuff = 0;
  private rcsWasActive = false;
  private disposed = false;
  private musicVolume = 1;
  private sfxVolume = 1;
  private unsubscribeSettings?: () => void;
  private applySettings = () => {
    const s = game.get().settings;
    this.setMasterVolume(s.masterVolume);
    this.musicVolume = unit(s.musicVolume);
    this.sfxVolume = unit(s.sfxVolume);
    if (this.musicGain) this.target(this.musicGain.gain, this.musicLevel());
  };
  private musicLevel() { return (this.musicMode === 'off' ? 0 : this.musicMode === 'menu' ? 0.12 : 0.085) * this.musicVolume; }

  constructor() {
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
      for (const kind of ['white', 'pink', 'brown', 'crackle'] as const) {
        this.buffers.set(kind, this.makeNoise(kind));
      }
      for (const type of Object.keys(TIMBRE) as EngineType[]) {
        const roar = this.loop(type === 'monoprop' ? 'white' : 'pink', 'lowpass', TIMBRE[type].cutoff);
        const rumble = this.loop('brown', 'lowpass', TIMBRE[type].rumble);
        this.voices.set(type, { roar, rumble,
          crackle: type === 'solid' ? this.loop('crackle', 'bandpass', 1600) : undefined });
      }
      this.wind = this.loop('pink', 'highpass', 450);
      this.buffet = this.loop('brown', 'lowpass', 35);
      this.plasma = this.loop('pink', 'bandpass', 1600);
      this.applySettings();
      this.unsubscribeSettings = game.subscribe(this.applySettings);
    } catch {
      // Unsupported/denied audio contexts leave a safe, silent instance.
      this.dispose();
    }
  }

  /** Call synchronously from the first pointer/key gesture. Safe to call again. */
  resume(): void {
    if (!this.disposed && this.context?.state === 'suspended') {
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
    if (!ctx || this.disposed || !this.effects || !this.effectsFilter) return;
    const air = atmosphere(state.ambientPressure);
    const distance = 1 / Math.sqrt(1 + positive(state.cameraDistance) / 100);
    this.target(this.effects.gain, (state.timeWarp > 1 ? 0 : state.inMapView ? 0.18 : 1) * this.sfxVolume);
    this.target(this.effectsFilter.frequency, state.inMapView ? 650 : 18000);
    for (const [type, voice] of this.voices) {
      // thrustFraction is already a share of TOTAL vessel thrust; count must not multiply it.
      const thrust = unit(state.engines.reduce((sum, engine) =>
        sum + (engine.type === type && positive(engine.count) > 0 ? unit(engine.thrustFraction) : 0), 0));
      const timbre = TIMBRE[type];
      const amplitude = engineLoudness(thrust, state.ambientPressure) * distance * timbre.gain;
      this.target(voice.roar.gain.gain, amplitude * air * 0.32);
      this.target(voice.roar.filter.frequency, 100 + timbre.cutoff * air * (0.25 + thrust * 0.75));
      this.target(voice.rumble.gain.gain, amplitude * 0.48);
      this.target(voice.rumble.filter.frequency, timbre.rumble * (0.7 + thrust * 0.6));
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
  }

  staging(): void {
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
  uiClick(): void { this.tone(620, 0.045, 0.065, 'sine', 420); }
  uiHover(): void { this.tone(760, 0.035, 0.025); }
  warning(): void { this.tone(660, 0.18, 0.09); this.tone(660, 0.18, 0.09, 'sine', 660, 0.26); }
  touchdown(speed: number): void {
    const impact = unit(positive(speed) / 25);
    this.burst(0.1 + impact * 0.4, 0.03 + impact * 0.35, 500, 'lowpass', 'brown');
    this.tone(80, 0.12 + impact * 0.25, 0.02 + impact * 0.18, 'sine', 32);
  }

  setMusic(mode: MusicMode): void {
    if (!this.context || this.disposed || !this.musicGain || mode === this.musicMode) return;
    this.musicMode = mode;
    if (this.musicTimer !== undefined) clearInterval(this.musicTimer);
    this.musicTimer = undefined;
    this.target(this.musicGain.gain, this.musicLevel(), 1.5);
    if (mode === 'off') return; // Existing pads finish silently; no further notes are scheduled.
    this.pad();
    this.musicTimer = setInterval(() => this.pad(), 6000);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeSettings?.();
    if (this.musicTimer !== undefined) clearInterval(this.musicTimer);
    this.musicTimer = undefined;
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* May already have ended. */ }
    }
    for (const node of this.nodes) node.disconnect();
    this.sources.clear(); this.nodes.clear(); this.musicSources.clear();
    this.buffers.clear(); this.voices.clear();
    const ctx = this.context;
    this.context = undefined;
    this.master = undefined; this.effects = undefined; this.effectsFilter = undefined;
    this.musicGain = undefined; this.reverb = undefined;
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
    return { filter, gain };
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
    if (!ctx || ctx.state !== 'running' || this.disposed) return;
    const source = this.track(ctx.createBufferSource()); source.buffer = this.buffers.get(kind)!;
    const filter = this.track(ctx.createBiquadFilter());
    filter.type = type; filter.frequency.value = cutoff; filter.Q.value = 0.6;
    const gain = this.track(ctx.createGain());
    source.connect(filter).connect(gain).connect(this.effects!);
    this.envelope(gain, ctx.currentTime, duration, amplitude);
    this.cleanup(source, [source, filter, gain]);
    source.start(); source.stop(ctx.currentTime + duration + 0.03);
  }

  private tone(frequency: number, duration: number, amplitude: number, type: OscillatorType = 'sine', end = frequency, delay = 0): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.disposed) return;
    const oscillator = this.track(ctx.createOscillator()); oscillator.type = type;
    const start = ctx.currentTime + delay;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(end, start + duration);
    const gain = this.track(ctx.createGain());
    oscillator.connect(gain).connect(this.effects!);
    this.envelope(gain, start, duration, amplitude);
    this.cleanup(oscillator, [oscillator, gain]);
    oscillator.start(start); oscillator.stop(start + duration + 0.03);
  }

  private pad(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.musicMode === 'off' || !this.musicGain || !this.reverb) return;
    // D major pentatonic voicings, avoiding semitone tension; space uses a lower register.
    const chords = [[0, 7, 14], [2, 9, 16], [4, 12, 19], [7, 14, 21]];
    const notes = chords[this.chord++ % chords.length];
    const root = this.musicMode === 'space' ? 73.416 : 146.832;
    for (const note of notes) {
      for (const detune of [-5, 5]) {
        const oscillator = this.track(ctx.createOscillator()); oscillator.type = 'sine';
        oscillator.frequency.value = root * 2 ** (note / 12); oscillator.detune.value = detune;
        const gain = this.track(ctx.createGain());
        const start = ctx.currentTime;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.08, start + 3);
        gain.gain.setValueAtTime(0.08, start + 5);
        gain.gain.linearRampToValueAtTime(0, start + 12);
        oscillator.connect(gain); gain.connect(this.musicGain); gain.connect(this.reverb);
        this.musicSources.add(oscillator);
        this.cleanup(oscillator, [oscillator, gain]);
        oscillator.start(start); oscillator.stop(start + 12.05);
      }
    }
  }
}
