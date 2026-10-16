/**
 * The genre's classic first rocket (capsule, chute, decoupler, tank, engine; no heat shield) flown straight up and
 * brought down three ways: npx tsx scripts/career/bare-pod.ts [shield]
 * Prints chute phase changes (with speed and dynamic pressure) and the touchdown speed for each descent mode.
 */
import '../earth-data/register';
import { World } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { PART_CATALOG } from '../../src/data/parts';
import { DEFAULT_START_UT } from '../../src/game/store';
import { Builder } from '../../src/editor/stockCrafts';
import { neutralInput } from '../../src/sim/vessel';
import { localFrame, propulsion } from '../../src/game/autopilot';
import { length, normalize, scale } from '../../src/util/vec3';
import type { CraftDef } from '../../src/sim/vessel/types';

export type DescentMode = 'retrograde' | 'prograde' | 'off';

export function firstRocket(shield = false): CraftDef {
  const b = new Builder(PART_CATALOG, 'First Rocket', 'Capsule, chute, tank, engine.');
  const pod = b.root('pod-lantern-1');
  b.stack(pod, 'chute-main', 'top');
  const dec = b.stack(shield ? b.stack(pod, 'shield-1') : pod, 'dec-1');
  const tank = b.stack(dec, 'tank-1-mid');
  b.stack(tank, 'eng-sirocco');
  return b.done();
}

export interface DescentLog { mode: DescentMode; apex: number; touchdown: number; maxG: number; lost: boolean; events: string[] }

/**
 * Launch straight up at full throttle, coast, stage everything at the top, then fall under `mode` attitude.
 * `world`/`craft` fly something else (e.g. a career world); `onTick` runs after every physics step.
 */
export function flyFirstRocket(mode: DescentMode, shield = false, opts: { world?: World; craft?: CraftDef; onTick?: (w: World) => void } = {}): DescentLog {
  const w = opts.world ?? new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT, 'sandbox');
  w.launch(opts.craft ?? firstRocket(shield));
  const events: string[] = [];
  let apex = 0, maxG = 0, lit = false, staged = false, last = 0;
  const atmo = w.universe.body('earth').atmosphere!.height;
  const phases = new Map<number, string>();
  for (let k = 0; k < 50 * 3000 && w.active && !w.active.state.destroyed; k++) {
    const f = localFrame(w, w.active);
    const v = length(f.surfVel);
    apex = Math.max(apex, f.altitude);
    const s = w.active.state;
    if ((s.situation === 'landed' || s.situation === 'splashed') && lit && k > 500) break;
    const falling = f.surfVel.x * f.up.x + f.surfVel.y * f.up.y + f.surfVel.z * f.up.z < 0;
    let input;
    if (!lit || propulsion(s).thrust > 0) {
      input = neutralInput({ sas: 'maneuver', maneuverDirection: f.up, throttle: 1, stage: !lit });
      lit = true;
    } else {
      const stage = !staged && falling && f.altitude < atmo;
      if (stage) staged = true;
      const dir = v > 1 ? normalize(f.surfVel) : f.up;
      input = mode === 'off' ? neutralInput({ throttle: 0, stage })
        : neutralInput({ sas: 'maneuver', maneuverDirection: mode === 'retrograde' ? scale(dir, -1) : dir, throttle: 0, stage });
      if (stage) for (let i = 0; i < 4 && w.active.state.nextStage >= 0; i++) w.stageActive();
    }
    w.warp = { mode: 'rails', index: 0 };
    w.tick(0.02, input);
    opts.onTick?.(w);
    if (!w.active) break;
    const g = w.active.state.telemetry.gForce;
    if (staged) maxG = Math.max(maxG, g);
    for (const p of w.active.state.parts) {
      if (!p.chute) continue;
      if (phases.get(p.uid) !== p.chute.phase) {
        phases.set(p.uid, p.chute.phase);
        events.push(`${p.chute.phase} at ${(f.altitude / 1000).toFixed(1)} km, ${v.toFixed(0)} m/s, q ${(w.active.state.telemetry.dynamicPressure / 1000).toFixed(1)} kPa`);
      }
    }
    last = v;
  }
  const lost = !w.active || w.active.state.destroyed || !w.active.state.parts.some(p => p.crew?.length);
  return { mode, apex, touchdown: last, maxG, lost, events };
}

if (process.argv[1]?.endsWith('bare-pod.ts')) {
  const shield = process.argv.includes('shield');
  for (const mode of ['retrograde', 'prograde', 'off'] as const) {
    const r = flyFirstRocket(mode, shield);
    console.log(`${shield ? 'shield' : 'bare'} ${mode}: apex ${(r.apex / 1000).toFixed(0)} km, touchdown ${r.touchdown.toFixed(1)} m/s, max ${r.maxG.toFixed(1)} g after staging, ${r.lost ? 'CREW LOST' : 'recovered'}`);
    for (const e of r.events) console.log(`  chute ${e}`);
  }
}
