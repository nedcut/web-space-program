import { describe, it, expect } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildRealMoonLander, buildChallengingMoonLander } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import {
  ascentGuidance,
  executeNode,
  planCircularization,
  planTransferToBody,
  planCourseCorrection,
  landingController,
  runAutopilot,
  coastUntil,
  localFrame,
  radarAltitude,
  propulsion,
  noseDirection,
  type Autopilot,
} from '../src/game/autopilot';
import { dot, length, normalize, scale } from '../src/util/vec3';
import { predictTrajectory } from '../src/sim/orbit';
import { neutralInput } from '../src/sim/vessel';

/**
 * End-to-end milestone: the stock Selene lander flies Earth → parking orbit → trans-lunar injection → lunar
 * orbit → powered landing → lunar ascent → Earth reentry and parachute touchdown —
 * entirely through the World API and the src/game/autopilot building blocks.
 * Set MOON_DEBUG=1 for a per-0.5 s trace of the landing.
 */
describe('Moon missions (stock Selene scale variants)', () => {
  it.each(['real', 'challenging'] as const)('%s: lands on the Moon, ascends and returns safely to Earth', (preset) => {
    const world = new World(new Universe(preset), PART_CATALOG, DEFAULT_START_UT);
    world.launch(preset === 'real' ? buildRealMoonLander() : buildChallengingMoonLander());
    const wv = world.active!;
    const moonR = world.universe.body('moon').radius;
    const earthAtmo = world.universe.body('earth').atmosphere!.height;
    const log: string[] = [];
    const t0 = world.ut;
    world.onEvent = e => { if (e.type === 'partDestroyed') log.push(JSON.stringify(e)); };

    // Thrust delta-v meter (integrated thrust acceleration), reported per phase.
    let dvTotal = 0;
    let dvMark = 0;
    let lastUt = world.ut;
    const onTick = (w: World) => {
      const dt = w.ut - lastUt;
      lastUt = w.ut;
      const v = w.active!.state;
      if (dt > 0 && dt < 1 && v.telemetry.thrust > 0) dvTotal += (v.telemetry.thrust / v.mass) * dt;
    };
    const summary = (phase: string) => {
      const a = wv;
      const o = world.orbitSummary(a);
      const alt = length(world.relativeState(a).position) - world.universe.body(a.body).radius;
      log.push(
        `[${phase}] T+${(world.ut - t0).toFixed(0)}s body=${a.body} alt=${(alt / 1000).toFixed(2)}km ` +
          `ap=${isFinite(o.ap) ? (o.ap / 1000).toFixed(1) : 'inf'}km pe=${(o.pe / 1000).toFixed(1)}km ` +
          `dv=${(dvTotal - dvMark).toFixed(0)}m/s mass=${a.state.mass.toFixed(0)}kg stage=${a.state.nextStage} sit=${a.state.situation}`,
      );
      dvMark = dvTotal;
      process.stdout.write(log[log.length - 1] + '\n');
    };
    const run = (ap: Autopilot, maxTime: number, onTickExtra?: (w: World) => void) => {
      const ok = runAutopilot(world, ap, { maxTime, onTick: w => { onTick(w); onTickExtra?.(w); } });
      if (!ok) summary(`FAILED ${ap.name}: ${ap.error}`);
      return ok;
    };

    try {
      // 1. Ascent to a ~220 km parking orbit (booster + transfer stage; never drop the transfer stage here).
      expect(run(ascentGuidance(world, { targetApoapsis: preset === 'real' ? 220000 : 160000, minStage: 6 }), 900)).toBe(true);
      summary('ascent');
      expect(run(executeNode(world, planCircularization(world, 'apoapsis'), { minStage: 6 }), 1200)).toBe(true);
      summary('circularize');
      expect(world.orbitSummary(wv).pe).toBeGreaterThan(earthAtmo);

      // 2. Trans-lunar injection.
      const plan = planTransferToBody(world, 'moon', { periapsisAltitude: 30000 });
      expect(plan).not.toBeNull();
      log.push(`  TLI plan: node in ${(plan!.node.time - world.ut).toFixed(0)}s dv=${plan!.dv.toFixed(1)} encounter T+${(plan!.encounterTime - t0).toFixed(0)} pe=${(plan!.periapsisAltitude / 1000).toFixed(1)}km`);
      // The map-view prediction must show the encounter too.
      expect(world.trajectory().some((p) => p.nextBody === 'moon')).toBe(true);
      expect(run(executeNode(world, plan!.node, { minStage: 4 }), 2e6)).toBe(true);
      summary('TLI');

      // 3. Mid-course correction.
      const mcc = planCourseCorrection(world, 'moon', 30000, world.ut + 1800);
      expect(mcc).not.toBeNull();
      log.push(`  MCC plan: dv=${mcc!.dv.toFixed(2)} pe=${(mcc!.periapsisAltitude / 1000).toFixed(1)}km`);
      expect(run(executeNode(world, mcc!.node, { minStage: 4, matchEnergy: false }), 1e5)).toBe(true);
      summary('MCC');

      // A late trim resolves sub-m/s finite-burn errors over the multi-day real transfer.
      const trim = planCourseCorrection(world, 'moon', 30000, world.ut + (mcc!.encounterTime - world.ut) * 0.7);
      expect(trim).not.toBeNull();
      expect(run(executeNode(world, trim!.node, { minStage: 4, matchEnergy: false }), 1e6)).toBe(true);
      summary('late MCC');
      // Resolve finite-burn residuals near the SOI; a few cm/s still move real lunar periapsis by kilometres.
      const finalTrim = planCourseCorrection(world, 'moon', 30000, world.ut + (trim!.encounterTime - world.ut) * 0.8);
      expect(finalTrim).not.toBeNull();
      expect(run(executeNode(world, finalTrim!.node, { minStage: 4, matchEnergy: false }), 1e6)).toBe(true);
      summary('final MCC');
      // 4. Coast into the Moon's SOI.
      coastUntil(world, finalTrim!.encounterTime + 600, { stopOnSoi: true });
      summary('coast');
      expect(wv.body).toBe('moon');

      // 5. Capture into a low lunar orbit (transfer stage, lander as backup).
      const capture = planCircularization(world, 'periapsis');
      expect(run(executeNode(world, capture, { minStage: 4 }), capture.time - world.ut + 3000)).toBe(true);
      summary('capture');
      expect(world.orbitSummary(wv).ap).toBeLessThan(200000);
      expect(world.orbitSummary(wv).pe).toBeGreaterThan(5000);

      // 6. Powered landing. The transfer stage is jettisoned first: the lander descends on its own engine.
      while (wv.state.nextStage >= 4) world.stageActive(); // discard transfer hardware / ignite descent if needed
      expect(propulsion(wv.state).thrust).toBeGreaterThan(0);
      const parts = wv.state.parts.length;
      const land = landingController(world, { minStage: 4, maxSlope: 4 * Math.PI / 180 });
      let k = 0;
      const landed = run(land, 1e5, (w) => {
        if (!process.env.MOON_DEBUG || k++ % 25 !== 0 || land.status === 'coast') return;
        const a = w.active!;
        const f = localFrame(w, a);
        log.push(`    ${land.status} T+${(w.ut - t0).toFixed(1)} radar=${radarAltitude(w, a).toFixed(1)} vs=${length(f.surfVel).toFixed(1)} vz=${dot(f.surfVel, f.up).toFixed(1)} thr=${(a.state.telemetry.thrust / 1000).toFixed(1)}kN`);
      });
      summary('landing');
      const fr = localFrame(world, wv);
      const ground = world.universe.createEnvironment(() => 'moon').ground(wv.state.position, world.ut)!;
      const upright = dot(noseDirection(wv.state), fr.up);
      const site = world.universe.surfaceInfo('moon', wv.state.position, world.ut);
      log.push(`  touchdown speed=${land.touchdown?.speed.toFixed(2)} m/s, upright cos=${upright.toFixed(3)}, ground slope=${((Math.acos(dot(ground.normal, fr.up)) * 180) / Math.PI).toFixed(1)}°, site lat=${((site.lat * 180) / Math.PI).toFixed(2)}° lon=${((site.lon * 180) / Math.PI).toFixed(2)}°`);
      expect(landed).toBe(true);
      expect(wv.state.situation).toBe('landed');
      expect(world.vessels.has(wv.state.id)).toBe(true);
      expect(wv.state.parts.length).toBe(parts);
      expect(land.touchdown!.speed).toBeLessThan(5);
      expect(upright).toBeGreaterThan(0.9);

      // Time-warp on the surface (landed vessels go on rails in the body-fixed frame) and come back intact.
      coastUntil(world, world.ut + 3 * 3600);
      world.warp = { mode: 'rails', index: 0 };
      for (let i = 0; i < 100; i++) world.tick(0.02, neutralInput({ sas: 'stabilityAssist', gear: true }));
      const after = world.universe.surfaceInfo('moon', wv.state.position, world.ut);
      const moved = Math.hypot(after.lat - site.lat, after.lon - site.lon) * moonR;
      log.push(`  after 3 h of surface warp: moved ${moved.toFixed(2)} m, sit=${wv.state.situation}`);
      expect(wv.state.situation).toBe('landed');
      expect(wv.state.parts.length).toBe(parts);
      expect(moved).toBeLessThan(1);
      expect(length(localFrame(world, wv).surfVel)).toBeLessThan(0.5);

      world.stageActive(); // leave descent hardware on the Moon
      world.stageActive(); // ignite ascent / return engine
      // 7. Lunar ascent to a ~30 km orbit.
      expect(run(ascentGuidance(world, { targetApoapsis: 30000, minStage: 2 }), 1200)).toBe(true);
      summary('lunar ascent');
      expect(run(executeNode(world, planCircularization(world, 'apoapsis'), { minStage: 2 }), 1e5)).toBe(true);
      summary('lunar orbit');
      expect(world.orbitSummary(wv).pe).toBeGreaterThan(5000);

      // 8. Trans-Earth injection and coast back into Earth's SOI on a re-entry trajectory.
      const tei = planTransferToBody(world, 'earth', { periapsisAltitude: 35000 });
      expect(tei).not.toBeNull();
      log.push(`  TEI plan: node in ${(tei!.node.time - world.ut).toFixed(0)}s dv=${tei!.dv.toFixed(1)} SOI exit T+${(tei!.encounterTime - t0).toFixed(0)} Earth pe=${(tei!.periapsisAltitude / 1000).toFixed(1)}km`);
      expect(run(executeNode(world, tei!.node, { minStage: 2 }), 1e6)).toBe(true);
      summary('TEI');
      coastUntil(world, tei!.encounterTime + 600, { stopOnSoi: true });
      summary('Earth SOI');
      expect(wv.body).toBe('earth');
      expect(world.vessels.has(wv.state.id)).toBe(true);
      const pe = world.orbitSummary(wv).pe;
      expect(pe).toBeGreaterThan(0);
      expect(pe).toBeLessThan(earthAtmo);

      // 9. Return the crew capsule all the way to Earth under its own heat shield and chute.
      world.stageActive(); // jettison ascent/return stage
      const returnParts = wv.state.parts.filter(p => p.uid !== 4).map(p => p.uid); // spent separator can burn away
      const entry = predictTrajectory({ ephem: world.universe.ephem, bodies: world.universe.bodies,
        initialBody: 'earth', state: world.relativeState(wv), t0: world.ut, horizon: 2e6,
        stopAtAtmosphere: true }).find(p => p.endReason === 'atmosphere');
      expect(entry).toBeDefined();
      coastUntil(world, entry!.endTime - 30);
      for (let i = 0; i < 50 * 2400 && world.active && wv.state.situation === 'flying'; i++) {
        const f = localFrame(world, wv);
        world.warp = { mode: 'rails', index: 0 };
        world.tick(0.02, neutralInput({ sas: 'maneuver', maneuverDirection: scale(normalize(f.surfVel), -1), stage: i === 0 }));
      }
      summary('Earth touchdown');
      expect(world.active).toBe(wv);
      expect(wv.state.situation).not.toBe('flying');
      expect(wv.state.parts.map(p => p.uid)).toEqual(expect.arrayContaining(returnParts));
      expect(wv.state.parts.some(p => p.chute?.phase === 'full')).toBe(true);

    } finally {
      process.stdout.write(log.join('\n') + '\n');
    }
  // Allow CPU contention from concurrent worktree suites; idle mission phases still use rails warp.
  }, 600_000);
});
