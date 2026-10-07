import { describe, expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { LaunchSite, launchSiteDistance } from '../src/render/site/LaunchSite';
import { qRotate } from '../src/util/quat';
import { DEFAULT_START_UT } from '../src/game/store';

describe('deferred launch scenery visibility', () => {
  for (const preset of ['standard', 'challenging', 'real'] as const) {
    it(`uses the exact LaunchSite pad location at different rotations (${preset})`, () => {
      const universe = new Universe(preset);
      const site = new LaunchSite(universe);
      for (const t of [DEFAULT_START_UT, DEFAULT_START_UT + 43200]) {
        const offset = qRotate(universe.ephem.bodyRotation('earth', t), site.padFixed);
        const center = universe.ephem.getBodyState('earth', t).position;
        const pad = { x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z };
        expect(launchSiteDistance(universe, pad, t)).toBe(0);
        expect(launchSiteDistance(universe, { ...pad, x: pad.x + 300000 }, t)).toBe(300000);
      }
      site.dispose();
    });
  }
});
