import { autoDock } from '../game/dockingAssist';
import type { World } from '../game/world';
import {
  ascentGuidance,
  executeNode,
  landingController,
  planCircularization,
  type Autopilot,
  type AutopilotStep,
} from '../game/autopilot';
import { RAILS_WARP } from '../game/timewarp';
import { neutralInput } from '../sim/vessel';
import type { ControlInput } from '../sim/vessel/runtime';
import { formatDuration } from '../util/format';

/**
 * Flight assist ("autopilot") programs exposed in the HUD. Each is a sequence of autopilot stages built
 * lazily, so later stages are planned from the state the earlier ones leave behind.
 */
export type AssistId = 'orbit' | 'node' | 'land' | 'circAp' | 'circPe' | 'dock';

export const ASSIST_LABELS: Record<AssistId, string> = {
  dock: 'Auto-dock',
  orbit: 'Launch to orbit',
  node: 'Execute next node',
  land: 'Land here',
  circAp: 'Circularize at Ap',
  circPe: 'Circularize at Pe',
};

class Sequence implements Autopilot {
  readonly name: string;
  status = 'starting';
  done = false;
  error?: string;
  private current: Autopilot | null = null;
  release() { return this.current?.release?.() ?? []; }
  private i = 0;
  constructor(name: string, private stages: ((w: World) => Autopilot)[]) {
    this.name = name;
  }
  update(world: World): AutopilotStep {
    while (!this.current || this.current.done) {
      if (this.i >= this.stages.length) {
        this.done = true;
        // Keep the last stage's own result ("landed · touchdown 1.4 m/s", "Done · 0.2 m/s off the plan").
        this.status = this.current?.status ?? 'complete';
        return { input: neutralInput({ sas: 'stabilityAssist' }) };
      }
      try {
        this.current = this.stages[this.i++](world);
      } catch (e) {
        this.error = (e as Error).message;
        return { input: neutralInput({ sas: 'stabilityAssist' }) };
      }
    }
    const step = this.current.update(world);
    this.status = this.current.status;
    if (this.current.error) this.error = this.current.error;
    return step;
  }
}

/** Coast on rails until `until` (e.g. so a landing touches down in daylight). */
function waitUntil(until: number, why: string): Autopilot {
  const ap: Autopilot = {
    name: 'wait',
    status: why,
    done: false,
    update(w) {
      if (w.ut >= until) ap.done = true;
      ap.status = `${why} · ${formatDuration(Math.max(0, until - w.ut))}`;
      return { input: neutralInput({ sas: 'stabilityAssist' }), coastUntil: until };
    },
  };
  return ap;
}

export interface AssistOptions {
  /** Land: seconds to coast before the descent starts (wait for daylight at the touchdown). */
  wait?: number;
  /** Dock: selected own port; otherwise prefer the controlling free port. */
  ownPortUid?: number | null;
}

export function createAssist(id: AssistId, world: World, opts: AssistOptions = {}): Autopilot {
  const wv = world.active!;
  const body = world.universe.body(wv.body);
  const atmo = body.atmosphere?.height ?? 0;
  const targetAp = Math.max(atmo + body.radius * 0.02, body.radius * 0.03 + 5000);
  const circ = (at: 'apoapsis' | 'periapsis') => (w: World) => {
    w.nodes = [];
    return executeNode(w, planCircularization(w, at));
  };
  switch (id) {
    case 'dock': return autoDock(world, opts.ownPortUid);
    case 'orbit':
      return new Sequence('Launch to orbit', [(w) => ascentGuidance(w, { targetApoapsis: targetAp }), circ('apoapsis')]);
    case 'node':
      return new Sequence('Execute node', [
        (w) => {
          const n = [...w.nodes].sort((a, b) => a.time - b.time)[0];
          if (!n) throw new Error('No maneuver node planned');
          return executeNode(w, n);
        },
      ]);
    case 'circAp':
      return new Sequence('Circularize', [circ('apoapsis')]);
    case 'circPe':
      return new Sequence('Circularize', [circ('periapsis')]);
    case 'land':
      return new Sequence('Land', [
        ...(opts.wait ? [() => waitUntil(world.ut + opts.wait!, 'waiting for daylight at the touchdown · descent in')] : []),
        (w: World) => landingController(w),
      ]);
  }
}

