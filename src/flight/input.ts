import { game } from '../game/store';
import { getBindings, isFlightChord, isTyping, matches, type Action } from '../input/bindings';
import { mapGamepad } from '../input/gamepad';
export interface FlightInputState {
  pitch: number;
  yaw: number;
  roll: number;
  tx: number;
  ty: number;
  tz: number;
  throttle: number;
  /** Wheel brakes held (B). */
  brakes: boolean;
}

export type ActionGroupKey = 'actionGroup1' | 'actionGroup2' | 'actionGroup3' | 'actionGroup4' | 'actionGroup5' | 'actionGroup6' | 'actionGroup7' | 'actionGroup8' | 'actionGroup9' | 'actionGroup10';
export type FlightAction = 'stage' | 'toggleSas' | 'toggleRcs' | 'map' | 'warpUp' | 'warpDown' | 'warpStop' | 'menu' | 'focusNext' | 'focusPrev' | 'toggleCamMode' | 'iva' | 'quicksave' | 'quickload' | 'eva' | 'board' | 'plantFlag' | 'toggleGear' | 'stressOverlay' | 'toggleLights' | 'abort' | 'stageLock' | 'sasHold' | 'sasHoldRelease' | 'trimReset' | ActionGroupKey;

/** Keyboard attitude ramp (command units per second): full deflection in 0.2 s, release in ~0.08 s. */
export const KEY_RAMP_RATE = 5;
export const KEY_RELEASE_RATE = 12;
/** Trim (Alt + attitude keys): rate while held (command units/s) and limit. Alt+X clears it. */
export const TRIM_RATE = 0.2;
export const TRIM_LIMIT = 0.5;
/** Throttle ramp for Shift/Ctrl (per second); fine control slows it for precise settings. */
export const THROTTLE_RATE = 0.8;
export const FINE_THROTTLE_RATE = 0.2;

