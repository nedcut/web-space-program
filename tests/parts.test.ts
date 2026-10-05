import { describe, expect, it } from 'vitest';
import { PART_CATALOG, PART_DEFS, SIZE_RADIUS, findModule, getPart, partWetMass } from '../src/data/parts';
import { RESOURCES, resourceMass } from '../src/data/resources';
import type { EngineModule, PartDef, ResourceId } from '../src/sim/vessel/types';

const G0 = 9.80665;
const BANNED = /kerbal|kerbin|jebediah|rockomax|kerbodyne|probodobodyne|mainsail|poodle|terrier|reliant|swivel|stayputnik|okto|mun\b/i;

describe('resources', () => {
  it('has sane densities', () => {
    expect(RESOURCES.liquidFuel.density).toBeCloseTo(0.81, 2);
    expect(RESOURCES.oxidizer.density).toBeCloseTo(1.14, 2);
    expect(RESOURCES.electricCharge.density).toBe(0);
    for (const r of Object.values(RESOURCES)) expect(r.density).toBeGreaterThanOrEqual(0);
  });
});

describe('part catalogue', () => {
  it('has unique ids and a populated catalog map', () => {
    const ids = PART_DEFS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PART_CATALOG.size).toBe(ids.length);
    expect(PART_DEFS.length).toBeGreaterThanOrEqual(150);
  });

  it('has unique names and original text', () => {
    const names = PART_DEFS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of PART_DEFS) {
      expect(BANNED.test(p.name + ' ' + p.description + ' ' + p.manufacturer), p.id).toBe(false);
      expect(p.description.length).toBeGreaterThan(20);
    }
  });

  it.each(PART_DEFS.map((p) => [p.id, p] as const))('%s is physically valid', (_id, p: PartDef) => {
    expect(p.dryMass).toBeGreaterThan(0);
    expect(p.cost).toBeGreaterThan(0);
    expect(p.maxTemp).toBeGreaterThanOrEqual(1200);
    expect(p.crashTolerance).toBeGreaterThan(0);
    expect(p.mesh.length).toBeGreaterThan(0);
    const nodeIds = new Set<string>();
    for (const n of p.attachNodes) {
      expect(Number.isInteger(n.size)).toBe(true);
      expect(n.size).toBeGreaterThanOrEqual(0);
      expect(n.size).toBeLessThanOrEqual(4);
      expect(nodeIds.has(n.id)).toBe(false);
      nodeIds.add(n.id);
      const len = Math.hypot(n.direction.x, n.direction.y, n.direction.z);
      expect(len).toBeCloseTo(1, 6);
    }
    for (const k in p.resources) {
      expect(RESOURCES[k as ResourceId], `${p.id} resource ${k}`).toBeDefined();
      expect(p.resources[k as ResourceId]!).toBeGreaterThan(0);
    }
    // Stack nodes sit on the bounding shape's top/bottom faces.
    if (p.shape.kind === 'cylinder' && p.mesh !== 'fairing') {
      const top = p.attachNodes.find((n) => n.id === 'top');
      const bottom = p.attachNodes.find((n) => n.id === 'bottom');
      if (top) expect(top.position.y).toBeCloseTo(p.shape.height / 2, 6);
      if (bottom) expect(bottom.position.y).toBeCloseTo(-p.shape.height / 2, 6);
    }
    if (p.surfaceAttachable && p.category !== 'engine' && p.category !== 'fuelTank' && p.category !== 'structural') {
      // Radial parts expose their mount point.
      if (!p.attachNodes.some((n) => n.id === 'top' || n.id === 'bottom')) {
        expect(p.attachNodes.some((n) => n.id === 'srf')).toBe(true);
      }
    }
  });

  it('stack node sizes match the part radius for tanks', () => {
    for (const p of PART_DEFS.filter((d) => d.category === 'fuelTank' && d.shape.kind === 'cylinder')) {
      const top = p.attachNodes.find((n) => n.id === 'top')!;
      if (p.shape.kind === 'cylinder') expect(SIZE_RADIUS[top.size]).toBeCloseTo(p.shape.radiusTop, 6);
    }
  });

  it('engines burn propellants that exist and have realistic Isp', () => {
    const engines = PART_DEFS.filter((p) => findModule(p, 'engine'));
    expect(engines.length).toBeGreaterThanOrEqual(10);
    for (const p of engines) {
      const e = findModule(p, 'engine')!;
      expect(Object.keys(e.propellants).length).toBeGreaterThan(0);
      for (const k in e.propellants) expect(RESOURCES[k as ResourceId], `${p.id} burns ${k}`).toBeDefined();
      expect(e.maxThrustVac).toBeGreaterThan(0);
      if (e.airBreathing) {
        // Jets: fuel-only Isp in the thousands of seconds, independent of pressure (thrust follows the Mach/density curve).
        expect(e.ispVac).toBe(e.ispAsl);
        expect(e.ispVac).toBeGreaterThan(1500);
        expect(e.propellants).toEqual({ liquidFuel: 1 });
        continue;
      }
      expect(e.ispVac).toBeGreaterThan(e.ispAsl);
      if (p.id === 'eng-hearth') {
        expect(e.ispVac).toBe(850);
        expect(e.propellants).toEqual({ liquidFuel: 1 });
      } else if (e.plume !== 'ion') {
        expect(e.ispVac).toBeGreaterThan(200);
        expect(e.ispVac).toBeLessThan(470);
      }
      if (e.plume === 'solid') expect(e.throttleable).toBe(false);
      expect(Math.hypot(e.thrustDirection.x, e.thrustDirection.y, e.thrustDirection.z)).toBeCloseTo(1, 6);
    }
    // Some liquid engines should be able to lift themselves plus a stack.
    const sirocco = findModule(getPart('eng-sirocco'), 'engine')!;
    const twr = (sirocco.maxThrustVac * (sirocco.ispAsl / sirocco.ispVac)) / (getPart('eng-sirocco').dryMass * G0);
    expect(twr).toBeGreaterThan(20);
  });

  it('size classes 0..4 are all covered by tanks, decouplers and engines', () => {
    for (const size of [0, 1, 2, 3, 4]) {
      for (const cat of ['fuelTank', 'coupling', 'engine'] as const) {
        const ok = PART_DEFS.some((p) => p.category === cat && p.attachNodes.some((n) => n.size === size && n.id !== 'srf'));
        expect(ok, `${cat} size ${size}`).toBe(true);
      }
    }
  });

  it('parachutes can land a capsule gently', () => {
    const chute = findModule(getPart('chute-main'), 'parachute')!;
    const capsule = partWetMass(getPart('pod-lantern-1')) + partWetMass(getPart('shield-1')) + partWetMass(getPart('chute-main'));
    const vTerminal = Math.sqrt((2 * capsule * G0) / (1.225 * chute.deployedCdA));
    expect(vTerminal).toBeLessThan(9);
  });
});

