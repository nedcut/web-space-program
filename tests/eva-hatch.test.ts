import { describe, it, expect } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { neutralInput } from '../src/sim/vessel';
import { v3, sub, scale, length, normalize, dot, cross } from '../src/util/vec3';

/** Camera attitude looking along `forward` (−Z) with `up` as screen up. */
function look(forward: ReturnType<typeof v3>, up: ReturnType<typeof v3>) {
  const z = scale(forward, -1), x = normalize(cross(up, z)), y = cross(z, x);
  const m = [[x.x, y.x, z.x], [x.y, y.y, z.y], [x.z, y.z, z.z]];
  const t = m[0][0] + m[1][1] + m[2][2];
  if (t > 0) { const k = Math.sqrt(t + 1) * 2; return { w: k / 4, x: (m[2][1] - m[1][2]) / k, y: (m[0][2] - m[2][0]) / k, z: (m[1][0] - m[0][1]) / k }; }
  if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const k = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; return { w: (m[2][1] - m[1][2]) / k, x: k / 4, y: (m[0][1] + m[1][0]) / k, z: (m[0][2] + m[2][0]) / k }; }
  if (m[1][1] > m[2][2]) { const k = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; return { w: (m[0][2] - m[2][0]) / k, x: (m[0][1] + m[1][0]) / k, y: k / 4, z: (m[1][2] + m[2][1]) / k }; }
  const k = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; return { w: (m[1][0] - m[0][1]) / k, x: (m[0][2] + m[2][0]) / k, y: (m[1][2] + m[2][1]) / k, z: k / 4 };
}
const distance = (hint: string | null) => Number(/— ([\d.]+) m away/.exec(hint ?? '')?.[1] ?? NaN);

describe('EVA hatch distance', () => {
  it('reads continuously through a hop beside a tall grounded rocket', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const ship = w.launch(STOCK_CRAFTS.find(c => c.id === 'stock-meridian')!.build());
    for (let i = 0; i < 10; i++) w.tick(0.02, neutralInput());
    const eva = w.goEva()!;
    const up = normalize(sub(eva.state.position, w.universe.ephem.getBodyState(eva.body, w.ut).position));
    const away = normalize(sub(sub(eva.state.position, ship.state.position), scale(up, dot(sub(eva.state.position, ship.state.position), up))));
    // The hatch is ~15 m up; walk a few metres out so the hint shows a distance.
    for (let i = 0; i < 150 && !(distance(w.boardingBlocker()) > 3.5); i++) w.tick(0.02, neutralInput({ translateZ: -1, evaHeading: look(away, up) }));
    for (let i = 0; i < 20; i++) w.tick(0.02, neutralInput());
    const before = distance(w.boardingBlocker());
    expect(before).toBeGreaterThan(3.5);
    expect(before).toBeLessThan(6);
    w.tick(0.02, neutralInput({ evaJump: true }));
    const readings: number[] = [];
    let airborne = 0;
    for (let i = 0; i < 60; i++) {
      w.tick(0.02, neutralInput());
      if (eva.state.situation === 'flying') airborne++;
      readings.push(distance(w.boardingBlocker()));
    }
    expect(airborne).toBeGreaterThan(5);
    expect(readings.every(Number.isFinite)).toBe(true);
    // A ~0.3 m hop changes the reading by about that much, never by the hatch's height.
    expect(Math.max(...readings)).toBeLessThan(before + 0.6);
    for (let i = 1; i < readings.length; i++) expect(Math.abs(readings[i] - readings[i - 1])).toBeLessThan(0.2);
    expect(eva.state.situation).toBe('landed');
    expect(Math.abs(readings.at(-1)! - before)).toBeLessThan(0.05);
  });

  it('still counts the straight-line distance high above the ground', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const ship = w.launch(STOCK_CRAFTS.find(c => c.id === 'stock-meridian')!.build());
    for (let i = 0; i < 10; i++) w.tick(0.02, neutralInput());
    const eva = w.goEva()!;
    const up = normalize(sub(eva.state.position, w.universe.ephem.getBodyState(eva.body, w.ut).position));
    // Lifted 40 m straight up from the exit spot: the hatch (~15 m up) is ~25 m away, not the 0 m of the column.
    eva.state.position = { x: eva.state.position.x + up.x * 40, y: eva.state.position.y + up.y * 40, z: eva.state.position.z + up.z * 40 };
    eva.state.situation = 'flying';
    const d = distance(w.boardingBlocker());
    const pod = ship.state.parts.find(p => p.crew)!;
    expect(d).toBeCloseTo(length(sub(w.hatchPosition(ship.state, pod), eva.state.position)), 0);
    expect(d).toBeGreaterThan(20);
  });
});
