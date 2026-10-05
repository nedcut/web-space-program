import { describe, expect, it } from 'vitest';
import { defaultCommsSettings, linkRange, occluded, remoteControlAllowed, solveNetwork, LIGHT_SPEED, type CommsNode } from '../src/sim/comms/network';
import { v3, add, scale, sub, length } from '../src/util/vec3';
import { qIdentity } from '../src/util/quat';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { advanceTransmissions } from '../src/game/science';
import { neutralInput } from '../src/sim/vessel';
import { placeInCircularOrbit } from '../src/game/scenarios';
import type { CraftDef } from '../src/sim/vessel/types';

const node = (id: string, x: number, y: number, extra: Partial<CommsNode> = {}): CommsNode => ({ id, name: id, position: v3(x, y, 0), range: 1e9, relay: false, ...extra });
const craft = (crewed = false, antenna = true): CraftDef => ({ name: 'Signal test', version: 1, type: 'VAB', parts: [
  { uid: 1, partId: crewed ? 'pod-lantern-1' : 'probe-pebble', position: v3(), rotation: qIdentity() },
  ...(antenna ? [{ uid: 2, partId: 'antenna-thread', position: v3(0, 0, 0.8), rotation: qIdentity(), parent: 1 }] : []),
  { uid: 3, partId: 'sensor-thermal', position: v3(0, 0, -0.8), rotation: qIdentity(), parent: 1 },
] });
const world = () => new World(new Universe('standard'), PART_CATALOG, 0);

describe('communications geometry and routing', () => {
  it('uses geometric mean ranges, handles zero ratings and falls off smoothly', () => {
    expect(linkRange(4e6, 9e6)).toBe(6e6); expect(linkRange(0, 9e6)).toBe(0);
    const net = solveNetwork([node('ground', 0, 0, { ground: true, range: 100 }), node('half', 50, 0, { range: 100 }), node('edge', 100, 0, { range: 100 })], []);
    expect(net.connections.get('half')!.strength).toBeCloseTo(0.5);
    expect(net.connections.get('edge')!.connected).toBe(false);
  });
  it('Earth blocks the far side, accepts surface endpoints and tests all bodies', () => {
    const earth = { position: v3(), radius: 6371000 };
    expect(occluded(v3(earth.radius, 0, 0), v3(-7e6, 0, 0), [earth])).toBe(true);
    expect(occluded(v3(earth.radius, 0, 0), v3(7e6, 0, 0), [earth])).toBe(false);
    expect(occluded(v3(7e6, 0, 0), v3(8e6, 0, 0), [earth, { position: v3(7.5e6, 0, 0), radius: 1e5 }])).toBe(true);
  });
  it('connects a lunar far-side probe via a satellite, but never forwards through a direct aerial', () => {
    const moon = { position: v3(384e6, 0, 0), radius: 1.737e6 };
    const nodes = [node('ground', 6.371e6, 0, { ground: true }), node('relay', 386e6, 8e6, { relay: true }), node('probe', 386e6, 0)];
    const bodies = [{ position: v3(), radius: 6.371e6 }, moon];
    const c = solveNetwork(nodes, bodies).connections.get('probe')!;
    expect(c.connected).toBe(true); expect(c.path).toEqual(['probe', 'relay', 'ground']);
    expect(c.delay).toBeCloseTo((length(sub(nodes[0].position, nodes[1].position)) + 8e6) / LIGHT_SPEED);
    nodes[1].relay = false;
    expect(solveNetwork(nodes, bodies).connections.get('probe')!.connected).toBe(false);
  });
  it('chooses the strongest product path over a weaker direct link', () => {
    const net = solveNetwork([node('ground', 0, 0, { ground: true, range: 100 }), node('relay', 40, 0, { relay: true, range: 100 }), node('probe', 80, 0, { range: 100 })], []);
    expect(net.connections.get('probe')!.path).toEqual(['probe', 'relay', 'ground']);
  });
});

