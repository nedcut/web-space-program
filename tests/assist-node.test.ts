import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { coastUntil, planTransferToBody, type Autopilot } from '../src/game/autopilot';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { PART_CATALOG as CATALOG } from '../src/data/parts';
import { assistFrame, createAssist } from '../src/flight/assist';
import { maneuverToInertialDv, periapsisRadius, propagate, stateToElements } from '../src/sim/orbit';
import { neutralInput } from '../src/sim/vessel';
import { add, cross, dot, length, normalize, sub } from '../src/util/vec3';
import { requireIntactFlight } from './helpers/structural';

/** The flight scene's assist loop (`assistFrame`) at 60 fps with the pilot's hands off. */
function driveLikeFlightScene(world: World, assist: Autopilot, maxSeconds: number, onFrame?: () => void) {
  const dt = 1 / 60;
  const state = { warped: false };
  const end = world.ut + maxSeconds;
  while (world.ut < end) {
    const frame = assistFrame(world, assist, neutralInput({ sas: 'stabilityAssist' }), dt, state);
    world.tick(dt, frame.input);
    onFrame?.();
    if (frame.ended) return frame.ended;
  }
  return undefined;
}

/** `?scenario=orbit` with the stock Selene: the whole unstaged launcher placed in a circular orbit due east of the pad. */
function seleneInOrbit(phase = 0) {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT + phase * 86400);
  requireIntactFlight(world);
  const wv = world.launch(STOCK_CRAFTS.find(c => c.id === 'stock-selene')!.build());
  placeInCircularOrbit(world, wv, 'earth', Math.max(90000, world.universe.body('earth').atmosphere!.height + 80000));
  return { world, wv };
}

function moonPe(world: World): number | undefined {
  const patches = world.trajectory();
  const i = patches.findIndex(p => p.nextBody === 'moon' && p.endReason === 'soiEnter');
  return i >= 0 && patches[i + 1] ? periapsisRadius(patches[i + 1].orbit) - world.universe.body('moon').radius : undefined;
}

describe('Execute-node assist', () => {
  it.each([0, 2.3, 5.1])('flies a planned Moon transfer from the stock Selene orbit scenario on plan (start +%s d; stages, leads the burn)', phase => {
    const { world, wv } = seleneInOrbit(phase);
    world.tick(0.1, neutralInput());
    const plan = planTransferToBody(world, 'moon');
    expect(plan).not.toBeNull();
    const node = world.nodes[0];
    const sNode = propagate(world.orbitOf(wv), node.time);
    const target = add(sNode.velocity, maneuverToInertialDv(sNode, node));
    const assist = createAssist('node', world);
    const log: string[] = [];
    let head = '';
    let firstThrust = NaN;
    const stage0 = wv.state.nextStage;
    let stage = stage0;
    const ended = driveLikeFlightScene(world, assist, 10 * 86400, () => {
      const v = world.active!.state;
      const h = assist.status.split(' · ')[0];
      if (h !== head) { head = h; log.push(`${(world.ut - node.time).toFixed(1)} s  ${assist.status}`); }
      if (Number.isNaN(firstThrust) && v.telemetry.thrust > 0) firstThrust = world.ut - node.time;
      if (v.nextStage !== stage) { stage = v.nextStage; log.push(`${(world.ut - node.time).toFixed(1)} s  staged, next stage ${stage}`); }
    });
    const residual = length(sub(target, propagate(world.orbitOf(world.active!), node.time).velocity));
    if (process.env.NODE_DEBUG) {
      const o = world.orbitOf(world.active!), mu = o.mu, planned = stateToElements(mu, o.body, sNode.position, target, node.time);
      const dE = mu / (2 * o.a) - mu / (2 * planned.a);
      const h1 = normalize(cross(sNode.position, target)), s1 = propagate(o, node.time), h2 = normalize(cross(s1.position, s1.velocity));
      console.log(`energy short ${(dE / length(target)).toFixed(3)} m/s; plane tilt ${(Math.acos(Math.min(1, dot(h1, h2))) * 180 / Math.PI * 3600).toFixed(1)} arcsec; argPe Δ ${((o.argPe - planned.argPe) * 180 / Math.PI).toFixed(4)}°; e ${planned.e.toFixed(5)}→${o.e.toFixed(5)}`);
    }
    const pe = moonPe(world);
    console.log([...log, `plan ${plan!.dv.toFixed(1)} m/s, Moon periapsis ${(plan!.periapsisAltitude / 1000).toFixed(1)} km`,
      `first thrust ${firstThrust.toFixed(1)} s from the node; residual ${residual.toFixed(2)} m/s; encounter periapsis ${pe !== undefined ? (pe / 1000).toFixed(1) : 'none'} km`].join('\n'));
    expect(ended?.reason, assist.error).toBe('done');
    // It staged the unstaged launcher itself and lit the engine before the node (half the burn early).
    expect(wv.state.nextStage).toBeLessThan(stage0);
    expect(firstThrust).toBeLessThan(-10);
    expect(residual).toBeLessThan(3);
    expect(pe).toBeDefined();
    expect(Math.abs(pe! - plan!.periapsisAltitude)).toBeLessThan(10000);
    expect(world.nodes).toHaveLength(0);
    // The fine-trim thrust limiter is the player's setting again.
    world.tick(0.1, neutralInput({ sas: 'stabilityAssist' }));
    expect(wv.state.parts.filter(p => p.engine).every(p => p.tweaks?.thrustLimit === undefined)).toBe(true);
    // Handed back at 1×, flyable.
    expect(world.warp.index).toBe(0);
    expect(world.active!.mode).toBe('physics');
  }, 600_000);

  // QA: quickload ~30 s before the node, then Execute node, gave a 297 km lunar periapsis for a 30 km plan. With the
  // low-thrust Zephyr stage (≈2.4 min burn) the centred start is already past: the burn runs late, and a quarter-turn
  // aim point let it swing the transfer. Mid-burn reloads resume from the saved frozen plan (node.anchor).
  it.each(['reload before the burn', 'reload mid-burn'] as const)('hits the planned lunar periapsis after a %s on the low-thrust transfer stage', mode => {
    let { world } = seleneInOrbit();
    // Booster, its decoupler, then the Zephyr transfer stage.
    for (let k = 0; k < 3; k++) {
      world.tick(1 / 60, neutralInput({ stage: true }));
      for (let i = 0; i < 90; i++) world.tick(1 / 60, neutralInput({ sas: 'stabilityAssist' }));
    }
    expect(world.active!.state.nextStage).toBe(3);
    const plan = planTransferToBody(world, 'moon')!;
    const node = world.nodes[0];
    if (mode === 'reload mid-burn') {
      const first = createAssist('node', world);
      driveLikeFlightScene(world, first, node.time - 30 - world.ut);
      expect(world.active!.state.telemetry.thrust).toBeGreaterThan(0);
      expect(world.nodes[0].anchor).toBeDefined();
    } else coastUntil(world, node.time - 30);
    world = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))), CATALOG);
    const assist = createAssist('node', world);
    const ended = driveLikeFlightScene(world, assist, 86400);
    const pe = moonPe(world);
    console.log(`${mode}: plan ${(plan.periapsisAltitude / 1000).toFixed(1)} km, got ${pe !== undefined ? (pe / 1000).toFixed(1) : 'none'} km; ${ended?.message}`);
    expect(ended?.reason, assist.error).toBe('done');
    expect(pe).toBeDefined();
    expect(Math.abs(pe! - plan.periapsisAltitude)).toBeLessThan(10000);
  }, 300_000);
});