/** Reference 3-stage Moon rocket. Each stage lists the parts it carries (dropped at separation). */
interface Stage {
  parts: [string, number][];
  engine: string;
  engines?: number;
  /** Additional strap-on boosters firing with this stage (ignored for dv, counted for thrust). */
}

function stageMass(parts: [string, number][]): { wet: number; dry: number } {
  let wet = 0;
  let dry = 0;
  for (const [id, n] of parts) {
    const p = getPart(id);
    wet += partWetMass(p) * n;
    // Only liquid propellant burns in the stage; ablator, monoprop, EC stay on board.
    const burnable: Partial<Record<ResourceId, number>> = { liquidFuel: p.resources.liquidFuel ?? 0, oxidizer: p.resources.oxidizer ?? 0 };
    dry += (partWetMass(p) - resourceMass(burnable)) * n;
  }
  return { wet, dry };
}

describe('reference Moon rocket (standard scale)', () => {
  // Top to bottom. Stage 3 = lander/return, stage 2 = orbit + TLI, stage 1 = lifter.
  const stages: Stage[] = [
    {
      engine: 'eng-doldrum',
      parts: [
        ['chute-main', 1],
        ['pod-lantern-1', 1],
        ['shield-1', 1],
        ['tank-1-mid', 1],
        ['eng-doldrum', 1],
        ['leg-stilt', 3],
        ['rcs-nudge', 4],
        ['battery-brick', 1],
      ],
    },
    {
      engine: 'eng-zephyr',
      parts: [
        ['dec-1', 1],
        ['tank-1-long', 2],
        ['eng-zephyr', 1],
      ],
    },
    {
      engine: 'eng-chinook',
      parts: [
        ['dec-1', 1],
        ['adapt-1-2', 1],
        ['tank-2-long', 1],
        ['tank-2-mid', 1],
        ['eng-chinook', 1],
        ['fin-keel', 4],
      ],
    },
  ];

  it('has >= 5.5 km/s vacuum dv and a 1.3-1.8 liftoff TWR', () => {
    let above = 0;
    let total = 0;
    const report: string[] = [];
    let liftoffMass = 0;
    for (const st of stages) {
      const m = stageMass(st.parts);
      const e = findModule(getPart(st.engine), 'engine') as EngineModule;
      const m0 = above + m.wet;
      const m1 = above + m.dry;
      const dv = e.ispVac * G0 * Math.log(m0 / m1);
      total += dv;
      report.push(`${st.engine}: m0=${(m0 / 1000).toFixed(1)}t dv=${dv.toFixed(0)} m/s`);
      above = m0;
      liftoffMass = m0;
    }
    const first = findModule(getPart(stages[stages.length - 1].engine), 'engine')!;
    const thrustAsl = first.maxThrustVac * (first.ispAsl / first.ispVac);
    const twr = thrustAsl / (liftoffMass * G0);
    report.push(`total dv=${total.toFixed(0)} m/s, liftoff TWR=${twr.toFixed(2)}`);
    console.log(report.join('\n'));
    expect(total).toBeGreaterThanOrEqual(5500);
    expect(twr).toBeGreaterThanOrEqual(1.3);
    expect(twr).toBeLessThanOrEqual(1.8);
    // Lander stage alone must cover capture + descent + ascent + trans-Earth (~1.6 km/s at s=0.1).
    const landerDv = (() => {
      const m = stageMass(stages[0].parts);
      return findModule(getPart('eng-doldrum'), 'engine')!.ispVac * G0 * Math.log(m.wet / m.dry);
    })();
    expect(landerDv).toBeGreaterThan(1600);
  });
});
