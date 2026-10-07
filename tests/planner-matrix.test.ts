import { describe, expect, it } from 'vitest';
import { buildMoonLander } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { planTransferToBody, type TransferPlan } from '../src/game/autopilot';
import { periapsisRadius, propagate } from '../src/sim/orbit';
import { length } from '../src/util/vec3';
import type { ScalePresetId } from '../src/sim/bodies';
import { Universe } from '../src/game/universe';
import { worldInOrbit, type OrbitSpec } from './helpers/orbits';

interface Case { preset: ScalePresetId; from: string; target: string; spec: OrbitSpec; phase: number; label: string }
interface Row { c: Case; status: string; dv?: number; ref?: number; wait?: number; pe?: number; ms: number; why: string[] }

const PRESETS: ScalePresetId[] = ['standard', 'challenging', 'real'];

function cases(): Case[] {
  const out: Case[] = [];
  for (const preset of PRESETS) {
    const u = new Universe(preset), earth = u.body('earth'), moon = u.body('moon');
    const atmo = earth.atmosphere!.height;
    const low = atmo + Math.max(20000, earth.radius * 0.005);
    const leo: [string, OrbitSpec][] = [
      ['LEO 28.5°', { pe: low, inc: 28.5, lan: 0 }],
      ['LEO 28.5° lan90', { pe: low, inc: 28.5, lan: 90 }],
      ['LEO 0°', { pe: low, inc: 0 }],
      ['LEO 51.6°', { pe: low, inc: 51.6, lan: 200 }],
      ['LEO polar', { pe: low, inc: 90, lan: 45 }],
      ['LEO retro 140°', { pe: low, inc: 140, lan: 10 }],
      ['MEO 28.5°', { pe: earth.radius * 0.6, inc: 28.5, lan: 300 }],
      ['ellip 28.5° ap R', { pe: low, ap: earth.radius, inc: 28.5, lan: 30, argPe: 40, nu: 200 }],
      ['ellip post-burn ap 0.5 moon', { pe: low, ap: moon.orbit!.a * 0.5, inc: 28.5, lan: 120, argPe: 80, nu: 10 }],
      ['ellip post-burn ap 0.9 moon', { pe: low, ap: moon.orbit!.a * 0.9, inc: 28.5, lan: 200, argPe: 10, nu: 60 }],
      ['ellip overburn ap 1.6 moon', { pe: low, ap: moon.orbit!.a * 1.6, inc: 28.5, lan: 70, argPe: 300, nu: 30 }],
    ];
    for (const [label, spec] of leo) for (const phase of [0, 0.37, 0.71]) out.push({ preset, from: 'earth', target: 'moon', spec, phase, label });
    const llo = moon.radius * 0.02 + 10000;
    const lunar: [string, OrbitSpec][] = [
      ['LLO 0°', { pe: llo, inc: 0 }],
      ['LLO 30°', { pe: llo, inc: 30, lan: 60 }],
      ['LLO polar', { pe: llo, inc: 90, lan: 150 }],
      ['LLO ellip', { pe: llo, ap: moon.radius, inc: 10, argPe: 90, nu: 270 }],
    ];
    for (const [label, spec] of lunar) for (const phase of [0, 0.5]) out.push({ preset, from: 'moon', target: 'earth', spec, phase, label });
    for (const target of ['mars', 'venus']) for (const [label, spec] of [leo[0], leo[3]]) out.push({ preset, from: 'earth', target, spec, phase: 0, label });
  }
  return out;
}

function hohmannRef(plan: TransferPlan, world: ReturnType<typeof worldInOrbit>['world'], c: Case): number {
  const u = world.universe, o = world.orbitOf(world.active!);
  const s = propagate(o, plan.node.time), r = length(s.position), v = length(s.velocity);
  if (c.target === 'moon') {
    const a = u.body('moon').orbit!.a;
    return Math.sqrt(o.mu * (2 / r - 2 / (r + a))) - v;
  }
  // Escape to the parent: excess speed of a Hohmann-like return from the Moon's distance.
  const moon = u.body('moon'), earth = u.body('earth');
  const rc = moon.orbit!.a, vc = Math.sqrt(earth.gm / rc);
  const goal = earth.radius + 35000;
  const vInf = vc - Math.sqrt(earth.gm * (2 / rc - 2 / (rc + goal)));
  return Math.sqrt(vInf * vInf + 2 * o.mu / r) - v;
}