export const ACTION_GROUP_KEYS: ActionGroupKey[] = ['actionGroup1', 'actionGroup2', 'actionGroup3', 'actionGroup4', 'actionGroup5', 'actionGroup6', 'actionGroup7', 'actionGroup8', 'actionGroup9', 'actionGroup10'];
const FLIGHT_ACTIONS: FlightAction[] = ['stage', 'toggleSas', 'toggleRcs', 'map', 'warpUp', 'warpDown', 'warpStop', 'menu', 'focusNext', 'focusPrev', 'toggleCamMode', 'iva', 'quicksave', 'quickload', 'eva', 'board', 'plantFlag', 'toggleGear', 'stressOverlay', 'toggleLights', 'abort', 'stageLock', 'sasHold', ...ACTION_GROUP_KEYS];
/** Vessel-only actions that a walking astronaut ignores. */
const VESSEL_ONLY = new Set<FlightAction>(['abort', 'toggleLights', 'stageLock', 'sasHold', 'iva']);
export class FlightInput {
  readonly state: FlightInputState = { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0, brakes: false };
  /** Camera orbit/zoom rates from arrow keys, +/- and RB + right stick (-1..1). */
  readonly camera = { yaw: 0, pitch: 0, zoom: 0 };
  /** Control trim (added to pitch/yaw/roll by the controller while SAS is off). */
  readonly trim = { pitch: 0, yaw: 0, roll: 0 };
  private held = new Set<string>();
  /** Keys pressed as part of a bound chord (Alt+L): consumed by that action, they drive no plain-key axis until released. */
  private chordKeys = new Set<string>();
  private listeners = new Set<(a: FlightAction) => void>();
  private buttons = new Set<number>();
  private stageHeld = 0;
  private stageConfirmed = false;
  private padIndex: number | null = null;
  private mouse = { x: 0, y: 0 };
  private keyRamp = { pitch: 0, yaw: 0, roll: 0 };
  /** Physical key that started a momentary SAS toggle (F held); its release emits 'sasHoldRelease'. */
  private sasHoldKey: string | null = null;
  precision = false;
  get precisionActive() { return this.precision || this.down('precisionHold'); }
  gamepadConnected = false;
  stageProgress = 0;
  evaMode = false;
  mouseEnabled = true;
  enabled = true;
  get running() { return this.enabled && (this.down('evaRun') || this.buttons.has(10)); }
  constructor(private target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
    target.addEventListener('pointermove', this.onMouse);
  }
  dispose() {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('pointermove', this.onMouse);
  }
  onAction(fn: (a: FlightAction) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(a: FlightAction) { this.listeners.forEach(l => l(a)); }
  private onBlur = () => { this.releaseSasHold(); this.held.clear(); this.chordKeys.clear(); this.mouse = { x: 0, y: 0 }; this.keyRamp = { pitch: 0, yaw: 0, roll: 0 }; this.resetPad(); };
  private onMouse = (e: PointerEvent) => {
    // Right-button drag remains the camera control; left-button drag is optional flight assist.
    if (this.mouseEnabled && game.get().settings.mouseFlight && e.buttons === 1 && e.target instanceof HTMLCanvasElement) {
      this.mouse.x = Math.max(-1, Math.min(1, this.mouse.x + e.movementX * 0.01));
      this.mouse.y = Math.max(-1, Math.min(1, this.mouse.y + e.movementY * 0.01));
    } else this.mouse = { x: 0, y: 0 };
  };
  private down(a: Action) {
    return getBindings()[a].some(k => {
      const parts = k.split('+');
      const code = parts.pop()!;
      if (!parts.length) return this.held.has(code) && !this.chordKeys.has(code);
      return this.held.has(code) && parts.every(p => p === 'Ctrl' ? this.held.has('ControlLeft') || this.held.has('ControlRight') : p === 'Shift' ? this.held.has('ShiftLeft') || this.held.has('ShiftRight') : p === 'Alt' && (this.held.has('AltLeft') || this.held.has('AltRight')));
    });
  }
  private onDown = (e: KeyboardEvent) => {
    if (isTyping(e.target)) { this.held.clear(); return; }
    if (!this.enabled) { this.held.clear(); if (!e.repeat) for (const a of ['menu', 'quickload'] as const) if (matches(a, e)) { e.preventDefault(); this.emit(a); } return; }
    if (e.metaKey) return;
    const actions = (Object.keys(getBindings()) as Action[]).filter(a => !a.startsWith('editor') && matches(a, e));
    if (actions.length) e.preventDefault();
    this.held.add(e.code);
    if (isFlightChord(e)) this.chordKeys.add(e.code);
    if (e.repeat) return;
    if (actions.includes('precision')) this.precision = !this.precision;
    if (actions.includes('trimReset')) { this.trim.pitch = this.trim.yaw = this.trim.roll = 0; this.emit('trimReset'); }
    for (const a of FLIGHT_ACTIONS) if (actions.includes(a as Action) && (!(a === 'board' || a === 'plantFlag') || this.evaMode) && !(this.evaMode && (VESSEL_ONLY.has(a) || a.startsWith('actionGroup')))) {
      if (a === 'sasHold') { if (this.sasHoldKey) continue; this.sasHoldKey = e.code; }
      this.emit(a);
    }
    if (!this.evaMode && actions.includes('throttleFull')) this.state.throttle = 1;
    if (!this.evaMode && actions.includes('throttleCut')) this.state.throttle = 0;
  };
  private onUp = (e: KeyboardEvent) => { this.held.delete(e.code); this.chordKeys.delete(e.code); if (e.code === this.sasHoldKey) this.releaseSasHold(); };
  private releaseSasHold() { if (!this.sasHoldKey) return; this.sasHoldKey = null; this.emit('sasHoldRelease'); }
  private resetPad() { this.buttons.clear(); this.stageHeld = this.stageProgress = 0; this.stageConfirmed = false; this.padIndex = null; this.gamepadConnected = false; }
  update(dt: number) {
    const settings = game.get().settings;
    if (!this.enabled || !this.target.document.hasFocus() || isTyping(this.target.document.activeElement)) {
      // Start can also resume a paused flight; typing/modal focus blocks all gamepad actions.
      if (!this.enabled && this.target.document.hasFocus() && !isTyping(this.target.document.activeElement)) {
        const pads = settings.gamepadEnabled ? this.target.navigator.getGamepads?.() : undefined;
        const pad = pads && [...pads].find(p => p?.connected && p.mapping === 'standard');
        const start = pad?.buttons[9]?.pressed ?? false;
        if (start && !this.buttons.has(9)) this.emit('menu');
        this.buttons = start ? new Set([9]) : new Set();
        this.held.clear(); this.mouse = { x: 0, y: 0 }; this.stageHeld = this.stageProgress = 0; this.stageConfirmed = true;
      } else this.onBlur();
      Object.assign(this.state, { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, brakes: false });
      Object.assign(this.camera, { yaw: 0, pitch: 0, zoom: 0 });
      return;
    }
    const pads = settings.gamepadEnabled ? this.target.navigator.getGamepads?.() : undefined;
    const pad = pads && [...pads].find(p => p?.connected && p.mapping === 'standard');
    this.gamepadConnected = !!pad;
    let analog = { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0, brakes: false, run: false, cameraYaw: 0, cameraPitch: 0 };
    if (pad) {
      analog = mapGamepad(pad, settings.deadZone, settings.sensitivity, this.evaMode);
      const now = new Set(pad.buttons.flatMap((b, i) => b.pressed ? [i] : []));
      // On connect/reconnect, held buttons are latched until released.
      const connected = this.padIndex !== pad.index;
      if (connected) { this.buttons = now; this.stageConfirmed = now.has(0); this.padIndex = pad.index; }
      const actions: [number, FlightAction][] = [[2, 'toggleSas'], [3, 'toggleRcs'], [8, 'map'], [9, 'menu'], [11, 'toggleCamMode'], [12, 'warpUp'], [13, 'warpDown'], [14, 'warpStop']];
      for (const [b, a] of actions) if (!connected && now.has(b) && !this.buttons.has(b)) this.emit(a);
      if (now.has(0)) {
        this.stageHeld += dt;
        this.stageProgress = Math.min(1, this.stageHeld / 0.75);
        if (!this.stageConfirmed && this.stageHeld >= 0.75) { this.emit('stage'); this.stageConfirmed = true; }
      } else { this.stageHeld = this.stageProgress = 0; this.stageConfirmed = false; }
      if (this.evaMode && !connected && now.has(1) && !this.buttons.has(1)) this.emit('board');
      this.buttons = now;
    } else this.resetPad();
    const fine = this.precisionActive ? 0.35 : 1;
    const axis = (pos: Action, neg: Action) => Number(this.down(pos)) - Number(this.down(neg));
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.camera.yaw = clamp(axis('cameraRight', 'cameraLeft') + analog.cameraYaw);
    this.camera.pitch = clamp(axis('cameraUp', 'cameraDown') + analog.cameraPitch);
    this.camera.zoom = axis('cameraZoomOut', 'cameraZoomIn');
    // Keys are digital: ramp attitude keys so a tap gives a small correction and a hold reaches full
    // authority in ~0.2 s; release returns quickly. Analog sticks and translation pass straight through.
    const ramp = (id: 'pitch' | 'yaw' | 'roll', target: number) => {
      const cur = this.keyRamp[id];
      const rate = target === 0 || target * cur < 0 ? KEY_RELEASE_RATE : KEY_RAMP_RATE;
      const next = cur + Math.max(-rate * dt, Math.min(rate * dt, target - cur));
      this.keyRamp[id] = target === 0 && Math.sign(next) !== Math.sign(cur) ? 0 : next;
      return this.keyRamp[id];
    };
    // Alt + attitude keys trims instead of deflecting (the genre's trim keys).
    const trimming = !this.evaMode && (this.held.has('AltLeft') || this.held.has('AltRight'));
    const keyAxes = { pitch: axis('pitchDown', 'pitchUp'), yaw: axis('yawRight', 'yawLeft'), roll: axis('rollRight', 'rollLeft') };
    if (trimming) for (const k of ['pitch', 'yaw', 'roll'] as const) {
      this.trim[k] = Math.max(-TRIM_LIMIT, Math.min(TRIM_LIMIT, this.trim[k] + keyAxes[k] * TRIM_RATE * dt));
    }
    const kPitch = ramp('pitch', this.evaMode || trimming ? 0 : keyAxes.pitch);
    const kYaw = ramp('yaw', this.evaMode || trimming ? 0 : keyAxes.yaw);
    const kRoll = ramp('roll', this.evaMode || trimming ? 0 : keyAxes.roll);
    const targets = this.evaMode ? {
      pitch: 0, yaw: 0, roll: 0, tx: axis('evaRight', 'evaLeft') + analog.tx,
      ty: axis('evaUp', 'evaDown') + analog.ty + analog.throttle, tz: axis('evaBack', 'evaForward') + analog.tz,
    } : {
      pitch: (kPitch + analog.pitch + (settings.mouseFlight && this.mouseEnabled ? this.mouse.y : 0)) * (settings.invertPitch ? -1 : 1),
      yaw: kYaw + analog.yaw + (settings.mouseFlight && this.mouseEnabled ? this.mouse.x : 0), roll: kRoll + analog.roll,
      tx: axis('translateRight', 'translateLeft') + analog.tx, ty: axis('translateForward', 'translateBack') + analog.ty, tz: axis('translateUp', 'translateDown') + analog.tz,
    };
    const alpha = settings.inputSmoothing > 0 ? 1 - Math.exp(-dt / settings.inputSmoothing) : 1;
    for (const a of ['pitch', 'yaw', 'roll', 'tx', 'ty', 'tz'] as const) {
      this.state[a] += (clamp(targets[a]) * fine - this.state[a]) * alpha;
      if (Math.abs(this.state[a]) < 0.0001) this.state[a] = 0;
    }
    this.state.brakes = !this.evaMode && (this.down('brakes') || analog.brakes);
    if (this.evaMode) this.state.throttle = 0;
    else this.state.throttle = Math.max(0, Math.min(1, this.state.throttle + (axis('throttleUp', 'throttleDown') + analog.throttle) * dt * (this.precisionActive ? FINE_THROTTLE_RATE : THROTTLE_RATE)));
  }
}
