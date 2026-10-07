import type { WorldVessel } from '../../game/world';
import type { ControlInput } from '../../sim/vessel/runtime';
import { createAssist, warpIndexFor, type AssistId } from '../assist';
import type { FlightController } from '../controller';
import type { FlightControllerInternals } from './internals';


export function startAssist(this: FlightController, _internals: FlightControllerInternals, id: AssistId): void {
  if (this.network) return;
  if (!this.world.active || this.world.active.state.eva || !this.world.canControl()) return;
  try {
    this.assist = createAssist(id, this.world);
    this.world.message(`Assist: ${this.assist.name}`);
  } catch (e) {
    this.world.message((e as Error).message, 'warn');
  }
}


export function cancelAssist(this: FlightController, internals: FlightControllerInternals, msg = 'Assist cancelled'): void {
  if (!this.assist) return;
  this.assist = null;
  if (internals.assistWarped) this.world.warp = { mode: 'rails', index: 0 };
  internals.assistWarped = false;
  this.world.message(msg, 'warn');
}

/** Apply the assist after manual controls have been assembled for this frame. */
export function driveAssist(this: FlightController, internals: FlightControllerInternals, wv: WorldVessel | null, ctrl: ControlInput, dt: number): ControlInput {
  const s = this.input.state;
  // Consumed every frame so a throttle press made before an assist starts cannot cancel it later.
  const throttleTouched = this.input.takeThrottleInput();
  let input = ctrl;
  if (this.assist && wv && !this.paused) {
    // Any manual attitude/throttle input cancels the assist (pilot override). The pilot's throttle (e.g. a cut)
    // then applies this same frame: `ctrl` already carries it, the assist has not overwritten it yet.
    if (s.pitch || s.yaw || s.roll || throttleTouched) this.cancelAssist('Assist cancelled: manual control');
    else {
      const step = this.assist.update(this.world);
      input = { ...step.input, stage: step.input.stage || ctrl.stage };
      this.input.state.throttle = step.input.throttle;
      if (this.assist.error) this.cancelAssist(`Assist stopped: ${this.assist.error}`);
      else if (this.assist.done) {
        this.world.message(`${this.assist.name}: complete`);
        this.assist = null;
        this.input.state.throttle = 0;
      } else if (step.coastUntil !== undefined) {
        const idx = warpIndexFor(step.coastUntil - this.world.ut, dt);
        this.world.warp = { mode: 'rails', index: idx };
        internals.assistWarped = idx > 0;
      } else if (internals.assistWarped) {
        this.world.warp = { mode: 'rails', index: 0 };
        internals.assistWarped = false;
      }
    }
  }

  return input;
}
