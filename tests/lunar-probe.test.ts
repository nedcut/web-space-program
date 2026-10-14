import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { DEFAULT_START_UT } from '../src/game/store';
import { STOCK_CRAFTS, buildRealLunarProbe } from '../src/editor/stockCrafts';
import { TECH_NODES } from '../src/data/technology';
import { computeStageStats } from '../src/editor/ui/dv';
import { newProgression } from '../src/sim/science/progression';
import { nextGoal, researchFor } from '../src/ui/hub/nextGoal';
import { spawnRelative } from '../src/scenarios/catalog';
import { neutralInput } from '../src/sim/vessel';
import { stackCraft } from '../src/sim/vessel/testing';
import { v3 } from '../src/util/vec3';
import { buy, probeLunarOrbit, sensor } from '../scripts/career/flights';

describe('Tern lunar probe (Real)', () => {
  it('is a Real stock craft one research step past the Real orbiter, with the Δv for a lunar orbit', () => {
    const stock = STOCK_CRAFTS.find(s => s.id === 'stock-tern-real')!;
    expect(stock.scale).toBe('real');
    const p = newProgression();
    expect(researchFor('stock-meridian-real', p, 'career').cost).toBe(280);
    const tern = researchFor('stock-tern-real', p, 'career');
    expect(tern.cost).toBe(325);
    expect(tern.nodes).toEqual(expect.arrayContaining(['guidance-0', 'guidance-1']));
    // Re-tiering the probe core leaves the Standard path untouched: Selene still needs 110 science.
    expect(researchFor('stock-selene', p, 'career').cost).toBe(110);
    expect(TECH_NODES.find(n => n.id === 'guidance-1')!.parts).toContain('probe-pebble');
    const stats = computeStageStats(stock.build(), PART_CATALOG, new Universe('real').body('earth'));
    expect([...stats.values()].reduce((s, x) => s + x.dvVac, 0)).toBeGreaterThan(14000);
    // After the Real orbit, the hub points at the probe rather than the 775-science expedition.
    p.milestones.push('first-orbit');
    p.archive['temperature/earth/landed/Launch Complex'] = { body: 'earth', biome: 'Launch Complex', situation: 'landed', experiment: 'temperature', runs: 1, science: 8 };
    expect(nextGoal(p, 'career', 'real')!.detail).toMatch(/Tern Lunar Probe/);
  });

  it('reaches a low lunar orbit and transmits Moon science', () => {
    const w = new World(new Universe('real'), PART_CATALOG, DEFAULT_START_UT, 'career');
    w.progression.unlocked = TECH_NODES.map(n => n.id);
    w.progression.funds = 1e7;
    expect(buy(w, sensor(buildRealLunarProbe())).problem).toBeNull();
    const biomes = new Set<string>();
    expect(probeLunarOrbit(w, biomes, 220000, 100000, 1)).toBeNull();
    expect(w.active!.body).toBe('moon');
    expect(w.orbitSummary(w.active!).pe).toBeGreaterThan(20000);
    expect([...biomes].some(b => b.startsWith('moon/spaceLow/'))).toBe(true);
    expect(w.progression.milestones).toContain('first-moon-flyby');
    expect(w.progression.science).toBeGreaterThan(60);
  }, 900_000);
});

describe('probe flight computer', () => {
  it('flies an uploaded node without signal; nothing else', () => {
    // A low orbit position no ground station can see (Earth in the way).
    const spawn = (dir: ReturnType<typeof v3>) => {
      const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT, 'science');
      const earth = w.universe.body('earth'), r = earth.radius + 200000, v = Math.sqrt(earth.gm / r);
      const tangent = Math.abs(dir.z) > 0.5 ? v3(1, 0, 0) : v3(-dir.y, dir.x, 0);
      const wv = spawnRelative(w, stackCraft(['probe-pebble', 'tank-1-short', { partId: 'eng-zephyr', stage: 0 }], PART_CATALOG), 'earth', v3(dir.x * r, dir.y * r, dir.z * r), v3(tangent.x * v, tangent.y * v, tangent.z * v));
      w.commsSettings = { enabled: true, restrictControl: true };
      return { w, wv };
    };
    const { w, wv } = [v3(1, 0, 0), v3(-1, 0, 0), v3(0, 1, 0), v3(0, -1, 0), v3(0, 0, 1), v3(0, 0, -1)].map(spawn).find(({ w }) => !w.canControl())!;
    const thrustWith = (input: ReturnType<typeof neutralInput>) => { for (let i = 0; i < 50; i++) w.tick(0.02, input); return wv.state.telemetry.thrust; };
    // With signal (restriction off): the engine is staged and the node is uploaded.
    w.commsSettings = { enabled: true, restrictControl: false };
    for (let i = 0; i < 4 && wv.state.nextStage >= 0; i++) w.stageActive();
    const node = w.addNode(w.ut + 3600);
    expect(thrustWith(neutralInput({ throttle: 1 }))).toBeGreaterThan(0);
    thrustWith(neutralInput({ throttle: 0 }));
    expect(w.uploadedNode(node.id)).toBe(true);
    // Out of contact: manual throttle is refused, the program flying the uploaded node is obeyed.
    w.commsSettings = { enabled: true, restrictControl: true };
    expect(w.canControl()).toBe(false);
    expect(thrustWith(neutralInput({ throttle: 1 }))).toBe(0);
    expect(thrustWith({ ...neutralInput({ throttle: 1 }), program: node.id })).toBeGreaterThan(0);
    // A node added while out of contact never reached the probe.
    const late = w.addNode(w.ut + 7200);
    expect(w.uploadedNode(late.id)).toBe(false);
    expect(thrustWith({ ...neutralInput({ throttle: 1 }), program: late.id })).toBe(0);
    w.removeNode(node.id);
    expect(w.uploadedNode(node.id)).toBe(false);
  });
});
