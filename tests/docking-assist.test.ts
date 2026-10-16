import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { buildTender } from '../src/editor/stockCrafts';
import { autoDock, targetPortOrientation, targetedPort } from '../src/game/dockingAssist';
import { runAutopilot } from '../src/game/autopilot';
import { placeInCircularOrbit, spawnRendezvousTarget } from '../src/game/scenarios';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { controlFrom, controlRotation, dockedPorts, freePorts, neutralInput, portAlignment, totalResource } from '../src/sim/vessel';
import { sasTargetDirection } from '../src/sim/vessel/sas';
import { assistFrame } from '../src/flight/assist';
import { qConj, qFromAxisAngle, qMul, qRotate } from '../src/util/quat';
import { add, dot, length, scale, sub, v3 } from '../src/util/vec3';
import { requireIntactFlight } from './helpers/structural';

function setup(distance = 65, side = true) {
  const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(w);
  const craft = buildTender();
  if (side) {
    const port = craft.parts.find(p => p.partId === 'dock-1')!;
    port.rotation = qFromAxisAngle(v3(0, 0, 1), -Math.PI / 2);
    port.position = v3(0.9, 0, 0);
  }
  const active = w.launch(craft);
  placeInCircularOrbit(w, active, 'earth', 90_000);
  const target = spawnRendezvousTarget(w, buildTender(), distance)!;
  const a = freePorts(active.state)[0], b = targetedPort(w)!;
  const frame = targetPortOrientation(w)!;
  const aligned = qMul(frame, { x: 0, y: 0, z: 1, w: 0 });
  active.state.orientation = qMul(qFromAxisAngle(qRotate(frame, v3(0, 0, 1)), 53 * Math.PI / 180), qMul(aligned, qConj(controlRotation(a.part)!)));
  const right = qRotate(frame, v3(1, 0, 0)), up = qRotate(frame, v3(0, 0, 1));
  const offset = add(scale(b.dir, Math.sqrt(distance ** 2 - 25 ** 2 - 14 ** 2)), add(scale(right, 25), scale(up, 14)));
  const face = freePorts(active.state)[0];
  active.state.position = add(active.state.position, sub(add(b.pos, offset), face.pos));
  active.state.velocity = add(b.vel, scale(right, 0.5));
  return { w, active, target };
}

describe('port alignment and RCS docking assist', () => {
  it('uses the reversed target face, including a side-port control frame, and holds roll', () => {
    const { w, active } = setup();
    const port = freePorts(active.state)[0];
    expect(Math.abs(port.dirBody.x)).toBeGreaterThan(0.99);
    const original = port.pos;
    controlFrom(active.state, port.part.uid);
    expect(length(sub(freePorts(active.state)[0].pos, original))).toBeLessThan(1e-4);
    const input = neutralInput({ sas: 'portAlign', targetPortOrientation: targetPortOrientation(w) });
    const env = w.universe.createEnvironment(() => active.body);
    const d = sasTargetDirection(active.state, 'portAlign', input, env, w.ut)!;
    expect(dot(d, targetedPort(w)!.dir)).toBeCloseTo(-1, 10);
    expect(sasTargetDirection(active.state, 'portAlign', neutralInput(), env, w.ut)).toBeNull();
    let captureAt = -1, maxAfter = 0;
    const start = w.ut;
    for (let i = 0; i < 50 * 30; i++) {
      input.targetPortOrientation = targetPortOrientation(w);
      w.tick(0.02, input);
      const angle = portAlignment(freePorts(active.state)[0], targetedPort(w)!).angle * 180 / Math.PI;
      if (angle < 15 && captureAt < 0) captureAt = w.ut - start;
      if (i > 50 * 15) maxAfter = Math.max(maxAfter, angle);
    }
    console.log(`side-port 53° alignment: capture ${captureAt.toFixed(2)} s, max after 15 s ${maxAfter.toFixed(4)}°`);
    expect(captureAt).toBeGreaterThan(0);
    expect(captureAt).toBeLessThan(15);
    expect(maxAfter).toBeLessThan(0.5);
    expect(dot(qRotate(active.state.orientation, v3(0, 0, 1)), qRotate(targetPortOrientation(w)!, v3(0, 0, 1)))).toBeGreaterThan(0.999);
  }, 60000);

  for (const distance of [65, 500]) it(`docks a side-port craft from ${distance} m, 25/14 m offset, 53°, 0.5 m/s`, () => {
    const { w, active } = setup(distance);
    const start = w.ut, fuel = totalResource(active.state, 'monopropellant');
    const ap = autoDock(w);
    // Count only the tug's resource draw: target propellant becomes part of the merged vessel at latch.
    let consumed = 0, previous = fuel;
    const ok = runAutopilot(w, ap, { maxTime: 1200, warp: false, onTick() {
      const remaining = totalResource(active.state, 'monopropellant');
      if (remaining <= previous) consumed += previous - remaining;
      previous = remaining;
    } });
    console.log(`${distance} m dock: ${ok}, ${(w.ut - start).toFixed(2)} s, ${consumed.toFixed(4)} monopropellant units, status ${ap.status}, error ${ap.error}`);
    expect(ap.error).toBeUndefined();
    expect(ok).toBe(true);
    expect(dockedPorts(active.state)).toHaveLength(1);
    expect(w.vessels.size).toBe(1);
    expect(ap.status).toBe('Docked');
    expect(consumed).toBeGreaterThan(0);
    expect(consumed).toBeLessThan(fuel);
  }, 120000);

  it('cancels immediately on pilot translation and keeps the pilot command', () => {
    const { w } = setup();
    const ap = autoDock(w);
    const frame = assistFrame(w, ap, neutralInput({ translateX: 1, rcs: true }), 0.02, { warped: false });
    expect(frame.ended?.reason).toBe('pilot');
    expect(frame.input.translateX).toBe(1);
  });

  for (const reason of ['fuel', 'rcs', 'size', 'tumble', 'target'] as const) it(`aborts safely: ${reason}`, () => {
    const { w, active, target } = setup();
    const ap = autoDock(w);
    w.tick(0.2, ap.update(w).input);
    if (reason === 'fuel') for (const p of active.state.parts) p.resources.monopropellant = 0;
    if (reason === 'rcs') for (const p of active.state.parts) p.tweaks = { ...p.tweaks, rcsEnabled: false };
    if (reason === 'size') {
      const p = freePorts(target.state)[0].part;
      p.def = { ...p.def, modules: p.def.modules.map(m => m.type === 'dockingPort' ? { ...m, size: m.size + 1 } : m) };
    }
    if (reason === 'tumble') target.state.angularVelocity = v3(0.1, 0, 0);
    if (reason === 'target') w.setTarget(null);
    const step = ap.update(w);
    expect(ap.error).toMatch({ fuel: /propellant/, rcs: /RCS translation/, size: /size mismatch/, tumble: /tumbling/, target: /target port changed/ }[reason]);
    expect(step.input.throttle).toBe(0);
    expect(step.input.translateX).toBe(0);
  });
});
