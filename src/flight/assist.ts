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

/**
 * Flight assist ("autopilot") programs exposed in the HUD. Each is a sequence of autopilot stages built
 * lazily, so later stages are planned from the state the earlier ones leave behind.
 */
export type AssistId = 'orbit' | 'node' | 'land' | 'circAp' | 'circPe';

export const ASSIST_LABELS: Record<AssistId, string> = {
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
  private i = 0;
  constructor(name: string, private stages: ((w: World) => Autopilot)[]) {
    this.name = name;
  }
  update(world: World): AutopilotStep {
    while (!this.current || this.current.done) {
      if (this.i >= this.stages.length) {
        this.done = true;
        this.status = 'complete';
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

export function createAssist(id: AssistId, world: World): Autopilot {
  const wv = world.active!;
  const body = world.universe.body(wv.body);
  const atmo = body.atmosphere?.height ?? 0;
  const targetAp = Math.max(atmo + body.radius * 0.02, body.radius * 0.03 + 5000);
  const circ = (at: 'apoapsis' | 'periapsis') => (w: World) => {
    w.nodes = [];
    return executeNode(w, planCircularization(w, at));
  };
  switch (id) {
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
      return new Sequence('Land', [(w) => landingController(w)]);
  }
}

/** Pick a rails warp index that won't overshoot `until` at roughly `frameDt` seconds per frame. */
export function warpIndexFor(remaining: number, frameDt = 0.1): number {
  let idx = 0;
  for (let i = 1; i < RAILS_WARP.length; i++) if (RAILS_WARP[i] * frameDt * 3 <= remaining) idx = i;
  return idx;
}
