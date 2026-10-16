import { dockingAssistPort } from '../../game/dockingAssist';
import type { WorldVessel } from '../../game/world';
import type { ControlInput } from '../../sim/vessel/runtime';
import { assistFrame, createAssist, type AssistId, type AssistOptions } from '../assist';
import type { FlightController } from '../controller';
import type { FlightControllerInternals } from './internals';


export function startAssist(this: FlightController, _internals: FlightControllerInternals, id: AssistId, opts?: AssistOptions): void {
  if (this.network) return;
  if (!this.world.active || this.world.active.state.eva || !this.world.canControl()) return;
  try {
    const port = id === 'dock' ? dockingAssistPort(this.world, this.ownPortUid) : null;
    this.assist = createAssist(id, this.world, { ...opts, ownPortUid: this.ownPortUid });
    if (id === 'dock') {
      this.ownPortUid = port?.part.uid ?? null;
      this.sasOn = true;
      this.sas = 'portAlign';
      this.rcsOn = true;
      this.dockingMode = true;
      this.speedMode = 'target';
    }
    // The program owns time warp from here on: drop any "warp to" so the two never fight. Starting it answers any
    // alarm already holding warp, as changing warp by hand does.
    this.warpDriver.cancel(this.world);
    this.world.alarmClock.acknowledge();
    this.world.message(`Assist: ${this.assist.name}`);
  } catch (e) {
    this.world.message((e as Error).message, 'warn');
  }
}


export function cancelAssist(this: FlightController, internals: FlightControllerInternals, msg = 'Assist cancelled'): void {
  if (!this.assist) return;
  const restore = this.assist.release?.() ?? [];
  if (restore.length) this.command(...restore);
  this.assist = null;
  // Never hand back a vessel packed on rails: it would ignore throttle, attitude and SAS until warp changes.
  if (this.world.warp.mode === 'rails' && this.world.warp.index > 0) this.world.warp = { mode: 'rails', index: 0 };
  internals.assistWarped = false;
  this.input.state.throttle = 0;
  handBack(this);
  this.world.message(msg, 'warn');
}

/** After a program the craft holds its attitude: SAS on, and in a mode that still has something to point at. */
function handBack(c: FlightController) {
  if (!c.sasOn || c.sas === 'off' || (c.sas === 'maneuver' && !c.world.nodes.length)) {
    c.sasOn = true;
    c.sas = 'stabilityAssist';
  }
}

/** Apply the assist after manual controls have been assembled for this frame. */
export function driveAssist(this: FlightController, internals: FlightControllerInternals, wv: WorldVessel | null, ctrl: ControlInput, dt: number): ControlInput {
  // Consumed every frame (assist or not) so a throttle press made before an assist starts cannot cancel it later.
  const throttleTouched = this.input.takeThrottleInput();
  if (!this.assist || !wv || this.paused) return ctrl;
  const state = { warped: internals.assistWarped };
  const frame = assistFrame(this.world, this.assist, ctrl, dt, state, throttleTouched);
  internals.assistWarped = state.warped;
  if (frame.ended) {
    this.assist = null;
    // 0 after a program; the pilot's own setting when their throttle input is what ended it (e.g. a cut).
    this.input.state.throttle = frame.input.throttle;
    handBack(this);
    this.world.message(frame.ended.message, frame.ended.reason === 'done' ? 'info' : 'warn');
  } else this.input.state.throttle = frame.input.throttle;
  return frame.input;
}