/** Earth-departure Δv of a Hohmann transfer to `c.target` from the vessel's current radius. */
function interRef(world: ReturnType<typeof worldInOrbit>['world'], c: Case): number {
  const u = world.universe, sun = u.body(u.sunId), a = u.body('earth').orbit!.a, b = u.body(c.target).orbit!.a;
  const vInf = Math.abs(Math.sqrt(sun.gm * (2 / a - 2 / (a + b))) - Math.sqrt(sun.gm / a));
  const r = length(world.relativeState(world.active!).position), mu = u.body('earth').gm;
  return Math.sqrt(vInf * vInf + 2 * mu / r) - Math.sqrt(mu / r);
}

function run(c: Case): Row {
  const u = new Universe(c.preset);
  const ut = DEFAULT_START_UT + c.phase * u.body('moon').orbitalPeriod!;
  const { world } = worldInOrbit(c.preset, ut, buildMoonLander(), c.from, c.spec);
  const t0 = performance.now();
  const why: string[] = [];
  let plan: TransferPlan | null;
  try {
    plan = planTransferToBody(world, c.target);
  } catch (e) {
    return { c, status: 'THROW', ms: performance.now() - t0, why: [(e as Error).message] };
  }
  const ms = performance.now() - t0;
  if (!plan) return { c, status: 'NULL', ms, why: ['no solution'] };
  const target = u.body(c.target);
  const goal = c.target === 'moon' || c.target === 'earth' ? (target.atmosphere ? target.atmosphere.height * 0.5 : 30000)
    : Math.max(target.radius * 0.1, (target.atmosphere?.height ?? 0) * 2, 30000);
  const ref = c.target === 'moon' || c.target === 'earth' ? hohmannRef(plan, world, c) : interRef(world, c);
  const wait = plan.node.time - world.ut;
  if (plan.node.time <= world.ut) why.push('node in past');
  if (Math.abs(plan.periapsisAltitude - goal) > Math.max(5000, target.radius * 0.05, goal * 0.02)) why.push(`pe off ${(plan.periapsisAltitude / 1000).toFixed(0)}km`);
  if (plan.dv > ref * 1.25 + 50) why.push(`dv ${plan.dv.toFixed(0)} vs ref ${ref.toFixed(0)}`);
  if (c.target === 'moon' && wait > 0.55 * u.body('moon').orbitalPeriod!) why.push(`wait ${(wait / 86400).toFixed(1)}d`);
  // The map must show the same encounter.
  const patches = world.trajectory();
  const i = patches.findIndex(p => p.nextBody === c.target);
  const mapPe = i >= 0 && patches[i + 1] ? periapsisRadius(patches[i + 1].orbit) - target.radius : undefined;
  if (mapPe === undefined) why.push('map shows no encounter');
  else if (Math.abs(mapPe - plan.periapsisAltitude) > 2000) why.push(`map pe ${(mapPe / 1000).toFixed(0)}km`);
  if (ms > 20000) why.push(`slow ${(ms / 1000).toFixed(1)}s`);
  return { c, status: why.length ? 'BAD' : 'ok', dv: plan.dv, ref, wait, pe: plan.periapsisAltitude, ms, why };
}

const enabled = !!process.env.PLANNER_MATRIX;
describe.skipIf(!enabled)('planner matrix (PLANNER_MATRIX=1)', () => {
  it('runs every case', () => {
    const filter = process.env.PLANNER_MATRIX!;
    const rows: Row[] = [];
    for (const c of cases()) {
      if (filter !== '1' && !filter.split('|').some(f => `${c.preset} ${c.from}->${c.target} ${c.label}`.includes(f))) continue;
      const r = run(c);
      rows.push(r);
      console.log(`${r.status.padEnd(5)} ${c.preset.padEnd(11)} ${c.from}->${c.target} ${c.label.padEnd(28)} ph=${c.phase} `
        + `dv=${r.dv?.toFixed(0) ?? '-'} ref=${r.ref?.toFixed(0) ?? '-'} wait=${r.wait !== undefined ? (r.wait / 3600).toFixed(1) + 'h' : '-'} `
        + `pe=${r.pe !== undefined ? (r.pe / 1000).toFixed(1) + 'km' : '-'} ${(r.ms / 1000).toFixed(1)}s ${r.why.join('; ')}`);
    }
    const bad = rows.filter(r => r.status !== 'ok');
    console.log(`${rows.length - bad.length}/${rows.length} ok`);
    expect(rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});
