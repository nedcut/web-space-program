import { createHash } from 'node:crypto';
import { World } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { DEFAULT_START_UT } from '../../src/game/store';
import { PART_CATALOG } from '../../src/data/parts';
import { STOCK_CRAFTS, buildTender } from '../../src/editor/stockCrafts';
import { CraftEditor } from '../../src/editor/core/editor';
import { placeInCircularOrbit, spawnRendezvousTarget } from '../../src/game/scenarios';
import { neutralInput, freePorts } from '../../src/sim/vessel';
import type { ControlInput, SasMode } from '../../src/sim/vessel/runtime';
import { serializeWorld, deserializeWorld } from '../../src/game/persistence';
import { executeNode } from '../../src/game/autopilot';
import { length, sub, dot, add, v3 } from '../../src/util/vec3';

import { qFromAxisAngle, qMul, qRotate } from '../../src/util/quat';

export type Action = { kind: 'fly'; input: ControlInput; frames: number } | { kind: 'warp'; mode: 'physics' | 'rails'; index: number } | { kind: 'save' | 'eva' | 'target' | 'switch' | 'node' | 'dock'; value: number };
export function random(seed: number) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const modes: SasMode[] = ['off', 'stabilityAssist', 'prograde', 'retrograde', 'normal', 'antinormal', 'radialIn', 'radialOut', 'target', 'antiTarget', 'portAlign', 'maneuver'];
export function generate(seed: number, steps = 100): Action[] {
  const r = random(seed ^ 0x12345678), pick = (n: number) => Math.floor(r() * n);
  return Array.from({ length: steps }, (_, i): Action => {
    const k = pick(13);
    if (k === 0) { const mode = r() < .5 ? 'physics' : 'rails'; return { kind: 'warp', mode, index: pick(mode === 'physics' ? 4 : 9) }; }
    if (k < 7) return { kind: (['save', 'eva', 'target', 'switch', 'node', 'dock'] as const)[k - 1], value: r() };
    return { kind: 'fly', frames: 5 + pick(46), input: r() < .35 ? neutralInput() : neutralInput({ throttle: r() < .5 ? 0 : r(), stage: i === 0 || r() < .12, pitch: (r() - .5) * .4, yaw: (r() - .5) * .4, roll: (r() - .5) * .4, sas: modes[pick(modes.length)], rcs: r() < .5, translateX: r() - .5, translateY: r() - .5, translateZ: r() - .5 }) };
  });
}
function check(ok: boolean, code: string, detail: unknown) { if (!ok) throw new Error(`${code}: ${JSON.stringify(detail)}`); }
function finite(value: unknown, path: string) {
  if (typeof value === 'number') check(Number.isFinite(value), 'finite', path);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) finite(v, `${path}.${k}`);
}
export function invariant(w: World) {
  finite(w.ut, 'ut');
  finite(w.nodes, 'nodes');
  for (const id of w.universe.bodies.keys()) finite(w.universe.ephem.getBodyState(id, w.ut), `body.${id}`);
  for (const v of w.vessels.values()) {
    const s = v.state;
    for (const [key, value] of Object.entries(s)) {
      if (['parts', 'cache', 'resourceDefs', 'telemetry'].includes(key)) continue;
      finite(value, `${s.id}.${key}`);
    }
    for (const [key, value] of Object.entries(s.telemetry)) {
      // Explicit unavailable-value sentinels in VesselTelemetry, not physical state.
      if ((key === 'altitudeAGL' || key === 'intakeAirRatio') && Number.isNaN(value)) continue;
      finite(value, `${s.id}.telemetry.${key}`);
    }
    check(s.mass >= 0, 'mass', s.mass);
    const ids = new Set(s.parts.map(p => p.uid));
    check(ids.size === s.parts.length, 'duplicate-part', s.id);
    if (!s.destroyed) {
      const roots = s.parts.filter(p => p.parent === null);
      check(roots.length === 1 && roots[0].uid === s.rootUid, 'part-root', s.id);
    }
    for (const p of s.parts) {
      for (const [key, value] of Object.entries(p)) if (key !== 'def') finite(value, `${s.id}.${p.uid}.${key}`);
      check(p.mass >= 0, 'part-mass', { uid: p.uid, mass: p.mass });
      const seen = new Set<number>([p.uid]); let parent = p.parent;
      while (parent !== null) { check(ids.has(parent) && !seen.has(parent), 'part-tree', { vessel: s.id, part: p.uid, parent }); seen.add(parent); parent = s.parts.find(q => q.uid === parent)!.parent; }
      for (const [key, amount] of Object.entries(p.resources)) {
        const cap = p.maxResources[key as keyof typeof p.maxResources] ?? 0;
        // Intake air is per-step flow, explicitly not a stored resource (engines.ts).
        check(amount >= -1e-8 && (key === 'intakeAir' || amount <= cap + 1e-8), 'resource', { part: p.uid, key, amount, cap });
      }
    }
  }
}
function snapshot(w: World) {
  return { ut: w.ut, activeId: w.activeId, nodes: w.nodes, vessels: [...w.vessels.values()].map(v => ({ body: v.body, mode: v.mode, fixed: v.fixed, position: v.state.position, velocity: v.state.velocity, orientation: v.state.orientation, angularVelocity: v.state.angularVelocity, parts: v.state.parts.map(p => ({ uid: p.uid, parent: p.parent, partId: p.partId, position: p.position, rotation: p.rotation, resources: p.resources })) })) };
}
/** Body-fixed vessels rebuild their pose after load; permit only float64 reconstruction noise. */
function roundTrip(before: ReturnType<typeof snapshot>, after: ReturnType<typeof snapshot>, world: World) {
  const structural = (s: ReturnType<typeof snapshot>) => ({ ...s, vessels: s.vessels.map(v => ({ ...v, position: undefined, velocity: undefined, orientation: undefined, angularVelocity: undefined })) });
  check(JSON.stringify(structural(before)) === JSON.stringify(structural(after)), 'save-roundtrip-structure', {});
  before.vessels.forEach((a, i) => {
    const b = after.vessels[i];
    for (const [field, tolerance] of [['position', 1e-4], ['velocity', 1e-5], ['angularVelocity', 1e-12]] as const) {
      // On the pad, EVA shifts COM then captures fixed coordinates. The stored
      // instantaneous velocity is not authoritative: load derives co-rotation.
      let expected = a[field];
      if (field === 'velocity' && a.fixed && (a.mode === 'prelaunch' || a.mode === 'landedRails')) {
        const rel = qRotate(world.universe.ephem.bodyRotation(a.body, before.ut), a.fixed.pos);
        expected = add(world.universe.ephem.getBodyState(a.body, before.ut).velocity, world.universe.ephem.surfaceVelocity(a.body, rel, before.ut));
      }
      const error = length(sub(expected, b[field]));
      check(error <= tolerance, 'save-roundtrip-pose', { vessel: i, field, error, tolerance });
    }
    for (const key of ['x', 'y', 'z', 'w'] as const) check(Math.abs(a.orientation[key] - b.orientation[key]) <= 1e-12, 'save-roundtrip-attitude', { vessel: i, key, before: a.orientation[key], after: b.orientation[key] });
  });
}
export class Failure extends Error {
  constructor(readonly seed: number, readonly step: number, readonly actions: Action[], readonly reason: string) { super(`seed=${seed} step=${step} ${reason}\nReplay: npx tsx scripts/fuzz/run.ts --seed ${seed}\n${JSON.stringify(actions)}`); }
}
export interface RunStats { fixture?: string; frames: number; railsChecks: number; saves: number; evas: number; docks: number; nodes: number; targets: number; maxRelativeEnergyError: number; maxWarpJump: number }
export function replay(seed: number, actions = generate(seed), stats?: RunStats): string {
  const now = Date.now; Date.now = () => 1700000000000;
  let step = -1;
  try {
    const r = random(seed), presets = ['standard', 'challenging', 'real'] as const;
    let w = new World(new Universe(presets[seed % 3]), PART_CATALOG, DEFAULT_START_UT);
    let craft = STOCK_CRAFTS[Math.floor(r() * STOCK_CRAFTS.length)].build();
    if (seed % 4 === 0) {
      const e = new CraftEditor(PART_CATALOG); let p = e.addRoot('pod-lantern-1');
      for (let i = 0, n = 1 + Math.floor(r() * 5); i < n; i++) p = e.attachPart(r() < .5 ? 'tank-1-short' : 'tank-1-long', p.uid, 'bottom', 'top');
      e.attachPart('eng-sirocco', p.uid, 'bottom', 'top');
      craft = e.craft;
    }
    if (stats) stats.fixture = `${w.universe.preset}/${craft.name}/${craft.parts.length} parts/${seed % 2 ? 'orbit' : 'pad'}`;
    w.launch(craft);
    if (seed % 2) placeInCircularOrbit(w, w.active!, 'earth', 2e6);
    invariant(w);
    for (step = 0; step < actions.length; step++) {
      const a = actions[step];
      if (a.kind === 'dock') { dockingProperty(seed, a.value); if (stats) stats.docks++; }
      else if (a.kind === 'save') { const before = snapshot(w); w = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), PART_CATALOG, w.universe); roundTrip(before, snapshot(w), w); if (stats) stats.saves++; }
      else if (a.kind === 'warp') { const before = w.active ? { ...w.active.state.position } : undefined; w.warp = { mode: a.mode, index: a.index }; w.tick(0, neutralInput()); if (before && w.active) { const jump = length(sub(before, w.active.state.position)); if (stats) stats.maxWarpJump = Math.max(stats.maxWarpJump, jump); check(jump < .01, 'warp-teleport', { step, jump }); } }
      else if (a.kind === 'eva') { const eva = w.goEva(); if (eva && stats) stats.evas++; }
      else if (a.kind === 'switch') { const ids = [...w.vessels.keys()]; if (ids.length) w.switchTo(ids[Math.floor(a.value * ids.length)]); }
      else if (a.kind === 'target') { if (w.active && (length(w.relativeState(w.active).position) - w.universe.body(w.active.body).radius) > 100000 && w.vessels.size < 5) { spawnRendezvousTarget(w, craft, 50 + a.value * 450); if (stats) stats.targets++; } }
      else if (a.kind === 'node') { if (w.active && (length(w.relativeState(w.active).position) - w.universe.body(w.active.body).radius) > 100000) { if (stats) stats.nodes++; const n = w.addNode(w.ut + 2); n.prograde = a.value * 20; const ap = executeNode(w, n); for (let i = 0; i < 20 && !ap.done && !ap.error; i++) { w.tick(.02, ap.update(w).input); invariant(w); } } }
      else if (a.kind === 'fly') for (let i = 0; i < a.frames; i++) {
        const v = w.active, body = v?.body, wasRails = v?.mode === 'rails';
        const energy = () => { const s = w.relativeState(v!); return dot(s.velocity, s.velocity) / 2 - w.universe.body(v!.body).gm / length(s.position); };
        const before = wasRails ? energy() : 0;
        w.tick(.02, { ...a.input, stage: a.input.stage && i === 0 });
        if (stats) { stats.frames++; if (wasRails && v?.mode === 'rails' && v.body === body) stats.railsChecks++; }
        if (wasRails && v?.mode === 'rails' && v.body === body) { const after = energy(), error = Math.abs(after - before); if (stats) stats.maxRelativeEnergyError = Math.max(stats.maxRelativeEnergyError, error / Math.max(1, Math.abs(before))); check(error <= Math.max(1e-3, Math.abs(before) * 1e-8), 'rails-energy', { before, after }); }
        invariant(w);
      }
      invariant(w);
    }
    return createHash('sha256').update(JSON.stringify({ ...snapshot(w), vessels: serializeWorld(w).vessels, crew: w.crew, flags: w.flags })).digest('hex');
  } catch (e) { throw new Failure(seed, step, actions.slice(0, step + 1), String(e)); }
  finally { Date.now = now; }
}
/** Bounded deletion shrinking, preserving the same invariant/error signature. */
export function shrink(f: Failure, limit = 100): Action[] {
  let actions = f.actions, budget = limit;
  const signature = (reason: string) => reason.replace(/^Error: /, '').split(':')[0];
  const deadline = Date.now() + 10000;
  for (let size = Math.ceil(actions.length / 2); size >= 1; size = Math.floor(size / 2)) {
    for (let i = 0; i < actions.length && budget-- > 0 && Date.now() < deadline;) {
      const candidate = [...actions.slice(0, i), ...actions.slice(i + size)];
      try { replay(f.seed, candidate); } catch (e) { if (e instanceof Failure && signature(e.reason) === signature(f.reason)) { actions = candidate; continue; } }
      i += size;
    }
  }
  return actions;
}

