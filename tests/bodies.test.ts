import { describe, expect, it } from 'vitest';
import { BODY_DEFS, createUniverse, SCALE_PRESETS } from '../src/sim/bodies';

const required = `sun mercury venus earth mars jupiter saturn uranus neptune pluto charon ceres moon
phobos deimos io europa ganymede callisto amalthea himalia thebe metis pan daphnis atlas prometheus
pandora epimetheus janus mimas enceladus tethys telesto calypso dione helene rhea titan hyperion iapetus
phoebe miranda ariel umbriel titania oberon puck triton proteus nereid`.split(/\s+/);

describe('real solar system source data', () => {
  const real = createUniverse('real');
  it('includes every requested body, with a valid connected parent tree', () => {
    expect(new Set(BODY_DEFS.map(b => b.id)).size).toBe(BODY_DEFS.length);
    for (const id of required) expect(real.has(id), id).toBe(true);
    for (const body of real.values()) {
      expect(body.gm).toBeGreaterThan(0);
      expect(body.radius).toBeGreaterThan(0);
      expect(body.rotationPeriod).not.toBe(0);
      expect(body.description).toBeTruthy();
      if (body.id === 'sun') {
        expect(body.parent).toBeUndefined();
        expect(body.soi).toBe(Infinity);
        continue;
      }
      expect(body.parent).toBeDefined();
      expect(real.get(body.parent!)?.children).toContain(body.id);
      expect(body.orbit?.epoch).toBe(0);
      expect(body.orbit!.a).toBeGreaterThan(real.get(body.parent!)!.radius);
      expect(body.orbit!.e).toBeGreaterThanOrEqual(0);
      expect(body.orbit!.e).toBeLessThan(1);
      const seen = new Set<string>();
      let ancestor = body;
      while (ancestor.parent) {
        expect(seen.has(ancestor.id)).toBe(false);
        seen.add(ancestor.id);
        ancestor = real.get(ancestor.parent)!;
        expect(ancestor).toBeDefined();
      }
      expect(ancestor.id).toBe('sun');
    }
  });
  it('matches Earth gravity, SOI, and orbital period checkpoints', () => {
    const earth = real.get('earth')!;
    expect(Math.abs(earth.surfaceGravity - 9.8)).toBeLessThan(0.03);
    expect(Math.abs(earth.soi / 9.24e8 - 1)).toBeLessThan(0.002);
    expect(Math.abs(earth.orbitalPeriod! / 86400 - 365.25)).toBeLessThan(0.02);
    expect(Math.abs(real.get('moon')!.orbitalPeriod! / 86400 - 27.32)).toBeLessThan(0.05);
    expect(Math.abs(real.get('titan')!.orbitalPeriod! / 86400 - 15.95)).toBeLessThan(0.02);
  });
  it('preserves gravity and synchronous spin under every scale preset', () => {
    for (const preset of Object.keys(SCALE_PRESETS) as (keyof typeof SCALE_PRESETS)[]) {
      const universe = createUniverse(preset);
      expect(universe.get('earth')!.surfaceGravity).toBeCloseTo(real.get('earth')!.surfaceGravity, 12);
      for (const id of ['moon', 'titan', 'enceladus', 'triton', 'charon']) {
        const b = universe.get(id)!;
        expect(Math.abs(Math.abs(b.rotationPeriod) / b.orbitalPeriod! - 1)).toBeLessThan(1e-10);
      }
    }
    expect(createUniverse().get('earth')!.radius).toBeCloseTo(637100.84, 5);
  });
  it('records source frames and retrograde spins', () => {
    for (const id of ['moon', 'himalia', 'nereid']) expect(real.get(id)!.orbit!.frame).toBe('ecliptic');
    for (const id of ['titan', 'io', 'charon', 'miranda']) expect(real.get(id)!.orbit!.frame).toBe('parentEquator');
    for (const id of ['venus', 'uranus', 'pluto', 'triton']) expect(real.get(id)!.rotationPeriod).toBeLessThan(0);
  });
  it('has valid procedural styles and extended Saturn rings', () => {
    expect(new Set(BODY_DEFS.map(b => b.surface.seed)).size).toBe(BODY_DEFS.length);
    const presets = new Set('star earth lunar mercury venus mars gasGiant iceGiant icy enceladus titan io europa volcanic rocky'.split(' '));
    for (const b of BODY_DEFS) {
      expect(presets.has(b.surface.preset)).toBe(true);
      expect(b.surface.colors.length).toBeGreaterThanOrEqual(3);
      expect(b.surface.colors.length).toBeLessThanOrEqual(5);
      for (const c of b.surface.colors.flat()) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      if (!b.solidSurface) expect(b.surface.relief).toBe(0);
    }
    expect(real.get('saturn')!.children).toHaveLength(19);
    expect(real.get('saturn')!.rings).toMatchObject({ innerRadius: 66900000, outerRadius: 140200000, profile: 'saturn' });
  });
});
