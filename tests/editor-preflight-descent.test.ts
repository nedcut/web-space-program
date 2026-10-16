import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { Universe } from '../src/game/universe';
import { preflightChecks } from '../src/editor/checks';
import { buildSoundingRocket } from '../src/editor/stockCrafts';
import { buildCricket } from '../src/editor/stock/fun';
import { firstRocket } from '../scripts/career/bare-pod';

const earth = new Universe('standard').body('earth');
const home = { atmosphere: earth.atmosphere!, gravity: earth.surfaceGravity };
const check = (craft: ReturnType<typeof buildCricket>, id: string) => preflightChecks(craft, PART_CATALOG, undefined, home).find(c => c.id === id);

describe('pre-flight descent and g-load checks', () => {
  it('warns, with the numbers, when the parachute could never open on the way down', () => {
    // A pod sitting straight on its tank has no blunt face to fall on: it comes down nose first, too fast to open.
    const c = check(buildCricket(), 'descent');
    expect(c?.note).toBeUndefined();
    expect(c?.text).toMatch(/^Bloom Main Parachute opens below 25 kPa of airflow \(≈20\d m\/s at sea level\), but this craft falls at ≈2\d\d m\/s from a high flight, so it never opens and hits at ≈2\d\d m\/s\. Add a heat shield/);
    expect(c?.uids.length).toBe(1);
  });

  it('passes the classic first rocket and the stock sounding rocket, whose capsules fall base first', () => {
    expect(check(firstRocket(false), 'descent')).toBeUndefined();
    expect(check(buildSoundingRocket(), 'descent')).toBeUndefined();
  });

  it('notes a crewed stage that pulls more than 6 g at burnout, without counting it as a problem', () => {
    const c = check(firstRocket(false), 'crew-g');
    expect(c?.note).toBe(true);
    expect(c?.text).toMatch(/^A crewed stage reaches ≈10\.\d g at burnout\. Throttle back late in the burn/);
    expect(c?.uids.length).toBe(1);
  });
});