describe('world communications integration', () => {
  it('defaults by mode, persists overrides and migrates old saves', () => {
    expect(defaultCommsSettings('sandbox').enabled).toBe(false);
    expect(defaultCommsSettings('science').enabled).toBe(true);
    expect(defaultCommsSettings('career').enabled).toBe(true);
    const w = world(); w.commsSettings = { enabled: true, restrictControl: false }; w.launch(craft());
    const saved = serializeWorld(w);
    expect(deserializeWorld(saved, PART_CATALOG).commsSettings).toEqual(w.commsSettings);
    delete saved.commsSettings; saved.mode = 'science';
    expect(deserializeWorld(saved, PART_CATALOG).commsSettings).toEqual(defaultCommsSettings('science'));
  });
  it('provides three rotating Earth stations and a working launch-site link', () => {
    const w = world(); w.launch(craft()); w.commsSettings.enabled = true;
    expect(w.connection().connected).toBe(true);
    const stations = w.comms.nodes.filter(n => n.ground);
    expect(stations).toHaveLength(3);
    const center = w.universe.ephem.getBodyState('earth', w.ut).position;
    const before = sub(stations[0].position, center);
    w.ut += w.universe.body('earth').rotationPeriod / 4;
    const after = sub(w.comms.nodes[0].position, w.universe.ephem.getBodyState('earth', w.ut).position);
    expect(length(sub(before, after))).toBeGreaterThan(1e5);
    expect(length(after)).toBeCloseTo(length(before), 2);
  });
  it('blocks probe staging/manual controls while preserving SAS; crew and optional restrictions work', () => {
    const w = world(); const v = w.launch(craft(false, false)); w.commsSettings.enabled = true;
    expect(w.canControl()).toBe(false);
    w.tick(0.02, neutralInput({ stage: true, throttle: 1 })); expect(v.mode).toBe('prelaunch');
    placeInCircularOrbit(w, v, 'earth', 90000); v.state.sas.mode = 'stabilityAssist';
    w.tick(0.02, neutralInput({ sas: 'off', pitch: 1, throttle: 1, stage: true }));
    expect(v.state.sas.mode).toBe('stabilityAssist');
    expect(v.state.angularVelocity.x).toBeCloseTo(0, 5);
    w.commsSettings.restrictControl = false; expect(w.canControl()).toBe(true);
    w.commsSettings.restrictControl = true; w.commsSettings.enabled = false; expect(w.canControl()).toBe(true);
    const c = world(); c.launch(craft(true, false)); c.commsSettings.enabled = true; expect(c.canControl()).toBe(true);
    expect(remoteControlAllowed({ enabled: true, restrictControl: true }, false, false)).toBe(false);
  });
  it('transmits gradually, pauses without a link and resumes after saving', () => {
    const w = world(); const v = w.launch(craft(true)); w.commsSettings.enabled = true;
    const d = w.runExperiment(3, 'temperature')!; expect(d).toBeTruthy();
    expect(w.transmitScience()).toBe(0);
    w.ut += 0.2; advanceTransmissions(w);
    expect(d.credited).toBeGreaterThan(0); expect(d.credited).toBeCloseTo(w.connection().strength * 0.2, 8);
    // Move beyond antenna range: crew can still control, but cannot transmit.
    const earth = w.universe.ephem.getBodyState('earth', w.ut).position;
    v.state.position = add(earth, scale(v3(1, 0, 0), 1e15));
    w.ut += 0.3; const before = d.credited; advanceTransmissions(w);
    expect(w.connection().connected).toBe(false); expect(d.credited).toBe(before);
    expect(w.transmitScience()).toBe(0);
    const saved = serializeWorld(w); const restored = deserializeWorld(saved, PART_CATALOG);
    expect(restored.transmitting).toEqual([v.state.id]);
    // Prelaunch propagation restores the saved body-fixed pad location on the next tick.
    for (let i = 0; i < 40; i++) restored.tick(0.1, neutralInput());
    const result = restored.active!.state.parts[2].scienceData![0];
    expect(result.credited).toBeCloseTo(result.value * 0.4); expect(restored.transmitting).toEqual([]);
  });
});
