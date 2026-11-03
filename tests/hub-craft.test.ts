import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HubScene } from '../src/ui/hub/HubScene';
import { Universe } from '../src/game/universe';
import { DEFAULT_START_UT } from '../src/game/store';
import { buildSoundingRocket } from '../src/editor/stockCrafts';
import type { CraftDef } from '../src/sim/vessel/types';

describe('Space Center pad craft', () => {
  it('a craft that cannot be built leaves the pad empty instead of breaking the hub', () => {
    // setCraft only needs the scene, universe and clock; the rest of the hub (WebGL) is not involved.
    const hub = Object.create(HubScene.prototype) as HubScene;
    Object.assign(hub, { scene: new THREE.Scene(), universe: new Universe('standard'), t: DEFAULT_START_UT, vessel: null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: CraftDef = { ...buildSoundingRocket(), parts: [{ ...buildSoundingRocket().parts[0], partId: 'no-such-part' }] };
    try {
      hub.setCraft(buildSoundingRocket());
      expect((hub as unknown as { vessel: unknown }).vessel).not.toBeNull();
      expect(() => hub.setCraft(broken)).not.toThrow();
      expect((hub as unknown as { vessel: unknown }).vessel).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});