/** Controlled capture fixture uses the World merge/split path, then checks the whole forest. */
function dockingProperty(seed: number, offset: number) {
  const presets = ['standard', 'challenging', 'real'] as const;
  const w = new World(new Universe(presets[seed % 3]), PART_CATALOG, DEFAULT_START_UT);
  const craft = buildTender(); w.launch(craft);
  const a = w.active!; placeInCircularOrbit(w, a, 'earth', 2e6);
  const b = w.spawnVessel(craft, { position: a.state.position, velocity: a.state.velocity, orientation: qMul(a.state.orientation, qFromAxisAngle(v3(1, 0, 0), Math.PI)) }, 'Capture target');
  const pa = freePorts(a.state)[0], pb = freePorts(b.state)[0];
  b.state.position = add(b.state.position, sub(add(pa.pos, qRotate(a.state.orientation, v3(0, .02 + offset * .04, 0))), pb.pos));
  const count = a.state.parts.length + b.state.parts.length;
  for (let i = 0; i < 100 && w.vessels.size > 1; i++) w.tick(.02, neutralInput());
  check(w.vessels.size === 1, 'dock-capture', { seed, offset });
  check(w.active!.state.parts.length === count, 'dock-count', count); invariant(w);
  check(w.undockActive() !== null, 'undock', seed); invariant(w);
  check([...w.vessels.values()].reduce((n, v) => n + v.state.parts.length, 0) === count, 'undock-count', count);
}