/** Pick a rails warp index that won't overshoot `until` at roughly `frameDt` seconds per frame. */
export function warpIndexFor(remaining: number, frameDt = 0.1): number {
  let idx = 0;
  for (let i = 1; i < RAILS_WARP.length; i++) if (RAILS_WARP[i] * frameDt * 3 <= remaining) idx = i;
  return idx;
}

/** Per-program driver state kept by the flight scene between frames. */
export interface AssistDriveState {
  /** The program put the world into rails warp (it releases that warp when it stops coasting or ends). */
  warped: boolean;
}

export interface AssistFrame {
  /** Input to hand World.tick this frame. */
  input: ControlInput;
  /** Set when the program ended this frame: completed, failed or overridden by the pilot. */
  ended?: { reason: 'done' | 'error' | 'pilot'; message: string };
}

/** Leave rails warp: a packed vessel ignores throttle, attitude and SAS, so no program may end with it on. */
function releaseRailsWarp(world: World) {
  if (world.warp.mode === 'rails' && world.warp.index > 0) world.warp = { mode: 'rails', index: 0 };
}

/**
 * One frame of a flight-assist program, as the flight scene runs it. The program owns time warp while it runs:
 * it rails-warps only while it coasts, and every other frame (and its end, however it ends) runs at 1× even if
 * someone else had warp on, so control is never handed back to a vessel stuck on rails. The pilot's part commands,
 * staging, RCS, gear and brakes pass through; any attitude or throttle input ends the program.
 */
export function assistFrame(world: World, assist: Autopilot, pilot: ControlInput, dt: number, state: AssistDriveState, pilotThrottle = false): AssistFrame {
  const end = (reason: 'done' | 'error' | 'pilot', message: string, keepThrottle = false): AssistFrame => {
    releaseRailsWarp(world);
    state.warped = false;
    const restore = assist.release?.() ?? [];
    const commands = [...(pilot.commands ?? []), ...restore];
    return { input: { ...pilot, throttle: keepThrottle ? pilot.throttle : 0, commands: commands.length ? commands : undefined }, ended: { reason, message } };
  };
  // Pilot override: attitude input, or any throttle input (`pilotThrottle`: keys or gamepad touched the throttle this
  // frame). A throttle override applies the pilot's throttle this same frame (e.g. an emergency cut).
  if (pilotThrottle) return end('pilot', 'Assist cancelled: manual control', true);
  if (pilot.pitch || pilot.yaw || pilot.roll || (assist.cancelOnAnyInput && (pilot.translateX || pilot.translateY || pilot.translateZ || pilot.stage || pilot.commands?.length || pilot.gear !== undefined || pilot.brakes))) return end('pilot', 'Assist cancelled: manual control');
  const step = assist.update(world);
  // A node alarm is the pilot's reminder to fly the burn; the program is flying, so it must not pin warp at 1× (an
  // unacknowledged hold from an earlier node used to keep every later coast at 1×).
  if (world.alarmClock.held && world.alarmClock.holdReason === 'node') world.alarmClock.acknowledge();
  // Mission alarms stop coasting automation; a burn/descent already in progress continues safely at 1×.
  if (world.alarmClock.held && world.alarmClock.holdReason === 'other' && step.coastUntil !== undefined) return end('pilot', 'Assist paused at mission alarm; acknowledge and restart to continue');
  if (assist.error) return end('error', `Assist stopped: ${assist.error}`);
  if (assist.done) return end('done', `${assist.name}: ${assist.status || 'complete'}`);
  const commands = [...(step.input.commands ?? []), ...(pilot.commands ?? [])];
  const input: ControlInput = {
    ...step.input,
    stage: step.input.stage || pilot.stage,
    commands: commands.length ? commands : undefined,
    rcs: step.input.rcs || pilot.rcs,
    gear: step.input.gear ?? pilot.gear,
    brakes: pilot.brakes,
    target: step.input.target ?? pilot.target,
  };
  if (step.coastUntil !== undefined) {
    const idx = warpIndexFor(step.coastUntil - world.ut, dt);
    world.warp = { mode: 'rails', index: world.alarmClock.held ? 0 : idx };
    state.warped = world.warp.index > 0;
  } else {
    releaseRailsWarp(world);
    state.warped = false;
  }
  return { input };
}
