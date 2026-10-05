import { game } from '../game/store';
import { getBindings, isTyping, matches, type Action } from '../input/bindings';
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

export type FlightAction = 'stage' | 'toggleSas' | 'toggleRcs' | 'map' | 'warpUp' | 'warpDown' | 'warpStop' | 'menu' | 'focusNext' | 'toggleCamMode' | 'quicksave' | 'quickload' | 'eva' | 'board' | 'plantFlag' | 'toggleGear';

const FLIGHT_ACTIONS: FlightAction[] = ['stage', 'toggleSas', 'toggleRcs', 'map', 'warpUp', 'warpDown', 'warpStop', 'menu', 'focusNext', 'toggleCamMode', 'quicksave', 'quickload', 'eva', 'board', 'plantFlag', 'toggleGear'];
export class FlightInput {
  readonly state: FlightInputState = { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0, brakes: false };
  private held = new Set<string>();
  private listeners = new Set<(a: FlightAction) => void>();
  private buttons = new Set<number>();
  private stageHeld = 0;
  private stageConfirmed = false;
  private padIndex: number | null = null;
  private mouse = { x: 0, y: 0 };
  precision = false;
  gamepadConnected = false;
  stageProgress = 0;
  invertPitch = false;
  evaMode = false;
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
  private onBlur = () => { this.held.clear(); this.mouse = { x: 0, y: 0 }; this.resetPad(); };
  private onMouse = (e: PointerEvent) => {
    // Right-button drag remains the camera control; left-button drag is optional flight assist.
    if (game.get().settings.mouseFlight && e.buttons === 1 && e.target instanceof HTMLCanvasElement) {
      this.mouse.x = Math.max(-1, Math.min(1, this.mouse.x + e.movementX * 0.01));
      this.mouse.y = Math.max(-1, Math.min(1, this.mouse.y + e.movementY * 0.01));
    } else this.mouse = { x: 0, y: 0 };
  };
  private down(a: Action) {
    return getBindings()[a].some(k => {
      const parts = k.split('+');
      const code = parts.pop()!;
      return this.held.has(code) && parts.every(p => p === 'Ctrl' ? this.held.has('ControlLeft') || this.held.has('ControlRight') : p === 'Shift' ? this.held.has('ShiftLeft') || this.held.has('ShiftRight') : p === 'Alt' && (this.held.has('AltLeft') || this.held.has('AltRight')));
    });
  }
  private onDown = (e: KeyboardEvent) => {
    if (isTyping(e.target)) { this.held.clear(); return; }
    if (!this.enabled) { this.held.clear(); if (!e.repeat && matches('menu', e)) { e.preventDefault(); this.emit('menu'); } return; }
    if (e.metaKey) return;
    const actions = (Object.keys(getBindings()) as Action[]).filter(a => !a.startsWith('editor') && matches(a, e));
    if (actions.length) e.preventDefault();
    this.held.add(e.code);
    if (e.repeat) return;
    if (actions.includes('precision')) this.precision = !this.precision;
    for (const a of FLIGHT_ACTIONS) if (actions.includes(a) && (!(a === 'board' || a === 'plantFlag') || this.evaMode)) this.emit(a);
    if (!this.evaMode && actions.includes('throttleFull')) this.state.throttle = 1;
    if (!this.evaMode && actions.includes('throttleCut')) this.state.throttle = 0;
  };
  private onUp = (e: KeyboardEvent) => { this.held.delete(e.code); };
  private resetPad() { this.buttons.clear(); this.stageHeld = this.stageProgress = 0; this.stageConfirmed = false; this.padIndex = null; }
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
      return;
    }
    const pads = settings.gamepadEnabled ? this.target.navigator.getGamepads?.() : undefined;
    const pad = pads && [...pads].find(p => p?.connected && p.mapping === 'standard');
    this.gamepadConnected = !!pad;
    let analog = { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0, brakes: false, run: false };
    if (pad) {
      analog = mapGamepad(pad, settings.deadZone, settings.sensitivity, this.evaMode);
      const now = new Set(pad.buttons.flatMap((b, i) => b.pressed ? [i] : []));
      // On connect/reconnect, held buttons are latched until released.
      const connected = this.padIndex !== pad.index;
      if (connected) { this.buttons = now; this.stageConfirmed = now.has(0); this.padIndex = pad.index; }
      const actions: [number, FlightAction][] = [[2, 'toggleSas'], [3, 'toggleRcs'], [8, 'map'], [9, 'menu'], [12, 'warpUp'], [13, 'warpDown'], [14, 'warpStop']];
      for (const [b, a] of actions) if (!connected && now.has(b) && !this.buttons.has(b)) this.emit(a);
      if (now.has(0)) {
        this.stageHeld += dt;
        this.stageProgress = Math.min(1, this.stageHeld / 0.75);
        if (!this.stageConfirmed && this.stageHeld >= 0.75) { this.emit('stage'); this.stageConfirmed = true; }
      } else { this.stageHeld = this.stageProgress = 0; this.stageConfirmed = false; }
      if (this.evaMode && !connected && now.has(1) && !this.buttons.has(1)) this.emit('board');
      this.buttons = now;
    } else this.resetPad();
    const fine = this.precision || this.held.has('AltLeft') || this.held.has('AltRight') ? 0.35 : 1;
    const axis = (pos: Action, neg: Action) => Number(this.down(pos)) - Number(this.down(neg));
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const targets = this.evaMode ? {
      pitch: 0, yaw: 0, roll: 0, tx: axis('evaRight', 'evaLeft') + analog.tx,
      ty: axis('evaUp', 'evaDown') + analog.ty + analog.throttle, tz: axis('evaBack', 'evaForward') + analog.tz,
    } : {
      pitch: (axis('pitchDown', 'pitchUp') + analog.pitch + (settings.mouseFlight ? this.mouse.y : 0)) * (settings.invertPitch || this.invertPitch ? -1 : 1),
      yaw: axis('yawRight', 'yawLeft') + analog.yaw + (settings.mouseFlight ? this.mouse.x : 0), roll: axis('rollRight', 'rollLeft') + analog.roll,
      tx: axis('translateRight', 'translateLeft') + analog.tx, ty: axis('translateForward', 'translateBack') + analog.ty, tz: axis('translateUp', 'translateDown') + analog.tz,
    };
    const alpha = settings.inputSmoothing > 0 ? 1 - Math.exp(-dt / settings.inputSmoothing) : 1;
    for (const a of ['pitch', 'yaw', 'roll', 'tx', 'ty', 'tz'] as const) {
      this.state[a] += (clamp(targets[a]) * fine - this.state[a]) * alpha;
      if (Math.abs(this.state[a]) < 0.0001) this.state[a] = 0;
    }
    this.state.brakes = !this.evaMode && (this.down('brakes') || analog.brakes);
    if (this.evaMode) this.state.throttle = 0;
    else this.state.throttle = Math.max(0, Math.min(1, this.state.throttle + (axis('throttleUp', 'throttleDown') + analog.throttle) * dt * 0.8));
  }
}
