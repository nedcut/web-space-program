/**
 * Keyboard flight controls (original layout, familiar to genre players):
 *  W/S pitch, A/D yaw, Q/E roll, Shift/Ctrl throttle up/down, Z full, X cut,
 *  Space stage, T SAS, R RCS, M map, , . time warp, / stop warp, G gear toggle, B brakes (hold),
 *  I/K translate fwd/back, J/L left/right, H/N up/down, Alt+key fine control (half rate).
 */
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

export type FlightAction = 'stage' | 'toggleSas' | 'toggleRcs' | 'map' | 'warpUp' | 'warpDown' | 'warpStop' | 'menu' | 'focusNext' | 'toggleCamMode' | 'quicksave' | 'quickload' | 'toggleGear';

export class FlightInput {
  readonly state: FlightInputState = { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0, brakes: false };
  private held = new Set<string>();
  private listeners = new Set<(a: FlightAction) => void>();
  invertPitch = false;
  /** Disable throttle/attitude handling, e.g. while typing in a text field. */
  enabled = true;

  constructor(private target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  dispose() {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  onAction(fn: (a: FlightAction) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(a: FlightAction) {
    this.listeners.forEach((l) => l(a));
  }

  private onBlur = () => this.held.clear();

  private onDown = (e: KeyboardEvent) => {
    if (!this.enabled || (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))) return;
    const k = e.code;
    if (!e.repeat) {
      switch (k) {
        case 'Space': this.emit('stage'); e.preventDefault(); break;
        case 'KeyT': this.emit('toggleSas'); break;
        case 'KeyR': this.emit('toggleRcs'); break;
        case 'KeyM': this.emit('map'); break;
        case 'Period': this.emit('warpUp'); break;
        case 'Comma': this.emit('warpDown'); break;
        case 'Slash': this.emit('warpStop'); break;
        case 'Escape': this.emit('menu'); break;
        case 'BracketRight': this.emit('focusNext'); break;
        case 'KeyV': this.emit('toggleCamMode'); break;
        case 'KeyG': this.emit('toggleGear'); break;
        case 'F5': this.emit('quicksave'); e.preventDefault(); break;
        case 'F9': this.emit('quickload'); e.preventDefault(); break;
        case 'KeyZ': this.state.throttle = 1; break;
        case 'KeyX': this.state.throttle = 0; break;
      }
    }
    this.held.add(k);
  };

  private onUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };

  /** Call once per frame with real dt (seconds). */
  update(dt: number) {
    const h = this.held;
    const fine = h.has('AltLeft') || h.has('AltRight') || h.has('CapsLock') ? 0.35 : 1;
    const axis = (pos: string, neg: string) => ((h.has(pos) ? 1 : 0) - (h.has(neg) ? 1 : 0)) * fine;
    const s = this.state;
    s.pitch = axis('KeyS', 'KeyW') * (this.invertPitch ? -1 : 1);
    s.yaw = axis('KeyD', 'KeyA');
    s.roll = axis('KeyE', 'KeyQ');
    s.tx = axis('KeyL', 'KeyJ');
    s.ty = axis('KeyI', 'KeyK');
    s.tz = axis('KeyH', 'KeyN');
    s.brakes = h.has('KeyB');
    const thr = (h.has('ShiftLeft') || h.has('ShiftRight') ? 1 : 0) - (h.has('ControlLeft') || h.has('ControlRight') ? 1 : 0);
    if (thr) s.throttle = Math.min(1, Math.max(0, s.throttle + thr * dt * 0.8));
  }
}
